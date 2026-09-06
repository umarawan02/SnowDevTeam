import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { Instance } from "@prisma/client";
import { SnowClient } from "@/lib/servicenow/client";
import { classifyTable, ALLOWED } from "@/lib/nativeengine/tables";
import { runValidation } from "@/lib/nativeengine/gate";
import { writeScriptFiles } from "@/lib/nativeengine/scripts";

/**
 * In-process MCP server for native-tier agents (NATIVE_ENGINE_BRIEF §7.2). The
 * native analogue of `src/lib/nowsdk/mcp.ts` — there is no Fluent project, so
 * `query` runs against the instance directly and the "compile" gate is
 * `validate_plan`, which is **strictly read-only**.
 *
 *  - `query`         — read-only instance data (naming-conflict checks, choices)
 *  - `table_spec`    — the allow-list entry for a table (or its denial reason)
 *  - `validate_plan` — schema + lint + typecheck + read-only dry-run diff
 *
 * No `apply` / `promote` / `rollback` tool exists here or anywhere an agent can
 * reach — those are code paths behind a human action only.
 */

export interface NativeServerOpts {
  instance: Instance | null;
  /** The ticket's native dir — where the agent's script files are written. */
  scriptsDir: string;
}

const makeQueryTool = (instance: Instance | null) =>
  tool(
    "query",
    "Query live records from a table on the connected ServiceNow instance (read-only). " +
      "Use to check whether a similarly-named catalog item / business rule / flow already " +
      "exists before proposing a new one, to read choice values, or to find an OOB record " +
      "(group, catalog, category) to reference by query. Returns JSON, capped at 20 rows.",
    {
      table: z.string().describe("Table name, e.g. 'sc_cat_item', 'sys_user_group', 'sys_choice'"),
      query: z.string().describe("Encoded query, e.g. 'nameLIKElaptop' or 'active=true^nameSTARTSWITHReq'"),
      fields: z.string().optional().describe("Optional comma-separated field list, e.g. 'name,sys_id,short_description'"),
    },
    async ({ table, query, fields }) => {
      if (!instance) {
        return { content: [{ type: "text", text: "no instance is attached to this ticket — cannot query" }], isError: true };
      }
      try {
        const client = SnowClient.forInstance(instance, { readOnly: true });
        const rows = await client.table.list(table, { query, fields, limit: 20 });
        return { content: [{ type: "text", text: rows.length ? JSON.stringify(rows, null, 2) : "(no records)" }] };
      } catch (e) {
        return { content: [{ type: "text", text: `query failed: ${e instanceof Error ? e.message : String(e)}` }], isError: true };
      }
    },
    { annotations: { readOnlyHint: true }, alwaysLoad: true },
  );

const makeTableSpecTool = () =>
  tool(
    "table_spec",
    "Look up whether a table may be written by the native engine, and — if so — its required " +
      "fields, sensible coalesce keys, risk level and gotchas. Call this before adding any change " +
      "for a table you haven't used yet. A denied table returns the correct route instead.",
    { table: z.string().describe("Table name, e.g. 'sc_cat_item', 'sys_script', 'sys_hub_flow'") },
    async ({ table }) => {
      const c = classifyTable(table);
      if (c.kind === "denied") {
        return { content: [{ type: "text", text: `DENIED: ${table}\n${c.reason}` }] };
      }
      const s = c.spec;
      const lines = [
        `ALLOWED: ${table} — ${s.label}`,
        `required on insert: ${s.requiredFields.join(", ") || "(none)"}`,
        `coalesce keys: ${s.coalesce.join(", ") || "(none)"}`,
        s.scriptField ? `script field: ${s.scriptField}` : "",
        s.risk ? `RISK: ${s.risk}` : "",
        s.notes ? `notes: ${s.notes}` : "",
      ].filter(Boolean);
      return { content: [{ type: "text", text: lines.join("\n") }] };
    },
    { annotations: { readOnlyHint: true }, alwaysLoad: true },
  );

const makeValidatePlanTool = (opts: NativeServerOpts) =>
  tool(
    "validate_plan",
    "Validate your change plan — this is your build step. Pass the full CHANGE_PLAN JSON and " +
      "every script file. Runs: JSON schema + semantic checks (table allow-list, no hard-coded " +
      "sys_ids, $ref graph), the lint rules on every script body, a TypeScript check of the " +
      "scripts, and a READ-ONLY dry-run diff against the instance. Returns errors, warnings and " +
      "the diff. Call it repeatedly until it reports no errors; do not emit your final answer " +
      "until it is clean. It never writes anything.",
    {
      plan: z.string().describe("The full change-plan JSON document (as a string)."),
      scripts: z
        .array(z.object({ path: z.string(), content: z.string() }))
        .default([])
        .describe("Every script file the plan's `script.file` entries point at: { path: 'name.js', content }"),
    },
    async ({ plan, scripts }) => {
      let planInput: unknown;
      try {
        planInput = JSON.parse(plan);
      } catch (e) {
        return { content: [{ type: "text", text: `CHANGE_PLAN is not valid JSON: ${e instanceof Error ? e.message : String(e)}` }], isError: true };
      }

      // Write the scripts to a scratch dir so typecheck / lint can read them.
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "snde-vp-"));
      try {
        if (scripts.length) writeScriptFiles(dir, scripts.map((s) => ({ path: s.path, content: s.content })));
        const scope = (planInput as { scope?: string })?.scope;
        const r = await runValidation({
          planInput,
          scriptsDir: dir,
          instance: opts.instance,
          scopeKind: scope && scope !== "global" ? "scoped" : "global",
        });

        const out: string[] = [r.summary, ""];
        if (r.errors.length) {
          out.push("## Errors (must fix)");
          for (const e of r.errors) out.push(`- ${e}`);
          out.push("");
        }
        if (r.warnings.length) {
          out.push("## Warnings");
          for (const w of r.warnings) out.push(`- ${w}`);
          out.push("");
        }
        if (r.diffMarkdown) {
          out.push("## Dry-run diff (read-only)");
          out.push(r.diffMarkdown);
        }
        return { content: [{ type: "text", text: out.join("\n") }], ...(r.ok ? {} : { isError: true }) };
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
    { annotations: { readOnlyHint: true }, alwaysLoad: true },
  );

/** Fresh native MCP server for one agent run, pinned to the ticket's instance. */
export function createNativeMcpServer(opts: NativeServerOpts) {
  return createSdkMcpServer({
    name: "native",
    version: "1.0.0",
    tools: [makeQueryTool(opts.instance), makeTableSpecTool(), makeValidatePlanTool(opts)],
  });
}

export const NATIVE_TOOL_NAMES = ["mcp__native__query", "mcp__native__table_spec", "mcp__native__validate_plan"];

/** Names of every table the native engine may write — for the grounding prompt. */
export const ALLOWED_TABLE_NAMES = Object.keys(ALLOWED);
