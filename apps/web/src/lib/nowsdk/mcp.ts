import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { TargetScope } from "@/lib/constants";
import { runNowSdk } from "@/lib/nowsdk/cli";
import { buildWorkspace } from "@/lib/nowsdk/workspace";
import { parseGeneratedFiles } from "@/lib/pipeline/parse";

/**
 * In-process MCP server exposing the two read-only now-sdk capabilities the
 * Architect / Senior Dev / Developer agents need:
 *
 *  - `explain` — versioned SDK documentation lookup (search → peek → read)
 *  - `query`   — live instance data (naming-conflict checks, choice values, …)
 *
 * Both are read-only; per the now-sdk skill they run without confirmation.
 */

const explainTool = tool(
  "explain",
  "Look up official ServiceNow SDK / Fluent documentation for the installed SDK version. " +
    "Workflow: mode='list' to search topic names, then mode='peek' for a one-line summary, " +
    "then mode='full' to read the whole topic. Always peek before reading a full topic. " +
    "Use this for the exact Fluent syntax of any metadata type (Flow, CatalogItem, Table, " +
    "BusinessRule, Acl, RecordProducer, …) before writing code.",
  {
    topic: z
      .string()
      .describe("Topic name or search term, e.g. 'flow', 'catalog', 'BusinessRule', 'naming'"),
    mode: z
      .enum(["list", "peek", "full"])
      .default("peek")
      .describe("'list' = search topic names; 'peek' = short summary; 'full' = entire topic"),
  },
  async ({ topic, mode }) => {
    const args = ["explain", topic];
    if (mode === "list") args.push("--list");
    else if (mode === "peek") args.push("--peek");
    args.push("--format=raw");

    // Full topics can be 40–60 KB; the essentials are up front and grounding.md
    // already distils the common rules. Cap it to keep agent context lean.
    const maxChars = mode === "full" ? 26_000 : 8_000;
    const { stdout, stderr, code } = await runNowSdk(args, { timeoutMs: 60_000, maxChars });
    if (code !== 0 && !stdout.trim()) {
      return {
        content: [{ type: "text", text: `explain failed (exit ${code}):\n${stderr}` }],
        isError: true,
      };
    }
    return { content: [{ type: "text", text: stdout.trim() || stderr.trim() || "(no output)" }] };
  },
  { annotations: { readOnlyHint: true }, alwaysLoad: true },
);

const queryTool = tool(
  "query",
  "Query live records from a table on the connected ServiceNow instance (read-only). " +
    "Use to check whether a similarly-named catalog item / flow / table already exists " +
    "before proposing a new one, or to read choice values. Returns JSON, capped at 20 rows.",
  {
    table: z.string().describe("Table name, e.g. 'sc_cat_item', 'sys_hub_flow', 'sys_db_object'"),
    query: z
      .string()
      .describe("Encoded query (sysparm_query), e.g. 'nameLIKElaptop' or 'active=true^nameSTARTSWITHReq'"),
    fields: z
      .string()
      .optional()
      .describe("Optional comma-separated field list, e.g. 'name,sys_id,short_description'"),
  },
  async ({ table, query, fields }) => {
    const args = ["query", table, "-q", query, "--limit", "20", "-o", "json"];
    if (fields) args.push("-f", fields);

    const { stdout, stderr, code } = await runNowSdk(args, { timeoutMs: 60_000, maxChars: 12_000 });
    if (code !== 0 && !stdout.trim()) {
      return {
        content: [{ type: "text", text: `query failed (exit ${code}):\n${stderr}` }],
        isError: true,
      };
    }
    return { content: [{ type: "text", text: stdout.trim() || "(no records)" }] };
  },
  { annotations: { readOnlyHint: true }, alwaysLoad: true },
);

const makeBuildTool = (scope?: TargetScope) =>
  tool(
    "build",
    "Compile the ServiceNow Fluent files you have written. Pass EVERY file you " +
      "intend to emit (path + full content). Runs `now-sdk build` and returns the " +
      "compiler output. Call this once you think your code is complete; if it " +
      "reports errors, fix them and call it again until it exits 0. It does not " +
      "deploy anything.",
    {
      files: z
        .array(z.object({ path: z.string(), content: z.string() }))
        .min(1)
        .describe("Every generated file: { path: 'src/fluent/...', content: '<full file>' }"),
    },
    async ({ files }) => {
      // Reuse the parser's path allow-list by round-tripping through file blocks.
      const blocks = files
        .map((f) => `=== FILE: ${f.path} ===\n\`\`\`typescript\n${f.content}\n\`\`\`\n=== END FILE ===`)
        .join("\n\n");
      const { files: valid, warnings } = parseGeneratedFiles(blocks);
      if (valid.length === 0) {
        return {
          content: [{ type: "text", text: `No valid files to build.\n${warnings.join("\n")}` }],
          isError: true,
        };
      }
      const r = await buildWorkspace(valid, { scope });
      const head =
        r.code === 0
          ? `✓ now-sdk build passed (exit 0) · ${r.fileCount} file(s)`
          : `✗ now-sdk build FAILED (exit ${r.code}) — fix these and call build again`;
      const body = [r.stdout, r.stderr].filter(Boolean).join("\n").slice(0, 12_000);
      return {
        content: [{ type: "text", text: `${head}\n\n${body}` }],
        ...(r.code === 0 ? {} : { isError: true }),
      };
    },
    { annotations: { readOnlyHint: false }, alwaysLoad: true },
  );

/**
 * Fresh in-process `nowsdk` MCP server for one agent run. `scope` fixes which
 * `now.config.json` the Developer's `build` tool compiles against.
 */
export function createNowsdkMcpServer(opts: { scope?: TargetScope } = {}) {
  return createSdkMcpServer({
    name: "nowsdk",
    version: "1.0.0",
    tools: [explainTool, queryTool, makeBuildTool(opts.scope)],
  });
}

/** Default (scope-agnostic) server for callers that don't build. */
export const nowsdkMcpServer = createNowsdkMcpServer();

export const NOWSDK_TOOL_NAMES = ["mcp__nowsdk__explain", "mcp__nowsdk__query"];
/** Given to the Developer only — an actual `now-sdk build` of its draft code. */
export const NOWSDK_BUILD_TOOL = "mcp__nowsdk__build";
