import { SnowClient, SnowError } from "@/lib/servicenow/client";
import { getDeployUserSysId } from "@/lib/servicenow/scope";

/**
 * Update-set lifecycle (NATIVE_ENGINE_BRIEF Phase 3, §3.3). An update set
 * belongs to exactly one application scope; writes made while a *different*
 * scope is current land silently in that scope's **Default** set. The engine
 * must detect that (`assertNoLeakage`).
 */

/**
 * The `sys_user_preference` name for the current update set — confirmed to be
 * `sys_update_set` on the PDI.
 *
 * SMOKE FINDING (`docs/servicenow-smoke-findings.md` open item #2): a plain
 * preference write is *stored* but **not honoured** — Table API writes still
 * land in the target scope's Default update set. `setCurrentUpdateSet` below
 * therefore correctly throws; Phase 5 needs a server-side scripted
 * `GlideUpdateSet.setCurrent` REST resource. `sn_cicd/update_set/create`
 * (open item #3) creates a set but likewise does not make it current.
 */
export const CURRENT_UPDATE_SET_PREF = "sys_update_set";

export interface UpdateSetRef {
  sysId: string;
  name: string;
}

export interface CapturedUpdate {
  name: string;
  type: string;
  target_name: string;
  sys_id: string;
}

export class UpdateSetNotCurrentError extends Error {
  constructor(wanted: string, got: string | null) {
    super(`current update set is "${got ?? "(unset)"}", expected "${wanted}"`);
    this.name = "UpdateSetNotCurrentError";
  }
}

export class LeakageError extends Error {
  constructor(
    message: string,
    public readonly details: { missingTargets: string[]; leakedToDefault: CapturedUpdate[] },
  ) {
    super(message);
    this.name = "LeakageError";
  }
}

/** `SDT-<shortId> <title>` truncated to a sane length. */
export function updateSetName(ticketShortId: string, title: string): string {
  return `SDT-${ticketShortId} ${title}`.slice(0, 80).trim();
}

export async function createUpdateSet(
  client: SnowClient,
  opts: { name: string; description?: string; scopeSysId: string },
): Promise<UpdateSetRef> {
  const row = await client.table.insert<{ sys_id: string; name: string }>("sys_update_set", {
    name: opts.name,
    description: opts.description ?? "",
    application: opts.scopeSysId,
    state: "in progress",
  });
  return { sysId: row.sys_id, name: row.name };
}

async function readCurrentUpdateSetPref(client: SnowClient, userSysId: string): Promise<string | null> {
  const row = await client.table.getOne<{ value: string }>("sys_user_preference", {
    query: `user=${userSysId}^name=${CURRENT_UPDATE_SET_PREF}`,
    fields: "value",
  });
  return row?.value ?? null;
}

/** Write the current-update-set preference, then verify by reading it back. */
export async function setCurrentUpdateSet(client: SnowClient, updateSetSysId: string): Promise<void> {
  const userSysId = await getDeployUserSysId(client);
  const existing = await client.table.getOne<{ sys_id: string }>("sys_user_preference", {
    query: `user=${userSysId}^name=${CURRENT_UPDATE_SET_PREF}`,
    fields: "sys_id",
  });
  if (existing) {
    await client.table.update("sys_user_preference", existing.sys_id, { value: updateSetSysId });
  } else {
    await client.table.insert("sys_user_preference", {
      user: userSysId,
      name: CURRENT_UPDATE_SET_PREF,
      value: updateSetSysId,
      type: "string",
    });
  }
  const got = await readCurrentUpdateSetPref(client, userSysId);
  if (got !== updateSetSysId) throw new UpdateSetNotCurrentError(updateSetSysId, got);
}

export async function capturedUpdates(client: SnowClient, updateSetSysId: string): Promise<CapturedUpdate[]> {
  return client.table.list<CapturedUpdate>("sys_update_xml", {
    query: `update_set=${updateSetSysId}`,
    fields: "name,type,target_name,sys_id",
    limit: 500,
  });
}

/** The Default update set for a scope (created lazily by ServiceNow; may not exist yet). */
export async function defaultUpdateSet(client: SnowClient, scopeSysId: string): Promise<UpdateSetRef | null> {
  const row = await client.table.getOne<{ sys_id: string; name: string }>("sys_update_set", {
    query: `application=${scopeSysId}^name=Default`,
    fields: "sys_id,name",
  });
  return row ? { sysId: row.sys_id, name: row.name } : null;
}

/** Count of updates currently in a set — used as a leakage baseline. */
export async function updateCount(client: SnowClient, updateSetSysId: string): Promise<number> {
  const rows = await client.table.list<{ sys_id: string }>("sys_update_xml", {
    query: `update_set=${updateSetSysId}`,
    fields: "sys_id",
    limit: 1000,
  });
  return rows.length;
}

/**
 * Every expected artefact appears in the ticket's set, and nothing new landed
 * in the scope's Default set since `defaultSetBaseline`. Throws `LeakageError`.
 */
export async function assertNoLeakage(
  client: SnowClient,
  opts: {
    updateSetSysId: string;
    scopeSysId: string;
    expectedTargets: string[];
    defaultSetBaseline: number;
  },
): Promise<void> {
  const captured = await capturedUpdates(client, opts.updateSetSysId);
  const capturedNames = new Set(captured.map((c) => c.target_name));
  const missingTargets = opts.expectedTargets.filter((t) => !capturedNames.has(t));

  const def = await defaultUpdateSet(client, opts.scopeSysId);
  let leakedToDefault: CapturedUpdate[] = [];
  if (def) {
    const defUpdates = await capturedUpdates(client, def.sysId);
    if (defUpdates.length > opts.defaultSetBaseline) {
      leakedToDefault = defUpdates.slice(opts.defaultSetBaseline);
    }
  }

  if (missingTargets.length || leakedToDefault.length) {
    throw new LeakageError(
      `update-set leakage: ${missingTargets.length} expected target(s) not captured, ` +
        `${leakedToDefault.length} update(s) landed in the scope Default set`,
      { missingTargets, leakedToDefault },
    );
  }
}

export async function completeUpdateSet(client: SnowClient, updateSetSysId: string): Promise<void> {
  const res = await client.patch(`/api/now/table/sys_update_set/${updateSetSysId}`, { body: { state: "complete" } });
  if (!res.ok) throw new SnowError(res.error ?? { kind: "UNKNOWN", status: res.status, message: "completeUpdateSet failed" });
}
