import { SnowClient } from "@/lib/servicenow/client";

/**
 * Shared helpers for the `scripts/smoke-*.mts` PDI probes (NATIVE_ENGINE_BRIEF
 * Phase 3, "Open items"). Every record a smoke creates is named `SMOKE-…` and
 * torn down in a `finally`; `cleanupSmoke` is the safety net.
 */

export const SMOKE_PREFIX = "SMOKE-";

export function smokeName(suffix: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "").slice(0, 15); // YYYYMMDDTHHMMSS
  return `${SMOKE_PREFIX}${stamp}-${suffix}`;
}

/** An inert business rule — never runs (`condition:'false'`, `active:false`). */
export function inertBusinessRule(name: string): Record<string, unknown> {
  return {
    name,
    collection: "sys_user",
    when: "before",
    active: "false",
    condition: "false",
    order: "100",
    description: "SnowDevTeam smoke test — safe to delete",
    script: "(function executeRule(current, previous) { /* SMOKE - no-op */ })(current, previous);",
  };
}

export type SmokeStatus = "PASS" | "FAIL" | "INCONCLUSIVE";

export interface Verdict {
  name: string;
  openItem: string;
  status: SmokeStatus;
  finding: string;
  detail?: string;
  action?: string;
}

export function printVerdict(v: Verdict): void {
  console.log("");
  console.log(`=== SMOKE: ${v.name}  (${v.openItem}) ===`);
  console.log(`verdict : ${v.status}`);
  console.log(`finding : ${v.finding}`);
  if (v.detail) console.log(`detail  : ${v.detail}`);
  if (v.action) console.log(`action  : ${v.action}`);
}

/** Delete every SMOKE-prefixed record this project may have left behind. */
export async function cleanupSmoke(client: SnowClient): Promise<string[]> {
  const removed: string[] = [];
  for (const table of ["sys_script", "sys_update_set", "sysevent_email_action"]) {
    const rows = await client.table.list<{ sys_id: string; name: string }>(table, {
      query: `nameSTARTSWITH${SMOKE_PREFIX}`,
      fields: "sys_id,name",
      limit: 200,
    });
    for (const r of rows) {
      await client.table.del(table, r.sys_id).catch(() => {});
      removed.push(`${table}/${r.name}`);
    }
  }
  return removed;
}
