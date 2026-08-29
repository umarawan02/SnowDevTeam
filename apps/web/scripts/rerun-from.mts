/**
 * Dev-only: re-run a ticket's pipeline from a given stage onward, reusing the
 * artifacts of the earlier stages. For iterating on the Developer prompt without
 * paying for BA/Architect/SrDev again.
 *
 *   pnpm --filter web exec tsx scripts/rerun-from.mts <ticketId> DEVELOPER
 */
import "@/lib/config";
import { prisma } from "@/lib/db";
import { AGENT_ROLES } from "@/lib/constants";
import { ROLE_META } from "@/lib/ui";
import { runPipeline } from "@/lib/pipeline/run";

const id = process.argv[2];
const fromRole = process.argv[3] as (typeof AGENT_ROLES)[number] | undefined;
if (!id || !fromRole || !AGENT_ROLES.includes(fromRole)) {
  console.error(`usage: rerun-from.mts <ticketId> <${AGENT_ROLES.join("|")}>`);
  process.exit(2);
}

const fromOrder = ROLE_META[fromRole].order;
const rolesToReset = AGENT_ROLES.filter((r) => ROLE_META[r].order >= fromOrder);
const artifactsToReset = rolesToReset.map((r) => ROLE_META[r].artifactType);

const ds = await prisma.agentStep.deleteMany({ where: { ticketId: id, role: { in: rolesToReset } } });
const da = await prisma.artifact.deleteMany({ where: { ticketId: id, type: { in: artifactsToReset } } });
// also drop any deploy artifacts from a prior attempt
await prisma.artifact.deleteMany({
  where: { ticketId: id, type: { in: ["DEPLOY_LOG", "DEPLOY_VERIFICATION"] } },
});
await prisma.ticket.update({ where: { id }, data: { status: "FAILED", reviewNote: null } });

console.log(`reset ${ds.count} steps + ${da.count} artifacts (${rolesToReset.join(", ")}); resuming…\n`);

const started = Date.now();
const res = await runPipeline(id, { resume: true });
console.log(`\n${res.ok ? "OK" : "FAILED"} — ${((Date.now() - started) / 60000).toFixed(1)} min`);
if (!res.ok) console.log(`  ${res.failedRole ?? "?"}: ${res.error}`);

await prisma.$disconnect();
process.exit(res.ok ? 0 : 1);
