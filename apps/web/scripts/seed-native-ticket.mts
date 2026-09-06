/**
 * Seed a ready-to-approve native-tier ticket for end-to-end testing of the
 * apply / verify / promote flow (NATIVE_ENGINE_BRIEF Phase 5), before the
 * router (Phase 6) and Developer prompt (Phase 7) exist to produce one.
 *
 *   pnpm --filter web seed-native-ticket
 *
 * Creates a READY_FOR_REVIEW ticket for the demo customer's dev instance with
 * executionTier = NATIVE_GLOBAL, the laptop-request fixture as its CHANGE_PLAN
 * artifact, and the fixture's script file copied into the native ticket dir.
 * Prints the ticket id — then click Approve, or run `apply-plan <ticketId>`.
 */
import "@/lib/config";
import fs from "node:fs";
import path from "node:path";
import { prisma } from "@/lib/db";
import { REPO_ROOT } from "@/lib/config";
import { ARTIFACT_TYPE, TICKET_STATUS } from "@/lib/constants";
import { DEMO_CUSTOMER_SLUG } from "@/lib/projects/resolve";
import { ticketDirName, ticketBranchName } from "@/lib/pipeline/parse";
import { nativeTicketDir, writeScriptFiles } from "@/lib/nativeengine/scripts";

const FIXTURE_DIR = path.join(REPO_ROOT, "apps/web/src/lib/nativeengine/fixtures");

async function main() {
  const customer = await prisma.customer.findUniqueOrThrow({
    where: { slug: DEMO_CUSTOMER_SLUG },
    include: { instances: true },
  });
  const instance = customer.instances.find((i) => i.env === "dev");
  if (!instance) throw new Error(`demo customer has no dev instance — run seed-demo-customer first`);

  const plan = fs.readFileSync(path.join(FIXTURE_DIR, "laptop-request.plan.json"), "utf8");
  const scriptBody = fs.readFileSync(path.join(FIXTURE_DIR, "laptop-request.approver.js"), "utf8");

  const title = "Laptop request (native demo)";
  const ticket = await prisma.ticket.create({
    data: {
      title,
      description: "Native-engine demo: a Laptop request catalog item + variables, a script include, notifications and an ATF suite — all Global, one update set.",
      status: TICKET_STATUS.READY_FOR_REVIEW,
      targetScope: "global",
      executionTier: "NATIVE_GLOBAL",
      routeScope: "global",
      tierRationale: "Seeded by seed-native-ticket.mts — Global native route.",
      customerId: customer.id,
      instanceId: instance.id,
    },
  });

  const ticketDir = ticketDirName(ticket.id, title);
  await prisma.ticket.update({ where: { id: ticket.id }, data: { gitBranch: ticketBranchName(ticketDir) } });

  await prisma.artifact.create({ data: { ticketId: ticket.id, type: ARTIFACT_TYPE.CHANGE_PLAN, content: plan } });

  const dir = nativeTicketDir(customer.slug, ticketDir);
  writeScriptFiles(dir, [{ path: "laptop-request.approver.js", content: scriptBody }]);

  console.log(`✓ ticket ${ticket.id}`);
  console.log(`  native dir: ${dir}`);
  console.log(`\nNext:`);
  console.log(`  pnpm --filter web setup-native-engine ${instance.id}   # once per instance`);
  console.log(`  pnpm --filter web apply-plan ${ticket.id}`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error("\nSEED FAILED:", e instanceof Error ? (e.stack ?? e.message) : e);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
