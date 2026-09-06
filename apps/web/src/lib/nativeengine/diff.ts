import { SnowError, type SnowClient } from "@/lib/servicenow/client";
import { isLookup, isRef, orderChanges, type Change, type ChangePlan, type FieldValue } from "@/lib/nativeengine/plan";
import { ALLOWED } from "@/lib/nativeengine/tables";

/**
 * Dry-run diff for a change plan (NATIVE_ENGINE_BRIEF §4). Read-only: every
 * ServiceNow call here is a GET (`client.table.getOne` / `.list`). Produces the
 * `CHANGE_PLAN_DIFF` artifact the human reviewer approves before Phase 5's
 * `apply.ts` writes anything.
 */

export interface FieldDiff {
  field: string;
  before: string | null; // null = field absent / record is new
  after: string; // rendered value ($ref / $lookup resolved or annotated)
}

export interface ChangeDiff {
  id: string;
  table: string;
  op: "insert" | "update";
  reason: string;
  /** "insert" (no match found), "update" (sysId or coalesce matched a row), or "error". */
  effect: "create" | "update" | "error";
  matchedSysId?: string;
  fields: FieldDiff[];
  /** hard problems — an unresolved $lookup, an update with nothing to update. */
  errors: string[];
  /** soft notes — e.g. the diff credential couldn't read the current record. */
  notes: string[];
}

export interface DryRunResult {
  markdown: string;
  perChange: ChangeDiff[];
  /** true when nothing in the plan resolves to an error. */
  ok: boolean;
}

/** Render a plan value for the diff; resolve `$lookup` live (read-only), annotate `$ref`. */
async function renderValue(
  v: FieldValue,
  client: SnowClient,
  refLabels: Map<string, string>,
  errors: string[],
): Promise<string> {
  if (isRef(v)) return `«will be created: ${refLabels.get(v.$ref) ?? v.$ref}»`;
  if (isLookup(v)) {
    const field = v.$lookup.field ?? "sys_id";
    try {
      const row = await client.table.getOne<Record<string, unknown>>(v.$lookup.table, {
        query: v.$lookup.query,
        fields: `sys_id,${field}`,
      });
      if (!row) {
        errors.push(`$lookup on ${v.$lookup.table} (${v.$lookup.query}) matched no record`);
        return `«UNRESOLVED $lookup: ${v.$lookup.table} / ${v.$lookup.query}»`;
      }
      const resolved = String(row[field] ?? "");
      return `${resolved}  (${v.$lookup.table} / ${v.$lookup.query})`;
    } catch (e) {
      errors.push(`$lookup on ${v.$lookup.table} failed: ${e instanceof Error ? e.message : String(e)}`);
      return `«$lookup ERROR: ${v.$lookup.table} / ${v.$lookup.query}»`;
    }
  }
  if (typeof v === "boolean") return v ? "true" : "false";
  return String(v);
}

function isPermissionError(e: unknown): boolean {
  return e instanceof SnowError && (e.info.kind === "FORBIDDEN" || e.info.kind === "UNAUTHENTICATED" || e.info.kind === "SCOPE_RESTRICTION");
}

/** Find the existing record a change would touch: by sysId, else by coalesce. Read-only. */
async function findExisting(
  change: Change,
  client: SnowClient,
): Promise<{ row: Record<string, unknown> | null; error?: string; note?: string }> {
  if (change.sysId) {
    try {
      const row = await client.table.getOne<Record<string, unknown>>(change.table, { sysId: change.sysId });
      return { row };
    } catch (e) {
      if (isPermissionError(e)) return { row: null, note: `could not read ${change.table}/${change.sysId} (${(e as SnowError).info.kind})` };
      throw e;
    }
  }
  if (change.coalesce && Object.keys(change.coalesce).length > 0) {
    const parts: string[] = [];
    for (const [k, ref] of Object.entries(change.coalesce)) {
      const v = change.fields[ref] ?? change.fields[k];
      if (v === undefined) return { row: null, error: `coalesce key "${k}" has no matching field to resolve` };
      if (isRef(v)) return { row: null }; // coalescing on a to-be-created record → always an insert
      if (isLookup(v)) {
        try {
          const lr = await client.table.getOne<Record<string, unknown>>(v.$lookup.table, {
            query: v.$lookup.query,
            fields: "sys_id",
          });
          if (!lr) return { row: null, error: `coalesce $lookup on ${v.$lookup.table} matched nothing` };
          parts.push(`${k}=${lr.sys_id}`);
        } catch (e) {
          return { row: null, error: `coalesce $lookup failed: ${e instanceof Error ? e.message : String(e)}` };
        }
      } else {
        parts.push(`${k}=${String(v)}`);
      }
    }
    try {
      const row = await client.table.getOne<Record<string, unknown>>(change.table, { query: parts.join("^") });
      return { row };
    } catch (e) {
      if (isPermissionError(e)) return { row: null, note: `could not read ${change.table} to check for an existing record (${(e as SnowError).info.kind}) — treated as a new record` };
      throw e;
    }
  }
  return { row: null };
}

