import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { runNowSdk } from "@/lib/nowsdk/cli";

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

    const { stdout, stderr, code } = await runNowSdk(args, { timeoutMs: 60_000 });
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

    const { stdout, stderr, code } = await runNowSdk(args, { timeoutMs: 60_000 });
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

export const nowsdkMcpServer = createSdkMcpServer({
  name: "nowsdk",
  version: "1.0.0",
  tools: [explainTool, queryTool],
});

export const NOWSDK_TOOL_NAMES = ["mcp__nowsdk__explain", "mcp__nowsdk__query"];
