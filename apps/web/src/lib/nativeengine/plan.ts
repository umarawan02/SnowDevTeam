import { z } from "zod";
import { classifyTable } from "@/lib/nativeengine/tables";

/**
 * The native engine change plan (NATIVE_ENGINE_BRIEF §4.1). A native-tier
 * ticket's build output is a validated JSON document, not Fluent source. This
 * module holds the schema, `validatePlan` (schema + semantic checks), and
 * `orderChanges` (topological order from the `$ref` graph).
 */

const SYS_ID_RE = /^[0-9a-f]{32}$/i;
const SYS_ID_ANYWHERE_RE = /\b[0-9a-f]{32}\b/i;

const refSchema = z.object({ $ref: z.string().min(1) }).strict();
const lookupSchema = z
  .object({
    $lookup: z
      .object({
        table: z.string().min(1),
        query: z.string().min(1),
        field: z.string().min(1).optional(),
      })
      .strict(),
  })
  .strict();

const fieldValueSchema = z.union([z.string(), z.number(), z.boolean(), refSchema, lookupSchema]);

export const changeSchema = z
  .object({
    id: z.string().min(1),
    table: z.string().min(1),
    op: z.enum(["insert", "update"]),
    coalesce: z.record(z.string(), z.string()).optional(),
    sysId: z.string().regex(SYS_ID_RE, "sysId must be a 32-hex sys_id").optional(),
    fields: z.record(z.string(), fieldValueSchema),
    script: z.object({ file: z.string().min(1) }).strict().optional(),
    reason: z.string().min(3),
  })
  .strict();

export const changePlanSchema = z
  .object({
    scope: z.string().min(1),
    updateSetName: z.string().min(1),
    changes: z.array(changeSchema).min(1),
  })
  .strict();

export type FieldValue = z.infer<typeof fieldValueSchema>;
export type Change = z.infer<typeof changeSchema>;
export type ChangePlan = z.infer<typeof changePlanSchema>;

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  plan?: ChangePlan;
  /** Apply order (change ids), when the plan is valid. */
  order?: string[];
}

export function isRef(v: FieldValue): v is { $ref: string } {
  return typeof v === "object" && v !== null && "$ref" in v;
}
export function isLookup(v: FieldValue): v is { $lookup: { table: string; query: string; field?: string } } {
  return typeof v === "object" && v !== null && "$lookup" in v;
}

/** Topological order of change ids from the `$ref` graph; throws on a cycle. */
export function orderChanges(plan: ChangePlan): string[] {
  const ids = new Set(plan.changes.map((c) => c.id));
  const deps = new Map<string, Set<string>>();
  for (const c of plan.changes) {
    const s = new Set<string>();
    for (const v of Object.values(c.fields)) {
      if (isRef(v) && ids.has(v.$ref)) s.add(v.$ref);
    }
    deps.set(c.id, s);
  }
  const order: string[] = [];
  const state = new Map<string, "visiting" | "done">();
  const visit = (id: string, path: string[]) => {
    const st = state.get(id);
    if (st === "done") return;
    if (st === "visiting") throw new Error(`dependency cycle: ${[...path, id].join(" → ")}`);
    state.set(id, "visiting");
    for (const d of deps.get(id) ?? []) visit(d, [...path, id]);
    state.set(id, "done");
    order.push(id);
  };
  for (const c of plan.changes) visit(c.id, []);
  return order;
}

/**
 * Schema + semantic validation. Never throws — a bad plan is a list of errors.
 * `scopeKind` restricts writable tables: "scoped" flags writes to tables the
 * customer's app doesn't own (a cross-scope-OOB write the human should confirm).
 */
export function validatePlan(input: unknown, opts: { scopeKind?: "global" | "scoped" } = {}): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const parsed = changePlanSchema.safeParse(input);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      errors.push(`${issue.path.join(".") || "(root)"}: ${issue.message}`);
    }
    return { ok: false, errors, warnings };
  }
  const plan = parsed.data;

  // unique change ids
  const seen = new Set<string>();
  for (const c of plan.changes) {
    if (seen.has(c.id)) errors.push(`duplicate change id "${c.id}"`);
    seen.add(c.id);
  }

  for (const c of plan.changes) {
    // op:delete is rejected by the enum, but be explicit for a clear message
    if ((c.op as string) === "delete") {
      errors.push(`change "${c.id}": op:"delete" is never allowed — the engine only inserts/updates`);
    }

    // table allow-list + scope
    const cls = classifyTable(c.table);
    if (cls.kind === "denied") {
      errors.push(`change "${c.id}" → ${c.table}: ${cls.reason}`);
    } else if (opts.scopeKind === "scoped" && !c.table.startsWith("x_") && !c.table.startsWith("u_")) {
      warnings.push(
        `change "${c.id}" → ${c.table}: writing to an OOB table from a scoped-app plan — confirm this cross-scope change with the reviewer`,
      );
    }

    // insert needs coalesce or the required fields; update needs sysId or coalesce
    if (cls.kind === "allowed") {
      if (c.op === "update" && !c.sysId && !c.coalesce) {
        errors.push(`change "${c.id}": op:"update" needs a sysId or a coalesce`);
      }
      if (c.op === "insert") {
        // a `script: { file }` satisfies the table's script field requirement
        const scriptField = cls.spec.scriptField;
        const missing = cls.spec.requiredFields.filter(
          (f) => !(f in c.fields) && !(c.script && f === scriptField),
        );
        if (missing.length) errors.push(`change "${c.id}" → ${c.table}: missing required field(s) ${missing.join(", ")}`);
      }
    }

    // no literal sys_id in a field value that isn't wrapped in $ref/$lookup
    for (const [k, v] of Object.entries(c.fields)) {
      if (typeof v === "string" && SYS_ID_ANYWHERE_RE.test(v)) {
        errors.push(
          `change "${c.id}" field "${k}": contains a literal 32-hex sys_id — use { $lookup: … } or { $ref: … } so the agent never hard-codes an id`,
        );
      }
      // a $lookup reads any table (that's fine) — whether it *resolves* is
      // checked live at the dry-run diff stage, not here.
    }

    // script.file must be relative, no traversal
    if (c.script && (c.script.file.startsWith("/") || c.script.file.includes(".."))) {
      errors.push(`change "${c.id}": script.file must be a relative path with no ".."`);
    }
  }

  // $ref targets exist + no cycle
  const ids = new Set(plan.changes.map((c) => c.id));
  for (const c of plan.changes) {
    for (const [k, v] of Object.entries(c.fields)) {
      if (isRef(v) && !ids.has(v.$ref)) {
        errors.push(`change "${c.id}" field "${k}": $ref "${v.$ref}" is not a change id in this plan`);
      }
    }
  }

  let order: string[] | undefined;
  if (errors.length === 0) {
    try {
      order = orderChanges(plan);
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }

  return { ok: errors.length === 0, errors, warnings, plan: errors.length === 0 ? plan : undefined, order };
}
