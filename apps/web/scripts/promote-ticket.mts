/**
 * Promote a native deployment dev→test or test→prod (NATIVE_ENGINE_BRIEF §5.3).
 *
 *   pnpm --filter web promote-ticket <ticketId> TEST
 *   pnpm --filter web promote-ticket <ticketId> PROD
 *
 * PROD requires `changeRequestRef` on the ticket. The instances are resolved
 * from the ticket's customer by env. This is the same code the promote API
 * route calls — never an agent tool.
 */
import "@/lib/config";
import { prisma } from "@/lib/db";
import { RELEASE_GATE } from "@/lib/constants";
import { promote } from "@/lib/nativeengine/promote";

async function main() {
  const ticketId = process.argv[2];
  const toGate = (process.argv[3] ?? "").toUpperCase();
  if (!ticketId || (toGate !== "TEST" && toGate !== "PROD")) {
    throw new Error("usage: promote-ticket <ticketId> <TEST|PROD>");
  }

  const ticket = await prisma.ticket.findUniqueOrThrow({
    where: { id: ticketId },
    include: { customer: { include: { instances: true } }, nativeDeployment: true },
  });
  if (!ticket.nativeDeployment) throw new Error("ticket has no native deployment");
  if (toGate === "PROD" && !ticket.changeRequestRef) throw new Error("PROD promotion requires ticket.changeRequestRef");

  const fromEnv = toGate === "TEST" ? "dev" : "test";
  const toEnv = toGate === "TEST" ? "test" : "prod";
  const instances = ticket.customer?.instances ?? [];
  const fromInstance =
    instances.find((i) => i.id === ticket.nativeDeployment!.instanceId) ?? instances.find((i) => i.env === fromEnv);
  const toInstance = instances.find((i) => i.env === toEnv);
  if (!fromInstance) throw new Error(`no ${fromEnv} instance for this customer`);
  if (!toInstance) throw new Error(`no ${toEnv} instance for this customer`);

  console.log(`Promoting ${ticketId}: ${fromInstance.name} → ${toInstance.name} (${toGate})`);
  const result = await promote({ ticketId, fromInstance, toInstance, toGate: RELEASE_GATE[toGate] });

  const log = await prisma.artifact.findFirst({ where: { ticketId, type: "PROMOTE_LOG" } });
  if (log) console.log("\n" + log.content);
  const problems = await prisma.artifact.findFirst({ where: { ticketId, type: "PREVIEW_PROBLEMS" } });
  if (problems) console.log("\n" + problems.content);

  console.log(result.ok ? `\n✓ promoted to ${toGate}` : `\n✗ ${result.blocked ? "BLOCKED" : "FAILED"}: ${result.error}`);
  await prisma.$disconnect();
  process.exit(result.ok ? 0 : 1);
}

main().catch(async (e) => {
  console.error("\nPROMOTE FAILED:", e instanceof Error ? (e.stack ?? e.message) : e);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
