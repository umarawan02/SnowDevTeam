/**
 * Open item #1 — does `PUT /api/now/ui/concoursepicker/application` reliably
 * re-scope Table API writes for a client-credentials OAuth user with no
 * interactive session?
 *
 *   pnpm --filter web tsx scripts/smoke-scope-write.mts <instanceId>
 */
import "@/lib/config";
import { prisma } from "@/lib/db";
import { SnowClient } from "@/lib/servicenow/client";
import { credentials } from "@/lib/servicenow/credentials";
import { resolveScope, setCurrentApplication, ScopeNotSetError } from "@/lib/servicenow/scope";
import { inertBusinessRule, smokeName, printVerdict, cleanupSmoke, type Verdict } from "@/lib/servicenow/smoke";

const SCOPED = "x_1460392_delivery";

async function writeAndReadScope(client: SnowClient, label: string): Promise<string> {
  const created = await client.table.insert<{ sys_id: string }>("sys_script", inertBusinessRule(smokeName(`scope-${label}`)));
  const back = await client.table.getOne<{ sys_scope: string; "sys_scope.scope": string }>("sys_script", {
    sysId: created.sys_id,
    fields: "sys_scope,sys_scope.scope",
  });
  await client.table.del("sys_script", created.sys_id).catch(() => {});
  return back?.["sys_scope.scope"] || back?.sys_scope || "(unknown)";
}

async function runForMode(instanceUrl: string, refName: string, mode: "basic" | "oauth_cc"): Promise<Verdict> {
  const openItem = "open item #1" + (mode === "oauth_cc" ? " (OAuth)" : " (basic)");
  const name = `scope-write / ${mode}`;
  try {
    let client: SnowClient;
    if (mode === "basic") {
      client = new SnowClient({
        baseUrl: instanceUrl,
        credential: { mode: "basic", username: process.env.SN_USERNAME!, password: process.env.SN_PASSWORD! },
      });
    } else {
      let cred;
      try {
        cred = credentials.resolve(refName);
      } catch {
        return { name, openItem, status: "INCONCLUSIVE", finding: "no client-credentials creds in env", action: `run setup-oauth and set SNOW_CRED_${refName.toUpperCase()}_*` };
      }
      if (cred.mode !== "oauth_cc") {
        return { name, openItem, status: "INCONCLUSIVE", finding: `credentialRef "${refName}" resolves to ${cred.mode}, not oauth_cc` };
      }
      client = new SnowClient({ baseUrl: instanceUrl, credential: cred });
    }

    const global = await resolveScope(client, "global");
    let scoped: { sysId: string } | null = null;
    try {
      scoped = await resolveScope(client, SCOPED);
    } catch {
      /* scoped app absent */
    }

    await setCurrentApplication(client, global.sysId);
    const globalScope = await writeAndReadScope(client, "global");

    let scopedScope = "(skipped — scoped app absent)";
    if (scoped) {
      await setCurrentApplication(client, scoped.sysId);
      scopedScope = await writeAndReadScope(client, "scoped");
    }

    const ok = globalScope === "global" && (!scoped || scopedScope === SCOPED);
    return {
      name,
      openItem,
      status: ok ? "PASS" : "FAIL",
      finding: ok ? "concoursepicker re-scopes Table API writes" : "concoursepicker did NOT re-scope the write",
      detail: `global write → "${globalScope}"; scoped write → "${scopedScope}"`,
      action: ok
        ? "engine can use concoursepicker + Table API directly"
        : "fall back to a scripted server-side REST resource for scope control (§4/§5 design change)",
    };
  } catch (e) {
    if (e instanceof ScopeNotSetError) {
      return { name, openItem, status: "FAIL", finding: "concoursepicker PUT did not update apps.current_app for this session", detail: e.message, action: "server-side scripted resource required" };
    }
    return {
      name,
      openItem,
      status: mode === "oauth_cc" ? "INCONCLUSIVE" : "FAIL",
      finding: "error before a conclusion",
      detail: e instanceof Error ? e.message : String(e),
    };
  }
}

async function main() {
  const id = process.argv[2];
  if (!id) throw new Error("usage: smoke-scope-write <instanceId>");
  const instance = await prisma.instance.findUniqueOrThrow({ where: { id } });

  const verdicts = [
    await runForMode(instance.url, instance.name, "basic"),
    await runForMode(instance.url, instance.name, "oauth_cc"),
  ];
  for (const v of verdicts) printVerdict(v);

  const sweep = new SnowClient({
    baseUrl: instance.url,
    credential: { mode: "basic", username: process.env.SN_USERNAME!, password: process.env.SN_PASSWORD! },
  });
  await cleanupSmoke(sweep).catch(() => {});
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error("SMOKE FAILED:", e instanceof Error ? (e.stack ?? e.message) : e);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
