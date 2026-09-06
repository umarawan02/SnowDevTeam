import type { Instance, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ARTIFACT_TYPE, NATIVE_DEPLOY_STATE, RELEASE_GATE } from "@/lib/constants";
import { SnowClient, SnowError } from "@/lib/servicenow/client";
import { resolveScope } from "@/lib/servicenow/scope";
import {
  assertNoLeakage,
  capturedUpdates,
  completeUpdateSet,
  createUpdateSet,
  defaultUpdateSet,
  updateCount,
} from "@/lib/servicenow/updateset";
import { applyOneChange, probeNativeResource } from "@/lib/servicenow/native-resource";
import { isLookup, isRef, orderChanges, type Change, type ChangePlan, type FieldValue } from "@/lib/nativeengine/plan";
import { resolveScripts } from "@/lib/nativeengine/scripts";
import { ALLOWED } from "@/lib/nativeengine/tables";
import { verifyNativeRecords } from "@/lib/servicenow/verify";

/**
 * Apply a change plan to a dev instance (NATIVE_ENGINE_BRIEF §5.1). The ordered
 * sequence, exactly; any failure stops immediately and marks the deployment
 * failed — there is no partial rollback because the update set *is* the
 * rollback unit and a human decides. Every request is recorded (redacted) in
 * the DEPLOY_LOG artifact.
 *
 * Not reachable from any agent tool — called only by `deployTicket` after a
 * human Approve, and by `scripts/apply-plan.mts`.
 */

export interface AppliedChange {
  changeId: string;
  table: string;
  sysId: string;
  operation: "inserted" | "updated";
}

export interface ApplyResult {
  ok: boolean;
  state: (typeof NATIVE_DEPLOY_STATE)[keyof typeof NATIVE_DEPLOY_STATE];
  updateSetSysId?: string;
  updateSetName?: string;
  applied: AppliedChange[];
  error?: string;
}

const asJson = (v: AppliedChange[]): Prisma.InputJsonValue => v as unknown as Prisma.InputJsonValue;

class Log {
  private lines: string[] = [];
  section(title: string, body = ""): void {
    this.lines.push(`\n## ${title}\n${body ? `\n${body}\n` : ""}`);
  }
  line(s: string): void {
    this.lines.push(s);
  }
  toString(): string {
    return this.lines.join("\n");
  }
}

/** Build the encoded coalesce query from the *already-resolved* field values. */
function coalesceQuery(change: Change, resolved: Record<string, string | number | boolean>): string | undefined {
  if (!change.coalesce || Object.keys(change.coalesce).length === 0) return undefined;
  const parts: string[] = [];
  for (const [field, src] of Object.entries(change.coalesce)) {
    const v = resolved[src] ?? resolved[field];
    if (v === undefined) throw new Error(`change "${change.id}": coalesce key "${field}" has no resolved field value`);
    parts.push(`${field}=${v}`);
  }
  return parts.join("^");
}

async function resolveFields(
  fields: Record<string, FieldValue>,
  ctx: { client: SnowClient; refSysIds: Map<string, string>; changeId: string },
): Promise<Record<string, string | number | boolean>> {
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(fields)) {
    out[k] = await resolveOne(v, k, ctx);
  }
  return out;
}

async function resolveOne(
  v: FieldValue,
  key: string,
  ctx: { client: SnowClient; refSysIds: Map<string, string>; changeId: string },
): Promise<string | number | boolean> {
  if (isRef(v)) {
    const sysId = ctx.refSysIds.get(v.$ref);
    if (!sysId) throw new Error(`change "${ctx.changeId}" field "${key}": $ref "${v.$ref}" has no applied sys_id yet`);
    return sysId;
  }
  if (isLookup(v)) {
    const field = v.$lookup.field ?? "sys_id";
    const row = await ctx.client.table.getOne<Record<string, unknown>>(v.$lookup.table, {
      query: v.$lookup.query,
      fields: `sys_id,${field}`,
    });
    if (!row) throw new Error(`change "${ctx.changeId}" field "${key}": $lookup ${v.$lookup.table} (${v.$lookup.query}) matched nothing`);
    return String(row[field] ?? "");
  }
  return v;
}

