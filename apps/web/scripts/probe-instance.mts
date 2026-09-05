/**
 * Instance probe + scope round-trip (NATIVE_ENGINE_BRIEF Phase 3, §3.4 verify).
 *
 *   pnpm --filter web probe-instance <instanceId>
 *
 * Prints release family + build, the resolved Global sys_scope sys_id, the
 * deploy user, and round-trips `setCurrentApplication` Global → scoped → Global
 * with verification at each step. Persists releaseName/Build/DetectedAt.
 */
import "@/lib/config";
import { prisma } from "@/lib/db";
import { SnowClient } from "@/lib/servicenow/client";
import { probeInstance } from "@/lib/servicenow/probe";
import { resolveScope, setCurrentApplication, getDeployUserSysId } from "@/lib/servicenow/scope";

const SCOPED_PROBE = "x_1460392_delivery"; // an existing scoped app on the demo PDI

function hr() {
  console.log("─".repeat(70));
}

async function main() {
  const instanceId = process.argv[2];
  if (!instanceId) throw new Error("usage: probe-instance <instanceId>");
  const instance = await prisma.instance.findUniqueOrThrow({ where: { id: instanceId } });

  hr();
  console.log(`Probing ${instance.name} — ${instance.url}  (authMode: ${instance.authMode})`);
  hr();

  const probe = await probeInstance(instance);
  console.log(`release name   : ${probe.releaseName ?? "(none)"}`);
  console.log(`release family : ${probe.family}`);
  console.log(`build          : ${probe.releaseBuild ?? "(none)"}`);
  console.log(`glide.war      : ${probe.glideWar ?? "(none)"}`);
  console.log(`Fluent global apps supported (${probe.family} ≥ australia): ${probe.supportsFluentGlobalApps}`);

  const client = SnowClient.forInstance(instance);
  const deployUser = await getDeployUserSysId(client);
  console.log(`\ndeploy user    : ${deployUser}`);

  const global = await resolveScope(client, "global");
  console.log(`Global scope   : ${global.sysId}  (name="${global.name}")`);

  let scoped: { sysId: string; name: string } | null = null;
  try {
    scoped = await resolveScope(client, SCOPED_PROBE);
    console.log(`scoped probe   : ${scoped.sysId}  (name="${scoped.name}")`);
  } catch {
    console.log(`scoped probe   : ${SCOPED_PROBE} not found on this instance — round-trip will use Global only`);
  }

  hr();
  console.log("Scope round-trip");
  hr();
  await setCurrentApplication(client, global.sysId);
  console.log(`✓ current application → Global (${global.sysId}) — verified`);
  if (scoped) {
    try {
      await setCurrentApplication(client, scoped.sysId);
      console.log(`✓ current application → ${scoped.name} (${scoped.sysId}) — verified`);
      await setCurrentApplication(client, global.sysId);
      console.log(`✓ current application → Global — verified`);
    } catch (e) {
      console.log(
        `⚠ could not switch to the scoped app: ${e instanceof Error ? e.message : e}\n` +
          `  (this is exactly open item #1 — see \`pnpm --filter web smoke\`)`,
      );
    }
  }

  hr();
  console.log(
    `DB row updated: releaseName=${probe.releaseName ?? probe.family}, ` +
      `releaseDetectedAt=${new Date().toISOString()}`,
  );
  console.log(`requests made: ${client.requestLog.length}`);
  hr();
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error("\nPROBE FAILED:", e instanceof Error ? (e.stack ?? e.message) : e);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