export async function dryRunDiff(plan: ChangePlan, client: SnowClient): Promise<DryRunResult> {
  let order: string[];
  try {
    order = orderChanges(plan);
  } catch {
    order = plan.changes.map((c) => c.id);
  }
  const byId = new Map(plan.changes.map((c) => [c.id, c]));
  const refLabels = new Map(plan.changes.map((c) => [c.id, `${c.table} (${c.id})`]));

  const perChange: ChangeDiff[] = [];

  for (const id of order) {
    const c = byId.get(id);
    if (!c) continue;
    const errors: string[] = [];
    const notes: string[] = [];
    const spec = ALLOWED[c.table];

    let existing: Record<string, unknown> | null = null;
    try {
      const found = await findExisting(c, client);
      existing = found.row;
      if (found.error) errors.push(found.error);
      if (found.note) notes.push(found.note);
    } catch (e) {
      errors.push(`lookup for existing record failed: ${e instanceof Error ? e.message : String(e)}`);
    }

    const effect: ChangeDiff["effect"] = errors.length > 0 ? "error" : existing ? "update" : "create";
    if (c.op === "update" && !existing && errors.length === 0) {
      errors.push(`op:"update" but no record matched sysId/coalesce — nothing to update`);
    }

    const fields: FieldDiff[] = [];
    for (const [k, v] of Object.entries(c.fields)) {
      const after = await renderValue(v, client, refLabels, errors);
      const before = existing && k in existing ? String(existing[k] ?? "") : null;
      if (before !== after) fields.push({ field: k, before, after });
    }
    if (c.script && spec?.scriptField) {
      const before = existing && spec.scriptField in existing ? "«current script»" : null;
      fields.push({ field: spec.scriptField, before, after: `«from ${c.script.file}»` });
    }

    perChange.push({
      id: c.id,
      table: c.table,
      op: c.op,
      reason: c.reason,
      effect: errors.length > 0 ? "error" : effect,
      matchedSysId: existing ? String(existing.sys_id ?? "") : undefined,
      fields,
      errors,
      notes,
    });
  }

  return { markdown: renderMarkdown(plan, perChange), perChange, ok: perChange.every((c) => c.errors.length === 0) };
}

function renderMarkdown(plan: ChangePlan, perChange: ChangeDiff[]): string {
  const lines: string[] = [];
  lines.push(`# Change plan dry-run — ${plan.scope}`);
  lines.push("");
  lines.push(`Update set: **${plan.updateSetName}** · ${perChange.length} change(s)`);
  const creates = perChange.filter((c) => c.effect === "create").length;
  const updates = perChange.filter((c) => c.effect === "update").length;
  const errs = perChange.filter((c) => c.effect === "error").length;
  lines.push("");
  lines.push(`- ${creates} record(s) created · ${updates} updated · ${errs} error(s)`);
  lines.push("");

  for (const c of perChange) {
    const verb = c.effect === "create" ? "CREATE" : c.effect === "update" ? "UPDATE" : "ERROR";
    lines.push(`## ${verb} — \`${c.table}\` (${c.id})`);
    lines.push("");
    lines.push(`_${c.reason}_`);
    lines.push("");
    if (c.matchedSysId) lines.push(`Matched existing record \`${c.matchedSysId}\`.`);
    if (c.errors.length) {
      lines.push("");
      for (const e of c.errors) lines.push(`- ⚠️ ${e}`);
    }
    if (c.notes.length) {
      lines.push("");
      for (const n of c.notes) lines.push(`- ℹ️ ${n}`);
    }
    lines.push("");
    if (c.fields.length === 0) {
      lines.push("_No field changes._");
    } else {
      lines.push("| Field | Before | After |");
      lines.push("| --- | --- | --- |");
      for (const f of c.fields) {
        const before = f.before === null ? "_(new)_" : mdCell(f.before);
        lines.push(`| \`${f.field}\` | ${before} | ${mdCell(f.after)} |`);
      }
    }
    lines.push("");
  }
  return lines.join("\n");
}

function mdCell(v: string): string {
  const oneLine = v.replace(/\r?\n/g, " ⏎ ");
  const clipped = oneLine.length > 200 ? `${oneLine.slice(0, 200)}…` : oneLine;
  return clipped.replace(/\|/g, "\\|");
}
