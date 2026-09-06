/**
 * Apply a native-engine change plan to a dev instance (NATIVE_ENGINE_BRIEF §5).
 *
 *   pnpm --filter web apply-plan <ticketId>
 *   pnpm --filter web apply-plan --fixture <plan.json> <instanceId>
 *
 * The ticket form mirrors the Approve button: it requires a READY_FOR_REVIEW
 * native-tier ticket with a CHANGE_PLAN artifact. The --fixture form is for
 * testing a bare plan (scripts resolved from the plan file's directory).
 * apply.ts refuses any instance whose env !== "dev".
 */
import "@/lib/config";
import fs from "node:fs";
import path from "node:path";
import { prisma } from "@/lib/db";
import { ARTIFACT_TYPE } from "@/lib/constants";
import { validatePlan } from "@/lib/nativeengine/plan";
import { applyChangePlan } from "@/lib/nativeengine/apply";
import { nativeTicketDir } from "@/lib/nativeengine/scripts";
import { ticketDirName } from "@/lib/pipeline/parse";

function hr() {
  console.log("─".repeat(70));
}

async function main() {
  const args = process.argv.slice(2);
  const fixtureIdx = args.indexOf("--fixture");

  if (fixtureIdx >= 0) {
    const planPath = path.resolve(args[fixtureIdx + 1] ?? "");
    const instanceId = args[fixtureIdx + 2];
    if (!fs.existsSync(planPath) || !instanceId) throw new Error("usage: apply-plan --fixture <plan.json> <instanceId>");
    const instance = await prisma.instance.findUniqueOrThrow({ where: { id: instanceId } });
    const validation = validatePlan(JSON.parse(fs.readFileSync(planPath, "utf8")));
    if (!validation.ok || !validation.plan) throw new Error(`plan invalid: ${validation.errors.join("; ")}`);

    // a throwaway ticket so apply.ts has somewhere to hang artifacts
    const ticket = await prisma.ticket.create({
      data: { title: `[fixture] ${path.basename(planPath)}`, description: "apply-plan --fixture", status: "READY_FOR_REVIEW", executionTier: "NATIVE_GLOBAL", instanceId: instance.id },
    });
    hr();
    console.log(`fixture apply → ticket ${ticket.id} → ${instance.name} (${instance.env})`);
    hr();
    const result = await applyChangePlan({ ticketId: ticket.id, instance, plan: validation.plan, scriptsDir: path.dirname(planPath) });
    await report(ticket.id, result.ok, result.error);
    process.exit(result.ok ? 0 : 1);
  }

  const ticketId = args[0];
  if (!ticketId) throw new Error("usage: apply-plan <ticketId>  |  apply-plan --fixture <plan.json> <instanceId>");

  const ticket = await prisma.ticket.findUniqueOrThrow({
    where: { id: ticketId },
    include: { artifacts: true, instance: true, customer: true },
  });
  if (!ticket.instance) throw new Error("ticket has no instance");
  if (!ticket.customer) throw new Error("ticket has no customer");
  const planArtifact = ticket.artifacts.find((a) => a.type === ARTIFACT_TYPE.CHANGE_PLAN);
  if (!planArtifact) throw new Error("ticket has no CHANGE_PLAN artifact");

  const validation = validatePlan(JSON.parse(planArtifact.content));
  if (!validation.ok || !validation.plan) throw new Error(`CHANGE_PLAN invalid: ${validation.errors.join("; ")}`);

  const ticketDir = ticket.gitBranch?.replace(/^ticket\//, "") || ticketDirName(ticket.id, ticket.title);
  const scriptsDir = nativeTicketDir(ticket.customer.slug, ticketDir);

  hr();
  console.log(`apply → ticket ${ticket.id} "${ticket.title}" → ${ticket.instance.name} (${ticket.instance.env})`);
  hr();
  const result = await applyChangePlan({ ticketId: ticket.id, instance: ticket.instance, plan: validation.plan, scriptsDir });
  await report(ticket.id, result.ok, result.error);
  process.exit(result.ok ? 0 : 1);
}

async function report(ticketId: string, ok: boolean, error?: string) {
  const log = await prisma.artifact.findFirst({ where: { ticketId, type: ARTIFACT_TYPE.DEPLOY_LOG } });
  if (log) console.log("\n" + log.content);
  const verify = await prisma.artifact.findFirst({ where: { ticketId, type: ARTIFACT_TYPE.DEPLOY_VERIFICATION } });
  if (verify) console.log("\n" + verify.content);
  hr();
  console.log(ok ? "RESULT: APPLIED" : `RESULT: FAILED — ${error ?? "see log"}`);
  hr();
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error("\nAPPLY-PLAN CRASHED:", e instanceof Error ? (e.stack ?? e.message) : e);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
