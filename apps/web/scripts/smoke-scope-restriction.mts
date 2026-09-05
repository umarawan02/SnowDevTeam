/**
 * Open item #4 — Zurich/Australia Application Registry "Scope Restriction"
 * behaviour for the engine's client-credentials OAuth client against Global and
 * scoped writes.
 *
 *   pnpm --filter web tsx scripts/smoke-scope-restriction.mts <instanceId>
 */
import "@/lib/config";
import { prisma } from "@/lib/db";
import { SnowClient } from "@/lib/servicenow/client";
import { credentials } from "@/lib/servicenow/credentials";
import { atLeast, SCOPE_RESTRICTION_MIN } from "@/lib/servicenow/releases";
import { inertBusinessRule, smokeName, printVerdict, cleanupSmoke } from "@/lib/servicenow/smoke";

async function main() {
  const id = process.argv[2];
  if (!id) throw new Error("usage: smoke-scope-restriction <instanceId>");
  const instance = await prisma.instance.findUniqueOrThrow({ where: { id } });

  let cred;
  try {
    cred = credentials.resolve(instance.name);
  } catch {
    printVerdict({
      name: "scope-restriction",
      openItem: "open item #4",
      status: "INCONCLUSIVE",
      finding: "no client-credentials creds configured — this check is OAuth-only",
      action: "run setup-oauth, set SNOW_CRED_* in .env, re-run",
    });
    await prisma.$disconnect();
    return;
  }
  if (cred.mode !== "oauth_cc") {
    printVerdict({
      name: "scope-restriction",
      openItem: "open item #4",
      status: "INCONCLUSIVE",
      finding: `credentialRef "${instance.name}" is ${cred.mode}, not oauth_cc`,
    });
    await prisma.$disconnect();
    return;
  }

  const client = new SnowClient({ baseUrl: instance.url, credential: cred });
  const preZurich = !atLeast(instance.releaseName, SCOPE_RESTRICTION_MIN);

  // unscoped read
  const read = await client.get("/api/now/table/sys_user", { query: { sysparm_limit: 1, sysparm_fields: "sys_id" } });
  // unscoped write
  const brName = smokeName("scope-restrict");
  const write = await client.post<{ result?: { sys_id: string } }>("/api/now/table/sys_script", { body: inertBusinessRule(brName) });
  if (write.ok && write.body?.result?.sys_id) await client.table.del("sys_script", write.body.result.sys_id).catch(() => {});

  // cross-scope read
  const cross = await client.get("/api/now/table/sc_cat_item", {
    query: { sysparm_query: "sys_scope.scope=x_1460392_delivery", sysparm_limit: 1, sysparm_fields: "sys_id" },
  });

  const authOk = read.status !== 401 && write.status !== 401;
  const restrictionHit =
    [read, write, cross].some((r) => r.error?.kind === "SCOPE_RESTRICTION") ||
    [read, write, cross].some((r) => r.error?.kind === "CROSS_SCOPE");

  printVerdict({
    name: "scope-restriction",
    openItem: "open item #4",
    status: !authOk ? "FAIL" : "PASS",
    finding: !authOk
      ? "OAuth client cannot authenticate at all (uniform 401) — OAuth Application User not set/active"
      : restrictionHit
        ? "Scope Restriction is 'Securely Scoped' — unscoped/cross-scope calls are blocked for this client"
        : "OAuth client has unrestricted access to Global + scoped reads/writes",
    detail:
      `release=${instance.releaseName ?? "?"} (${preZurich ? "pre-Zurich — restriction N/A" : "Zurich+"}); ` +
      `unscoped read ${read.status}${read.error ? "/" + read.error.kind : ""}, ` +
      `unscoped write ${write.status}${write.error ? "/" + write.error.kind : ""}, ` +
      `cross-scope read ${cross.status}${cross.error ? "/" + cross.error.kind : ""}`,
    action: !authOk
      ? "set the OAuth Application User on the oauth_entity and mark it active"
      : restrictionHit
        ? "set the Application Registry Scope Restriction to 'Broadly Scoped' (allow unscoped) for the engine client"
        : "no action — engine client is correctly scoped",
  });

  await cleanupSmoke(
    new SnowClient({
      baseUrl: instance.url,
      credential: { mode: "basic", username: process.env.SN_USERNAME!, password: process.env.SN_PASSWORD! },
    }),
  ).catch(() => {});
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error("SMOKE FAILED:", e instanceof Error ? (e.stack ?? e.message) : e);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
