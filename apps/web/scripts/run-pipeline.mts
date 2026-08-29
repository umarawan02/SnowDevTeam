/**
 * Phase 1 end-to-end test harness.
 *
 *   pnpm --filter web pipeline
 *   pnpm --filter web pipeline "Title here" "Description here"
 *   pnpm --filter web pipeline --resume <ticketId>   # rerun only the failed/pending stages
 *
 * Creates (or resumes) a ticket, runs the agent pipeline to completion, then
 * prints every AgentStep and Artifact. Exits non-zero if the pipeline failed.
 */
import "@/lib/config"; // loads + validates env before anything else
import { prisma } from "@/lib/db";
import { createTicket } from "@/lib/tickets";
import { runPipeline } from "@/lib/pipeline/run";
import { parseGeneratedFiles, parseQaVerdict } from "@/lib/pipeline/parse";
import { ARTIFACT_TYPE } from "@/lib/constants";

const DEFAULT_TITLE = "Laptop request with manager approval";
const DEFAULT_DESCRIPTION =
  "Employees need to request a new laptop, with manager approval, that creates a " +
  "fulfillment task for IT ops.";

function hr(char = "─") {
  console.log(char.repeat(78));
}

async function main() {
  const args = process.argv.slice(2);
  const resumeIdx = args.indexOf("--resume");

  let ticketId: string;
  let resume = false;
  if (resumeIdx !== -1) {
    ticketId = args[resumeIdx + 1];
    if (!ticketId) throw new Error("--resume requires a ticket id");
    resume = true;
    console.log(`\nResuming ticket: ${ticketId}\n`);
  } else {
    const title = args[0]?.trim() || DEFAULT_TITLE;
    const description = args[1]?.trim() || DEFAULT_DESCRIPTION;
    console.log(`\nCreating ticket: ${title}`);
    const ticket = await createTicket({ title, description });
    ticketId = ticket.id;
    console.log(`  id = ${ticket.id}\n`);
  }

  const started = Date.now();
  const result = await runPipeline(ticketId, { resume });
  const mins = ((Date.now() - started) / 60_000).toFixed(1);

  const full = await prisma.ticket.findUnique({
    where: { id: ticketId },
    include: { steps: { orderBy: { order: "asc" } }, artifacts: { orderBy: { createdAt: "asc" } } },
  });
  if (!full) throw new Error("ticket vanished");

  hr("═");
  console.log(`PIPELINE ${result.ok ? "COMPLETE" : "FAILED"}  ·  ticket ${full.status}  ·  ${mins} min`);
  if (!result.ok) console.log(`  failure: ${result.failedRole ?? "?"} — ${result.error}`);
  hr("═");

  console.log("\nSTEPS");
  for (const s of full.steps) {
    const dur =
      s.startedAt && s.completedAt
        ? `${((s.completedAt.getTime() - s.startedAt.getTime()) / 1000).toFixed(0)}s`
        : "";
    console.log(
      `  ${String(s.order + 1)}. ${s.role.padEnd(11)} ${s.status.padEnd(9)} ${dur}` +
        (s.error ? `\n     error: ${s.error}` : ""),
    );
  }

  for (const a of full.artifacts) {
    console.log(`\n\n`);
    hr();
    console.log(`ARTIFACT: ${a.type}`);
    hr();
    console.log(a.content);

    if (a.type === ARTIFACT_TYPE.CODE) {
      const { files, warnings } = parseGeneratedFiles(a.content);
      console.log(`\n  → parsed ${files.length} file block(s): ${files.map((f) => f.path).join(", ") || "(none)"}`);
      for (const w of warnings) console.log(`  → warning: ${w}`);
    }
    if (a.type === ARTIFACT_TYPE.QA_REPORT) {
      console.log(`\n  → QA verdict: ${parseQaVerdict(a.content) ?? "(could not parse)"}`);
    }
  }

  await prisma.$disconnect();
  process.exit(result.ok ? 0 : 1);
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
