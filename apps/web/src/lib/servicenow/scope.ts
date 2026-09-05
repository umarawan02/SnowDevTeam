import { SnowClient, SnowError } from "@/lib/servicenow/client";

/**
 * Current-application control (NATIVE_ENGINE_BRIEF Phase 3, §3.2). Record scope
 * on a Table API write comes from the caller's *current application* — the
 * `sys_user_preference` row named `apps.current_app`. Set it via the
 * concoursepicker endpoint (more reliable than a raw preference write) and
 * always verify before doing any writes.
 */

export const CURRENT_APP_PREF = "apps.current_app";

export interface ResolvedScope {
  sysId: string;
  name: string;
  scope: string;
}

export class ScopeNotSetError extends Error {
  constructor(
    public readonly wanted: string,
    public readonly got: string | null,
  ) {
    super(`current application is "${got ?? "(unset)"}", expected "${wanted}" — refusing to write`);
    this.name = "ScopeNotSetError";
  }
}

/**
 * `"global"` or an `x_…` / `sn_…` scope name → the `sys_scope` row. NOTE:
 * several rows can have `scope=global` (any customer-owned global-scoped app),
 * so `"global"` resolves the base Global scope by its fixed sys_id `global`.
 */
export async function resolveScope(client: SnowClient, scopeName: string): Promise<ResolvedScope> {
  const query = scopeName === "global" ? "sys_id=global" : `scope=${scopeName}`;
  const row = await client.table.getOne<{ sys_id: string; name: string; scope: string }>("sys_scope", {
    query,
    fields: "sys_id,name,scope",
  });
  if (!row) throw new SnowError({ kind: "NOT_FOUND", status: 404, message: `no sys_scope for ${scopeName}` });
  return { sysId: row.sys_id, name: row.name, scope: row.scope };
}

const userCache = new WeakMap<SnowClient, string>();

/** sys_id of the user this client authenticates as. Cached per client. */
export async function getDeployUserSysId(client: SnowClient): Promise<string> {
  const cached = userCache.get(client);
  if (cached) return cached;

  const res = await client.get<{ result?: { user_sys_id?: string } } & { user_sys_id?: string }>(
    "/api/now/ui/user/current_user",
  );
  const sysId =
    (res.body as { result?: { user_sys_id?: string } })?.result?.user_sys_id ??
    (res.body as { user_sys_id?: string })?.user_sys_id;
  if (!sysId) {
    throw new SnowError({
      kind: res.error?.kind ?? "UNKNOWN",
      status: res.status,
      message: "could not resolve the current user sys_id from /api/now/ui/user/current_user",
    });
  }
  userCache.set(client, sysId);
  return sysId;
}

async function readCurrentAppPref(client: SnowClient, userSysId: string): Promise<string | null> {
  const row = await client.table.getOne<{ value: string }>("sys_user_preference", {
    query: `user=${userSysId}^name=${CURRENT_APP_PREF}`,
    fields: "value",
  });
  return row?.value ?? null;
}

/**
 * Set the current application to `scopeSysId` via the concoursepicker endpoint,
 * then verify by reading the preference back. Throws `ScopeNotSetError` on
 * mismatch — the caller must NOT proceed to writes.
 *
 * SMOKE FINDING (dev424712 / Australia, `docs/servicenow-smoke-findings.md`
 * open item #1): concoursepicker does **not** re-scope Table API writes for a
 * stateless REST session (basic *or* OAuth client-credentials) — this call
 * correctly throws. Phase 4/5 must either (a) pass `sysparm_transaction_scope`
 * on each write (works on Australia, undocumented, forbidden by the brief), or
 * (b) route writes through a server-side scripted REST resource. Decision
 * pending.
 */
export async function setCurrentApplication(client: SnowClient, scopeSysId: string): Promise<void> {
  const put = await client.put("/api/now/ui/concoursepicker/application", { body: { app_id: scopeSysId } });
  if (!put.ok) throw new SnowError(put.error ?? { kind: "UNKNOWN", status: put.status, message: "concoursepicker PUT failed" });

  const userSysId = await getDeployUserSysId(client);
  const got = await readCurrentAppPref(client, userSysId);
  if (got !== scopeSysId) throw new ScopeNotSetError(scopeSysId, got);
}
