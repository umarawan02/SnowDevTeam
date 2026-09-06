/**
 * Install the "SnowDevTeam Native Engine" Scripted REST resource on an instance
 * (NATIVE_ENGINE_BRIEF Phase 5). Required before `apply.ts` can write —
 * a headless session can't make an update set current, so the writes run
 * server-side through this resource (see
 * src/lib/nativeengine/serverscript/apply-resource.js and
 * docs/servicenow-smoke-findings.md open items #1/#2).
 *
 *   pnpm --filter web setup-native-engine <instanceId>
 *
 * Idempotent — re-run to push script changes. Uses the instance's deploy
 * credential. Prints the resource base path and a live /session probe.
 */
import "@/lib/config";
import { prisma } from "@/lib/db";
import { SnowClient } from "@/lib/servicenow/client";
import { ensureAtfScheduleEnabled, installNativeResource, probeNativeResource } from "@/lib/servicenow/native-resource";

function hr() {
  console.log("─".repeat(70));
}

async function main() {
  const instanceId = process.argv[2];
  if (!instanceId) throw new Error("usage: setup-native-engine <instanceId>");

  const instance = await prisma.instance.findUniqueOrThrow({ where: { id: instanceId } });
  hr();
  console.log(`Native engine resource → ${instance.name} (${instance.url})`);
  hr();

  const client = SnowClient.forInstance(instance);

  const result = await installNativeResource(client);
  console.log(`· sys_script_include SDTNativeEngine        ${result.scriptInclude}`);
  console.log(`· sys_ws_definition  SnowDevTeam Native Engine ${result.definition}`);
  for (const [op, action] of Object.entries(result.operations)) {
    console.log(`· sys_ws_operation   ${op.padEnd(10)}              ${action}`);
  }
  console.log(`\nbase path: ${result.basePath}`);

  const atf = await ensureAtfScheduleEnabled(client);
  console.log(
    `· sn_atf.schedule.enabled                   ${
      atf === "set" ? "set to true" : atf === "already" ? "already true" : "BLOCKED — enable it in ATF → Administration → Properties (ATF runs will be advisory until then)"
    }`,
  );

  hr();
  console.log("Probing <base>/session …");
  const session = await probeNativeResource(client);
  if (!session) {
    console.log("✗ /session returned 404 — the operation may take a moment to register, or ACLs block it. Re-run in a few seconds.");
    process.exitCode = 1;
  } else {
    console.log(`✓ reachable as ${session.user}`);
    console.log(`  current update set: ${session.currentUpdateSet || "(none)"}`);
    console.log(`  current scope     : ${session.currentScope}`);
  }

  hr();
  console.log(`requests: ${client.requestLog.length}`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error("\nSETUP FAILED:", e instanceof Error ? (e.stack ?? e.message) : e);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
