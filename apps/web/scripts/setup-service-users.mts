/**
 * Provision the two per-instance ServiceNow service accounts the native engine
 * uses (NATIVE_ENGINE_BRIEF §7.1), each with its own client-credentials OAuth
 * client:
 *
 *   - <prefix>_ro     — read-only, for agent probes/queries
 *   - <prefix>_deploy — writes + promotion
 *
 *   pnpm --filter web setup-service-users <instanceId> [--deploy-role admin|<customRole>]
 *
 * Uses admin basic auth (SN_USERNAME / SN_PASSWORD). Idempotent. Updates the
 * Instance row (credentialRef / readOnlyCredentialRef) and prints the four
 * SNOW_CRED_* lines for .env. Supersedes `setup-oauth.mts` (the single-user
 * quick path).
 */
import "@/lib/config";
import { prisma } from "@/lib/db";
import { SnowClient } from "@/lib/servicenow/client";
import {
  ensureInboundGrantEnabled,
  ensureServiceUser,
  grantRoles,
  provisionOAuthClient,
} from "@/lib/servicenow/oauth-admin";

const USER_PREFIX = "svc_snowdevteam";
const RO_ROLES = ["snc_read_only"];

function reqEnv(n: string): string {
  const v = process.env[n];
  if (!v) throw new Error(`missing env var ${n}`);
  return v;
}
function hr() {
  console.log("─".repeat(70));
}

async function main() {
  const instanceId = process.argv[2];
  if (!instanceId) throw new Error("usage: setup-service-users <instanceId> [--deploy-role <role>]");
  const deployRoleArg = process.argv.indexOf("--deploy-role");
  const deployRole = deployRoleArg > 0 ? process.argv[deployRoleArg + 1] : "admin";

  const instance = await prisma.instance.findUniqueOrThrow({ where: { id: instanceId } });
  hr();
  console.log(`Service-user setup for ${instance.name} (${instance.url})`);
  console.log(`deploy user role: ${deployRole}`);
  hr();

  const admin = new SnowClient({
    baseUrl: instance.url,
    credential: { mode: "basic", username: reqEnv("SN_USERNAME"), password: reqEnv("SN_PASSWORD") },
  });

  console.log(`· inbound client-credentials grant: ${await ensureInboundGrantEnabled(admin)}`);

  // --- read-only user + client
  const roUserName = `${USER_PREFIX}_ro`;
  const ro = await ensureServiceUser(admin, { userName: roUserName, firstName: "SnowDevTeam RO" });
  console.log(`${ro.created ? "✓ created" : "·"} user ${roUserName} (${ro.sysId})`);
  const roAdded = await grantRoles(admin, ro.sysId, RO_ROLES);
  console.log(`  roles: ${RO_ROLES.join(", ")}${roAdded.length ? ` (added ${roAdded.join(", ")})` : " (already)"}`);
  const roClient = await provisionOAuthClient(admin, { name: "SnowDevTeam Native Engine (read-only)", userSysId: ro.sysId });
  console.log(`  oauth_entity ${roClient.entitySysId}`);

  // --- deploy user + client
  const deployUserName = `${USER_PREFIX}_deploy`;
  const dep = await ensureServiceUser(admin, { userName: deployUserName, firstName: "SnowDevTeam Deploy" });
  console.log(`${dep.created ? "✓ created" : "·"} user ${deployUserName} (${dep.sysId})`);
  const depRoles = [deployRole, "sn_cicd.sys_ci_automation", "rest_service"];
  const depAdded = await grantRoles(admin, dep.sysId, depRoles);
  console.log(`  roles: ${depRoles.join(", ")}${depAdded.length ? ` (added ${depAdded.join(", ")})` : " (already)"}`);
  const depClient = await provisionOAuthClient(admin, { name: "SnowDevTeam Native Engine (deploy)", userSysId: dep.sysId });
  console.log(`  oauth_entity ${depClient.entitySysId}`);

  // retire the old single-user entity if it's still around
  const legacy = await admin.table.getOne<{ sys_id: string }>("oauth_entity", {
    query: "name=SnowDevTeam Native Engine",
    fields: "sys_id",
  });
  if (legacy) {
    await admin.table.update("oauth_entity", legacy.sys_id, { active: "false" });
    console.log(`· deactivated the legacy single-user entity ${legacy.sys_id}`);
  }

  // --- verify both tokens
  hr();
  const verify = async (label: string, c: { clientId: string; clientSecret: string }) => {
    const probe = new SnowClient({
      baseUrl: instance.url,
      credential: { mode: "oauth_cc", clientId: c.clientId, clientSecret: c.clientSecret },
    });
    const who = await probe.get<{ result?: { user_name?: string } }>("/api/now/ui/user/current_user");
    const ok = who.ok && !!who.body?.result?.user_name;
    console.log(ok ? `✓ ${label} token → ${who.body!.result!.user_name}` : `✗ ${label} token failed: ${who.status} ${who.error?.message ?? ""}`);
    return ok;
  };
  const roOk = await verify("read-only", roClient);
  const depOk = await verify("deploy", depClient);

  // --- wire the Instance row
  const depRef = instance.name;
  const roRef = `${instance.name}-ro`;
  if (roOk && depOk) {
    await prisma.instance.update({
      where: { id: instance.id },
      data: { authMode: "oauth_cc", credentialRef: depRef, readOnlyCredentialRef: roRef },
    });
    console.log(`✓ Instance row: credentialRef="${depRef}", readOnlyCredentialRef="${roRef}"`);
  } else {
    console.log("⚠ Instance row left unchanged — a token failed. Fix and re-run.");
  }

  const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
  hr();
  console.log("Add to the repo-root .env (replace the old SNOW_CRED_… lines):\n");
  console.log(`SNOW_CRED_${norm(depRef)}_CLIENT_ID=${depClient.clientId}`);
  console.log(`SNOW_CRED_${norm(depRef)}_CLIENT_SECRET=${depClient.clientSecret}`);
  console.log(`SNOW_CRED_${norm(roRef)}_CLIENT_ID=${roClient.clientId}`);
  console.log(`SNOW_CRED_${norm(roRef)}_CLIENT_SECRET=${roClient.clientSecret}`);
  hr();
  if (deployRole === "admin") {
    console.log("NOTE: the deploy user has `admin`. Tighten to a custom role before test/prod\n" +
      "      (re-run with --deploy-role <role>).");
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error("\nSETUP FAILED:", e instanceof Error ? (e.stack ?? e.message) : e);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
