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

  await setCurrentApplication(client, global.sysId);
  const name = smokeName("txn-scope");
  const created = await client.post<{ result: { sys_id: string } }>("/api/now/table/sys_script", {
    query: scopedSysId ? { sysparm_transaction_scope: scopedSysId } : {},
    body: inertBusinessRule(name),
  });
  const sysId = created.body.result.sys_id;
  const back = await client.table.getOne<{ "sys_scope.scope": string }>("sys_script", {
    sysId,
    fields: "sys_scope.scope",
  });
  await client.table.del("sys_script", sysId).catch(() => {});

  const landed = back?.["sys_scope.scope"] ?? "(unknown)";
  const ignored = landed === "global";
  printVerdict({
    name: "sysparm_transaction_scope effect",
    openItem: "open item #7",
    status: !scopedSysId ? "INCONCLUSIVE" : ignored ? "PASS" : "INCONCLUSIVE",
    finding: !scopedSysId
      ? "no scoped app to target — could not test"
      : ignored
        ? "sysparm_transaction_scope is inert on this release — the write stayed in the current application"
        : `sysparm_transaction_scope RE-SCOPED the write to "${landed}" — this CONTRADICTS the brief ("Do not use / expected: none")`,
    detail: `sent sysparm_transaction_scope=${SCOPED} while Global was current; record landed in scope "${landed}"`,
    action: ignored
      ? "confirmed inert — never reach for it (matches the brief)"
      : "DECISION NEEDED: sysparm_transaction_scope works on this release and may be a simpler scope-control mechanism than a server-side scripted resource — but it is undocumented and the brief forbids it. Raise with the user before Phase 4.",
  });

  await cleanupSmoke(client).catch(() => {});
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error("SMOKE FAILED:", e instanceof Error ? (e.stack ?? e.message) : e);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
