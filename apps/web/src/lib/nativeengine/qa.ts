import type { Instance } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ARTIFACT_TYPE } from "@/lib/constants";
import { SnowClient } from "@/lib/servicenow/client";
import { cicdCall } from "@/lib/servicenow/cicd";
import type { ChangePlan } from "@/lib/nativeengine/plan";
import type { AppliedChange } from "@/lib/nativeengine/apply";

/**
 * Real QA for the native engine (NATIVE_ENGINE_BRIEF §5.5). The change plan's
 * ATF tests ship in the same update set; after apply, run the suite and fail
 * the ticket on any failure. Instance Scan is attached best-effort.
 */

export interface AtfOutcome {
  ran: boolean;
  passed: boolean;
  summary: string;
}

async function appliedFor(ticketId: string): Promise<AppliedChange[]> {
  const dep = await prisma.nativeDeployment.findUnique({ where: { ticketId } });
  if (!dep) return [];
  return (dep.appliedChanges as unknown as AppliedChange[]) ?? [];
}

export async function runAtfForPlan(opts: {
  ticketId: string;
  instance: Instance;
  plan: ChangePlan;
}): Promise<AtfOutcome> {
  const applied = await appliedFor(opts.ticketId);
  const suite = applied.find((a) => a.table === "sys_atf_test_suite");
  const looseTests = applied.filter((a) => a.table === "sys_atf_test");

  if (!suite) {
    const note = looseTests.length
      ? `The plan created ${looseTests.length} ATF test(s) but no \`sys_atf_test_suite\` to run them headless. Add a suite to the plan.`
      : "The change plan contains no ATF tests.";
    await upsertArtifact(opts.ticketId, ARTIFACT_TYPE.ATF_RESULTS, `# ATF Results\n\n_${note}_\n`);
    return { ran: false, passed: true, summary: note };
  }

  const client = SnowClient.forInstance(opts.instance);
  let markdown = `# ATF Results\n\nSuite \`${suite.sysId}\` on ${opts.instance.name}\nRun: ${new Date().toISOString()}\n\n`;
  try {
    const progress = await cicdCall(client, "/api/sn_cicd/testsuite/run", {
      query: { test_suite_sys_id: suite.sysId },
      timeoutMs: 15 * 60_000,
    });

    const resultId =
      readLink(progress, "results") ??
      (typeof progress.test_suite_result_id === "string" ? progress.test_suite_result_id : undefined);

    let passed = String(progress.status) === "2";
    if (resultId) {
      const sr = await client.table.getOne<Record<string, unknown>>("sys_atf_test_suite_result", {
        sysId: resultId,
        fields: "status,name,run_time,sys_id",
      });
      const tests = await client.table.list<Record<string, unknown>>("sys_atf_test_result", {
        query: `test_suite_result=${resultId}`,
        fields: "status,test,output,sys_id",
        limit: 200,
      });
      passed = String(sr?.status ?? "").toLowerCase() === "success";
      markdown += `**Suite status: ${String(sr?.status ?? "?")}**\n\n`;
      markdown += "| Test | Status |\n| --- | --- |\n";
      for (const t of tests) markdown += `| \`${String(t.test ?? t.sys_id)}\` | ${String(t.status)} |\n`;
      const failed = tests.filter((t) => String(t.status).toLowerCase() !== "success");
      if (failed.length) {
        markdown += `\n## Failures\n\n`;
        for (const f of failed) markdown += `- \`${String(f.test ?? f.sys_id)}\`: ${String(f.output ?? "").slice(0, 500)}\n`;
      }
    } else {
      markdown += `Progress status ${progress.status} (${progress.status_message ?? ""}); no result id returned.\n`;
    }

    await upsertArtifact(opts.ticketId, ARTIFACT_TYPE.ATF_RESULTS, markdown);
    return { ran: true, passed, summary: passed ? "all ATF tests passed" : "one or more ATF tests failed" };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // "scheduled execution disabled" etc. is an instance-config gap, not a test
    // failure — advisory, don't fail the ticket (brief §5.5).
    const configGap = /scheduled test\/suite execution is disabled|schedule\.enabled|disabled\b/i.test(msg);
    markdown += configGap
      ? `\n**ATF not run — instance config:** ${msg}\n\nEnable it in **ATF → Administration → Properties** ("Enable scheduled test execution"), then re-run QA.\n`
      : `\n**ATF run errored:** ${msg}\n`;
    await upsertArtifact(opts.ticketId, ARTIFACT_TYPE.ATF_RESULTS, markdown);
    return { ran: !configGap, passed: !configGap, summary: configGap ? `ATF skipped — ${msg}` : `ATF run errored: ${msg}` };
  }
}

/**
 * Instance Scan against the update set — best-effort. There is no first-class
 * headless API; record what to run and where. Not a hard gate.
 */
export async function runInstanceScan(opts: {
  ticketId: string;
  instance: Instance;
  updateSetSysId: string;
}): Promise<void> {
  const url = `${opts.instance.url}/now/nav/ui/classic/params/target/sys_update_set.do%3Fsys_id%3D${opts.updateSetSysId}`;
  const md = [
    "# Instance Scan",
    "",
    "Instance Scan has no reliable headless trigger. Run it by hand against this update set:",
    "",
    `1. Open the update set: ${url}`,
    "2. **Instance Scan → Scan Update Set** (related link).",
    "3. Review findings under **Instance Scan → Scan Results**.",
    "",
    "_This step is advisory and does not gate the release._",
  ].join("\n");
  await upsertArtifact(opts.ticketId, ARTIFACT_TYPE.INSTANCE_SCAN, md);
}

function readLink(progress: Record<string, unknown>, key: string): string | undefined {
  const links = progress.links as { [k: string]: { id?: string; url?: string } } | undefined;
  return links?.[key]?.id;
}

async function upsertArtifact(ticketId: string, type: string, content: string): Promise<void> {
  const existing = await prisma.artifact.findFirst({ where: { ticketId, type } });
  if (existing) await prisma.artifact.update({ where: { id: existing.id }, data: { content } });
  else await prisma.artifact.create({ data: { ticketId, type, content } });
}