export interface ApplyOpts {
  ticketId: string;
  instance: Instance;
  plan: ChangePlan;
  /** Absolute path to the native ticket dir holding the plan's `script.file`s. */
  scriptsDir: string;
  actorId?: string | null;
}

export async function applyChangePlan(opts: ApplyOpts): Promise<ApplyResult> {
  const { ticketId, instance, scriptsDir } = opts;
  const log = new Log();
  const applied: AppliedChange[] = [];
  const refSysIds = new Map<string, string>();

  log.section(
    "Native apply",
    `Instance: ${instance.name} (${instance.url}) · env: ${instance.env}\n` +
      `Scope: ${opts.plan.scope} · Update set: ${opts.plan.updateSetName}\n` +
      `Started: ${new Date().toISOString()}`,
  );

  const fail = async (message: string, state: ApplyResult["state"] = NATIVE_DEPLOY_STATE.APPLY_FAILED): Promise<ApplyResult> => {
    log.section("FAILED", message);
    await flushLog(ticketId, log.toString());
    await prisma.nativeDeployment.updateMany({ where: { ticketId }, data: { state, appliedChanges: asJson(applied) } });
    return { ok: false, state, applied, error: message };
  };

  // 1. dev only
  if (instance.env !== "dev") {
    return fail(`refusing to apply to a non-dev instance (env="${instance.env}") — brief §5.4 / §8`);
  }
  // Phase 5 supports the Global route only.
  if (opts.plan.scope !== "global") {
    return fail(`native apply currently supports the Global route only; plan scope is "${opts.plan.scope}" (scoped-app apply is Phase 6)`);
  }

  const client = SnowClient.forInstance(instance);

  try {
    // 2. resource installed?
    const session = await probeNativeResource(client);
    if (!session) {
      return fail("the Native Engine Scripted REST resource is not installed — run `pnpm --filter web setup-native-engine <instanceId>`");
    }
    log.line(`Resource reachable as ${session.user}.`);

    // 3. resolve scope
    const scope = await resolveScope(client, opts.plan.scope);
    log.line(`Resolved scope "${opts.plan.scope}" → ${scope.sysId} (${scope.name}).`);

    // 4. inline script files
    const plan = resolveScripts(opts.plan, scriptsDir);

    // 5. order
    const order = orderChanges(plan);
    const byId = new Map(plan.changes.map((c) => [c.id, c]));

    // 6. create the update set + leakage baseline
    const us = await createUpdateSet(client, { name: plan.updateSetName, scopeSysId: scope.sysId });
    log.section("Update set", `Created \`${us.name}\` (${us.sysId}) in scope ${scope.name}.`);
    const def = await defaultUpdateSet(client, scope.sysId);
    const defaultBaseline = def ? await updateCount(client, def.sysId) : 0;

    await prisma.nativeDeployment.upsert({
      where: { ticketId },
      create: {
        ticketId,
        instanceId: instance.id,
        scope: opts.plan.scope,
        scopeSysId: scope.sysId,
        updateSetSysId: us.sysId,
        updateSetName: us.name,
        state: NATIVE_DEPLOY_STATE.APPLYING,
        appliedChanges: [],
      },
      update: {
        instanceId: instance.id,
        scope: opts.plan.scope,
        scopeSysId: scope.sysId,
        updateSetSysId: us.sysId,
        updateSetName: us.name,
        state: NATIVE_DEPLOY_STATE.APPLYING,
        appliedChanges: [],
      },
    });

    // 7. apply each change in order
    log.section("Changes");
    for (const id of order) {
      const change = byId.get(id)!;
      const fields = await resolveFields(change.fields, { client, refSysIds, changeId: id });
      const cq = coalesceQuery(change, fields);

      const r = await applyOneChange(client, {
        scopeSysId: scope.sysId,
        updateSetSysId: us.sysId,
        change: { table: change.table, op: change.op, coalesceQuery: cq, sysId: change.sysId, fields },
      });
      if (!r.ok || !r.sysId) {
        return fail(`change "${id}" → ${change.table}: ${r.error ?? "apply returned no sys_id"}${r.wanted ? ` (wanted ${r.wanted}, got ${r.got})` : ""}`);
      }
      refSysIds.set(id, r.sysId);
      applied.push({ changeId: id, table: change.table, sysId: r.sysId, operation: r.operation ?? "inserted" });
      log.line(`- \`${change.table}\` ${r.operation} → ${r.sysId}  (${change.id})`);
    }

    // 8. leakage check. A freshly *inserted* record must produce a
    //    sys_update_xml row in our set — if it didn't, the write leaked. A
    //    no-op coalesce *update* (re-applying an unchanged plan) legitimately
    //    captures nothing, so only inserts are asserted here.
    const captured = await capturedUpdates(client, us.sysId);
    const capturedBlob = captured.map((c) => c.name).join("\n");
    const notCaptured = applied.filter((a) => a.operation === "inserted" && !capturedBlob.includes(a.sysId));
    if (notCaptured.length) {
      return fail(`update set did not capture new record(s): ${notCaptured.map((a) => `${a.table}/${a.sysId}`).join(", ")} — writes may have leaked`);
    }
    await assertNoLeakage(client, {
      updateSetSysId: us.sysId,
      scopeSysId: scope.sysId,
      expectedTargets: [],
      defaultSetBaseline: defaultBaseline,
    });
    const inserts = applied.filter((a) => a.operation === "inserted").length;
    log.section(
      "Leakage check",
      `✓ ${captured.length} update(s) captured in \`${us.name}\` (${inserts} insert(s), ${applied.length - inserts} coalesce-update(s)); nothing in the scope Default set.`,
    );

    // 9. complete the set
    await completeUpdateSet(client, us.sysId);
    log.line(`Update set marked complete.`);

    // 10. verify the records
    const verification = await verifyNativeRecords(client, {
      created: applied.map((a) => ({ changeId: a.changeId, table: a.table, sysId: a.sysId })),
      expectedScopeSysId: scope.sysId,
      expectedScopeName: scope.scope,
    });
    await upsertArtifact(ticketId, ARTIFACT_TYPE.DEPLOY_VERIFICATION, verification.markdown);
    if (!verification.confirmed) {
      return fail(`records applied but verification failed: ${verification.reason}`);
    }

    // 11. persist + log
    await prisma.nativeDeployment.update({
      where: { ticketId },
      data: { state: NATIVE_DEPLOY_STATE.APPLIED, appliedChanges: asJson(applied) },
    });
    await prisma.ticket.update({ where: { id: ticketId }, data: { releaseGate: RELEASE_GATE.DEV } });

    log.section("Requests", requestTable(client));
    log.section("Result", `✓ APPLIED — ${applied.length} record(s) in \`${us.name}\`.`);
    await flushLog(ticketId, log.toString());

    return { ok: true, state: NATIVE_DEPLOY_STATE.APPLIED, updateSetSysId: us.sysId, updateSetName: us.name, applied };
  } catch (e) {
    const msg = e instanceof SnowError ? e.message : e instanceof Error ? (e.stack ?? e.message) : String(e);
    log.section("Requests", requestTable(client));
    return fail(msg);
  }
}

