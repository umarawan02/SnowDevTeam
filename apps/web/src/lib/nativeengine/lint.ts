import type { ChangePlan } from "@/lib/nativeengine/plan";
import { ALLOWED } from "@/lib/nativeengine/tables";

/**
 * The native engine's quality gate (NATIVE_ENGINE_BRIEF §4.4) — this replaces
 * `now-sdk build` for the Table-API tier. Heuristic checks on server-side
 * script bodies; fail the build gate on an error, surface warnings to the
 * reviewer.
 */

export interface LintFinding {
  severity: "error" | "warning";
  rule: string;
  message: string;
  where: string; // change id / file
}

const BIG_TABLES = ["incident", "task", "sys_user", "cmdb_ci", "sc_req_item", "sc_task", "change_request", "problem"];

export interface LintContext {
  where: string;
  /** the field the script lives in — e.g. "script" on a business rule */
  scriptField?: string;
  table?: string;
  when?: string;
  /** does this script include declare itself an API? */
  isApi?: boolean;
}

export function lintScript(body: string, ctx: LintContext): LintFinding[] {
  const out: LintFinding[] = [];
  const err = (rule: string, message: string) => out.push({ severity: "error", rule, message, where: ctx.where });
  const warn = (rule: string, message: string) => out.push({ severity: "warning", rule, message, where: ctx.where });

  const src = body.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, ""); // strip comments for matching

  if (/\b[0-9a-f]{32}\b/i.test(src)) err("no-hardcoded-sys-id", "hard-coded 32-hex sys_id — resolve records by query, not by id");
  if (/\bgs\.log\s*\(/.test(src)) err("no-gs-log", "gs.log is unavailable in scoped code — use gs.info / gs.warn / gs.error");
  if (/\beval\s*\(/.test(src)) err("no-eval", "eval() is forbidden");
  if (/\b(document|window)\s*\.|(\$|jQuery)\s*\(/.test(src) && ctx.scriptField === "script" && ctx.table !== "sys_script_client" && ctx.table !== "catalog_script_client")
    err("no-dom-server", "DOM / jQuery access in a server-side script");

  const isBeforeBR = ctx.table === "sys_script" && ctx.when === "before";
  if (isBeforeBR && /\bcurrent\.update\s*\(/.test(src))
    err("no-current-update-in-before", "current.update() inside a before business rule — the platform saves current automatically");
  if (ctx.table === "sys_script" && !/\(\s*function[^)]*\)\s*\(\s*current\s*,\s*previous\s*\)\s*;?/.test(src) && !/executeRule\s*\(/.test(src))
    err("br-wrapper", "business rule script must be wrapped: (function executeRule(current, previous) { … })(current, previous);");

  // GlideRecord hygiene
  const grVars = [...src.matchAll(/\b(?:var|let|const)\s+(\w+)\s*=\s*new\s+GlideRecord\s*\(/g)].map((m) => m[1]);
  for (const gr of grVars) {
    const seg = src.slice(src.indexOf(`new GlideRecord`));
    const hasFilter = new RegExp(`${gr}\\.(addQuery|addEncodedQuery|get)\\s*\\(`).test(seg);
    const queries = new RegExp(`${gr}\\.query\\s*\\(`).test(seg);
    if (queries && !hasFilter) err("gr-unfiltered", `GlideRecord "${gr}" is queried with no addQuery/addEncodedQuery — this reads the whole table`);
    const loopUpdates = new RegExp(`while\\s*\\(\\s*${gr}\\.next\\s*\\(\\s*\\)\\s*\\)[\\s\\S]{0,400}?${gr}\\.update\\s*\\(`).test(seg);
    const hasLimit = new RegExp(`${gr}\\.setLimit\\s*\\(`).test(seg);
    if (loopUpdates && !hasLimit) warn("gr-loop-update", `"${gr}" updates rows in a while-next loop with no setLimit — bound it`);
  }

  // NB: "before BR on a large target table with no condition" is a plan-level
  // check (the target table + condition are plan fields, not in the script) —
  // see `lintPlan`.

  if (ctx.isApi && ctx.table === "sys_script_include" && !/\bClass\.create\s*\(/.test(src) && !/\.prototype\s*=/.test(src))
    err("si-api-shape", "a script include that exposes an API should use Class.create() / prototype");

  // warnings
  if (/\b(sn_ws\.RESTMessageV2|GlideHTTPRequest|RESTMessageV2)\b/.test(src) && !/\btry\s*\{/.test(src))
    warn("integration-no-try", "outbound integration call with no try/catch");
  if (/\bGlideRecord\b/.test(src) && !/\bsetWorkflow\b/.test(src) && /\.update\s*\(|\.insert\s*\(/.test(src) && !/sys_domain/.test(src))
    warn("domain-awareness", "writes records without visible sys_domain handling — confirm domain separation is intended");
  if (body.split(/\r?\n/).length > 150)
    warn("long-script", `${body.split(/\r?\n/).length} lines — consider extracting a script include`);

  return out;
}

/** Lint every script in a plan: `script.file` bodies (read via `readFile`) + inline script fields. */
export function lintPlan(
  plan: ChangePlan,
  readFile: (relPath: string) => string | null,
): LintFinding[] {
  const findings: LintFinding[] = [];
  for (const c of plan.changes) {
    const spec = ALLOWED[c.table];
    const scriptField = spec?.scriptField;

    // inline script field
    if (scriptField && typeof c.fields[scriptField] === "string") {
      findings.push(
        ...lintScript(c.fields[scriptField] as string, {
          where: `${c.id} (inline ${scriptField})`,
          scriptField,
          table: c.table,
          when: typeof c.fields.when === "string" ? c.fields.when : undefined,
          isApi: c.table === "sys_script_include",
        }),
      );
    }

    // script.file
    if (c.script) {
      const body = readFile(c.script.file);
      if (body == null) {
        findings.push({ severity: "error", rule: "missing-script-file", message: `script.file "${c.script.file}" not found in the ticket dir`, where: c.id });
      } else {
        findings.push(
          ...lintScript(body, {
            where: `${c.id} (${c.script.file})`,
            scriptField,
            table: c.table,
            when: typeof c.fields.when === "string" ? c.fields.when : undefined,
            isApi: c.table === "sys_script_include",
          }),
        );
      }
    }

    // before-BR on a big table with no condition — the condition is a plan field
    if (c.table === "sys_script" && c.fields.when === "before") {
      const target = typeof c.fields.collection === "string" ? c.fields.collection : "";
      const cond = c.fields.condition;
      const filter = c.fields.filter_condition;
      if (BIG_TABLES.includes(target) && !cond && !filter) {
        findings.push({
          severity: "error",
          rule: "unconditional-before-br",
          message: `before business rule on "${target}" with no condition/filter_condition — this runs on every write to a large table`,
          where: c.id,
        });
      }
    }

    // over-build: a custom notification that looks like an OOB one (Phase 8)
    if (c.table === "sysevent_email_action") {
      const collection = String(c.fields.collection ?? "");
      const label = `${c.fields.name ?? ""} ${c.fields.subject ?? ""}`.toLowerCase();
      if (
        ["sc_req_item", "sysapproval_approver", "sc_task", "sc_request"].includes(collection) &&
        /\b(approv|reject|assigned|submitted|complete|closed)\b/.test(label)
      ) {
        findings.push({
          severity: "warning",
          rule: "oob-notification",
          message: `"${c.fields.name}" on ${collection} looks like an OOB notification (approval/assignment/state) — confirm it isn't a duplicate; the Architect's Decision table must justify a custom one`,
          where: c.id,
        });
      }
    }

    // over-build: a custom ACL on a catalog/approval table
    if (c.table === "sys_security_acl") {
      const nameField = String(c.fields.name ?? "");
      if (/^(sc_cat_item|sysapproval_approver|sc_req_item|sc_request)\b/.test(nameField)) {
        findings.push({
          severity: "warning",
          rule: "oob-acl",
          message: `ACL on "${nameField}" — catalog visibility (roles / user criteria) and approval-record access are OOB; confirm this rule is genuinely new`,
          where: c.id,
        });
      }
    }
  }
  return findings;
}
