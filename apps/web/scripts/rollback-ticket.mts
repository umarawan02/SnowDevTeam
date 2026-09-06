/**
 * Roll back a native deployment's update set on one instance (admin action,
 * NATIVE_ENGINE_BRIEF §5.3).
 *
 *   pnpm --filter web rollback-ticket <ticketId> [dev|test|prod]   (default dev)
 */
import "@/lib/config";
import { prisma } from "@/lib/db";
import { backOut } from "@/lib/nativeengine/promote";

async function main() {
  const ticketId = process.argv[2];
  const env = (process.argv[3] ?? "dev").toLowerCase();
  if (!ticketId || !["dev", "test", "prod"].includes(env)) throw new Error("usage: rollback-ticket <ticketId> [dev|test|prod]");

  const ticket = await prisma.ticket.findUniqueOrThrow({
    where: { id: ticketId },
    include: { customer: { include: { instances: true } }, nativeDeployment: true },
  });
  const dep = ticket.nativeDeployment;
  if (!dep) throw new Error("ticket has no native deployment");

  const instances = ticket.customer?.instances ?? [];
  const instance = env === "dev" ? instances.find((i) => i.id === dep.instanceId) : instances.find((i) => i.env === env);
  if (!instance) throw new Error(`no ${env} instance for this customer`);

  const updateSetSysId =
    env === "dev" ? dep.updateSetSysId : env === "test" ? (dep.remoteUpdateSetTest ?? dep.updateSetSysId) : (dep.remoteUpdateSetProd ?? dep.updateSetSysId);

  console.log(`Rolling back ${ticketId} on ${instance.name} (${env}) — update set ${updateSetSysId}`);
  const result = await backOut({ ticketId, instance, updateSetSysId });
  console.log(result.ok ? "✓ backed out" : `✗ ${result.error}`);
  await prisma.$disconnect();
  process.exit(result.ok ? 0 : 1);
}

main().catch(async (e) => {
  console.error("\nROLLBACK FAILED:", e instanceof Error ? (e.stack ?? e.message) : e);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