function requestTable(client: SnowClient): string {
  const rows = client.requestLog.map(
    (r) => `${r.method.padEnd(6)} ${r.path}${r.query ? `?${new URLSearchParams(r.query).toString()}` : ""}  → ${r.status} (${r.ms}ms)`,
  );
  return "```text\n" + rows.join("\n") + "\n```";
}

async function flushLog(ticketId: string, content: string): Promise<void> {
  await upsertArtifact(ticketId, ARTIFACT_TYPE.DEPLOY_LOG, `# Native deploy log\n${content}\n`);
}

async function upsertArtifact(ticketId: string, type: string, content: string): Promise<void> {
  const existing = await prisma.artifact.findFirst({ where: { ticketId, type } });
  if (existing) await prisma.artifact.update({ where: { id: existing.id }, data: { content } });
  else await prisma.artifact.create({ data: { ticketId, type, content } });
}

/** The names/titles a plan's changes would show in a captured update — for logs. */
export function changeTargetNames(plan: ChangePlan): string[] {
  return plan.changes
    .map((c) => {
      const spec = ALLOWED[c.table];
      const key = spec?.coalesce[0] ?? "name";
      const v = c.fields[key] ?? c.fields.name ?? c.fields.title ?? c.fields.short_description;
      return typeof v === "string" ? v : null;
    })
    .filter((s): s is string => !!s);
}
