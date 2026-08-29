/**
 * Dev-only manual deploy harness (sanctioned by BUILD_PROMTP.md — "write a
 * separate dev-only script"). It skips the UI click, NOT the gate: deployTicket
 * still hard-requires READY_FOR_REVIEW. Running this IS the human action.
 *
 *   pnpm --filter web exec tsx scripts/deploy-dev.mts <ticketId>
 */
import "@/lib/config";
import { prisma } from "@/lib/db";
import { deployTicket } from "@/lib/pipeline/deploy";

const id = process.argv[2];
if (!id) {
  console.error("usage: deploy-dev.mts <ticketId>");
  process.exit(2);
}

const t = await prisma.ticket.findUnique({ where: { id } });
if (!t) {
  console.error(`ticket ${id} not found`);
  process.exit(1);
}
console.log(`\nTicket: ${t.title}\nStatus: ${t.status}`);
if (t.status !== "READY_FOR_REVIEW") {
  console.error("Refusing: only READY_FOR_REVIEW tickets can be deployed.");
  process.exit(1);
}
console.log("\nBuilding + deploying to the PDI…\n");

const res = await deployTicket(id);
console.log("\n" + JSON.stringify(res, null, 2));

const log = await prisma.artifact.findFirst({ where: { ticketId: id, type: "DEPLOY_LOG" } });
if (log) {
  console.log("\n" + "═".repeat(70) + "\nDEPLOY LOG\n" + "═".repeat(70));
  console.log(log.content);
}
const ver = await prisma.artifact.findFirst({ where: { ticketId: id, type: "DEPLOY_VERIFICATION" } });
if (ver) {
  console.log("\n" + "═".repeat(70) + "\nDEPLOY VERIFICATION\n" + "═".repeat(70));
  console.log(ver.content);
}

await prisma.$disconnect();
process.exit(res.ok ? 0 : 1);
