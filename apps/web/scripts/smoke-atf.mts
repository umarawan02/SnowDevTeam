/**
 * Open item #6 — do ATF client-side steps run headless with a scheduled client
 * test runner? Detect-only: reports the prerequisites present/absent.
 *
 *   pnpm --filter web tsx scripts/smoke-atf.mts <instanceId>
 */
import "@/lib/config";
import { prisma } from "@/lib/db";
import { SnowClient } from "@/lib/servicenow/client";
import { printVerdict } from "@/lib/servicenow/smoke";

async function main() {
  const id = process.argv[2];
  if (!id) throw new Error("usage: smoke-atf <instanceId>");
  const instance = await prisma.instance.findUniqueOrThrow({ where: { id } });
  const client = SnowClient.forInstance(instance);

  const props = await client.table.list<{ name: string; value: string }>("sys_properties", {
    query: "nameLIKEatf^ORnameLIKEsn_atf",
    fields: "name,value",
    limit: 40,
  });
  const runnerEnabled = props.find((p) => /runner\.enabled/i.test(p.name))?.value;

  let atfReadable = false;
  const atfTests = await client.get<{ result?: unknown[] }>("/api/now/table/sys_atf_test", { query: { sysparm_limit: 1, sysparm_fields: "sys_id" } });
  atfReadable = atfTests.ok;

  // scheduled client test runner: sys_trigger / scheduled job referencing the ATF runner
  const jobs = await client.table.list<{ name: string; next_action: string }>("sys_trigger", {
    query: "nameLIKEclient test^ORnameLIKEATF",
    fields: "name,next_action",
    limit: 10,
  });

  const hasRunner = jobs.length > 0 || runnerEnabled === "true";

  printVerdict({
    name: "ATF headless capability (detect-only)",
    openItem: "open item #6",
    status: atfReadable ? (hasRunner ? "PASS" : "INCONCLUSIVE") : "INCONCLUSIVE",
    finding: !atfReadable
      ? "ATF tables not readable by this client (ATF plugin inactive or ACL)"
      : hasRunner
        ? "ATF is active and a client test runner appears to be scheduled — client-side steps should run"
        : "ATF is active but no scheduled client test runner found — client-side steps will be skipped",
    detail:
      `sys_atf_test readable: ${atfReadable}; runner.enabled property: ${runnerEnabled ?? "unset"}; ` +
      `scheduled jobs matching ATF/client-test: ${jobs.length ? jobs.map((j) => j.name).join(", ") : "none"}`,
    action:
      "Phase 5 §5.5: run server-side ATF via sn_cicd/testsuite/run; document that a scheduled client test runner (or a container runner) must be configured for UI-interaction steps.",
  });

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error("SMOKE FAILED:", e instanceof Error ? (e.stack ?? e.message) : e);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
