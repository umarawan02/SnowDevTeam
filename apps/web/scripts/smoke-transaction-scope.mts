/**
 * Open item #7 — confirm `sysparm_transaction_scope` has no effect on a Table
 * API write (expected: none), so the engine never reaches for it.
 *
 *   pnpm --filter web tsx scripts/smoke-transaction-scope.mts <instanceId>
 */
import "@/lib/config";
import { prisma } from "@/lib/db";
import { SnowClient } from "@/lib/servicenow/client";
import { resolveScope, setCurrentApplication } from "@/lib/servicenow/scope";
import { inertBusinessRule, smokeName, printVerdict, cleanupSmoke } from "@/lib/servicenow/smoke";

const SCOPED = "x_1460392_delivery";

async function main() {
  const id = process.argv[2];
  if (!id) throw new Error("usage: smoke-transaction-scope <instanceId>");
  const instance = await prisma.instance.findUniqueOrThrow({ where: { id } });
  const client = SnowClient.forInstance(instance);

  const global = await resolveScope(client, "global");
  let scopedSysId: string | null = null;
  try {
    scopedSysId = (await resolveScope(client, SCOPED)).sysId;
  } catch {
    /* absent */
  }

  await setCurrentApplication(client, global.sysId).catch(() => {
    /* concoursepicker is broken headless (open item #1) — the caller's ambient
       scope is used as the control instead */
  });

  // control: a write with NO param — establishes the ambient scope
  const ctrlName = smokeName("txn-control");
  const ctrl = await client.post<{ result: { sys_id: string } }>("/api/now/table/sys_script", {
    body: inertBusinessRule(ctrlName),
  });
  const ctrlBack = await client.table.getOne<{ "sys_scope.scope": string }>("sys_script", {
    sysId: ctrl.body.result.sys_id,
    fields: "sys_scope.scope",
  });
  await client.table.del("sys_script", ctrl.body.result.sys_id).catch(() => {});
  const ambientScope = ctrlBack?.["sys_scope.scope"] ?? "(unknown)";

  // test: same write WITH sysparm_transaction_scope=<a different scope>
  const name = smokeName("txn-scope");
  const created = await client.post<{ result: { sys_id: string } }>("/api/now/table/sys_script", {
    query: scopedSysId ? { sysparm_transaction_scope: scopedSysId } : {},
    body: inertBusinessRule(name),
  });
  const back = await client.table.getOne<{ "sys_scope.scope": string }>("sys_script", {
    sysId: created.body.result.sys_id,
    fields: "sys_scope.scope",
  });
  await client.table.del("sys_script", created.body.result.sys_id).catch(() => {});

  const landed = back?.["sys_scope.scope"] ?? "(unknown)";
  const rescoped = !!scopedSysId && landed === SCOPED && ambientScope !== SCOPED;
  printVerdict({
    name: "sysparm_transaction_scope effect",
    openItem: "open item #7",
    status: !scopedSysId ? "INCONCLUSIVE" : rescoped ? "INCONCLUSIVE" : "PASS",
    finding: !scopedSysId
      ? "no scoped app to target — could not test"
      : rescoped
        ? `sysparm_transaction_scope RE-SCOPED the write ("${ambientScope}" → "${landed}") — CONTRADICTS the brief ("Do not use / expected: none")`
        : `sysparm_transaction_scope is inert — control and test both landed in "${landed}"`,
    detail: `control write (no param) → "${ambientScope}"; test write (sysparm_transaction_scope=${SCOPED}) → "${landed}"`,
    action: rescoped
      ? "DECISION NEEDED: sysparm_transaction_scope works on this release and is a simpler scope-control mechanism than a server-side scripted resource — but it is undocumented and the brief forbids it. Raise with the user before Phase 4."
      : "confirmed inert — never reach for it (matches the brief)",
  });

  await cleanupSmoke(client).catch(() => {});
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error("SMOKE FAILED:", e instanceof Error ? (e.stack ?? e.message) : e);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
