/**
 * Provision an inbound OAuth **client-credentials** app on a ServiceNow
 * instance so the native engine (NATIVE_ENGINE_BRIEF Phase 3) can authenticate
 * without an interactive session.
 *
 *   pnpm --filter web setup-oauth <instanceId>
 *
 * Uses admin basic auth (SN_USERNAME / SN_PASSWORD from the repo-root .env).
 * Idempotent: re-running reuses the existing OAuth Entity. On success it
 * updates the Instance row to authMode="oauth_cc" and prints the
 * SNOW_CRED_<REF>_* lines to add to .env. If it cannot finish the OAuth
 * Application User mapping via the API it prints the exact manual step.
 *
 * Docs: KB1645212, "Inbound Client Credentials with Washington".
 */
import { randomBytes } from "node:crypto";
import "@/lib/config";
import { prisma } from "@/lib/db";
import { SnowClient } from "@/lib/servicenow/client";
import { credentials } from "@/lib/servicenow/credentials";

const GRANT_PROP = "glide.oauth.inbound.client.credential.grant_type.enabled";
const ENTITY_NAME = "SnowDevTeam Native Engine";

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
  if (!instanceId) throw new Error("usage: setup-oauth <instanceId>");

  const instance = await prisma.instance.findUniqueOrThrow({ where: { id: instanceId } });
  const ref = instance.name; // credentialRef slug → SNOW_CRED_<REF>_*
  hr();
  console.log(`OAuth client-credentials setup for ${instance.name} (${instance.url})`);
  hr();

  const admin = new SnowClient({
    baseUrl: instance.url,
    credential: { mode: "basic", username: reqEnv("SN_USERNAME"), password: reqEnv("SN_PASSWORD") },
  });

  // 1. enable the inbound client-credentials grant property
  const prop = await admin.table.getOne<{ sys_id: string; value: string }>("sys_properties", {
    query: `name=${GRANT_PROP}`,
    fields: "sys_id,value",
  });
  if (!prop) {
    await admin.table.insert("sys_properties", {
      name: GRANT_PROP,
      value: "true",
      type: "boolean",
      description: "Enable inbound OAuth client-credentials grant (SnowDevTeam native engine)",
    });
    console.log(`✓ created ${GRANT_PROP} = true`);
  } else if (prop.value !== "true") {
    await admin.table.update("sys_properties", prop.sys_id, { value: "true" });
    console.log(`✓ set ${GRANT_PROP} = true`);
  } else {
    console.log(`· ${GRANT_PROP} already true`);
  }

  // 2. admin user sys_id — the OAuth Application User for this phase (Phase 7
  //    splits this into a read-only user + a deploy user).
  const me = await admin.get<{ result: { user_sys_id: string; user_name: string } }>("/api/now/ui/user/current_user");
  const adminUserSysId = me.body.result.user_sys_id;
  console.log(`· OAuth Application User: ${me.body.result.user_name} (${adminUserSysId})`);

  // 3. find-or-create the oauth_entity. Table API returns `client_secret`
  //    encrypted, so we set an explicit secret we can keep.
  let entity = await admin.table.getOne<Record<string, string>>("oauth_entity", {
    query: `name=${ENTITY_NAME}`,
    fields: "sys_id,name,client_id",
  });
  let clientSecret: string | null = null;
  const entityFields = {
    name: ENTITY_NAME,
    active: "true",
    client_type: "integration_as_a_user",
    inbound_grant_type: "client_credential",
    default_grant_type: "client_credentials",
    send_client_credentials_as: "request_body_parameter",
    user: adminUserSysId,
  };
  if (!entity) {
    clientSecret = randomBytes(24).toString("base64url");
    const created = await admin.table.insert<Record<string, string>>("oauth_entity", {
      ...entityFields,
      client_secret: clientSecret,
    });
    entity = await admin.table.getOne<Record<string, string>>("oauth_entity", {
      sysId: created.sys_id,
      fields: "sys_id,name,client_id",
    });
    console.log(`✓ created oauth_entity ${entity?.sys_id} (with a known client_secret)`);
  } else {
    // rotate the secret so this run has a value it can print
    clientSecret = randomBytes(24).toString("base64url");
    await admin.table.update("oauth_entity", entity.sys_id, { ...entityFields, client_secret: clientSecret });
    console.log(`· oauth_entity ${entity.sys_id} exists — refreshed grant config + rotated client_secret`);
  }
  if (!entity) throw new Error("failed to read back the oauth_entity");

  // 4. ensure a client-credentials oauth_entity_profile marked default
  let profile = await admin.table.getOne<{ sys_id: string; grant_type: string; default: string }>(
    "oauth_entity_profile",
    { query: `oauth_entity=${entity.sys_id}^grant_type=client_credentials`, fields: "sys_id,grant_type,default" },
  );
  if (!profile) {
    const p = await admin.table.insert<{ sys_id: string }>("oauth_entity_profile", {
      name: `${ENTITY_NAME} - client credentials`,
      oauth_entity: entity.sys_id,
      grant_type: "client_credentials",
      default: "true",
    });
    profile = { sys_id: p.sys_id, grant_type: "client_credentials", default: "true" };
    console.log("✓ created oauth_entity_profile (grant_type=client_credentials, default)");
  } else {
    if (profile.default !== "true") {
      await admin.table.update("oauth_entity_profile", profile.sys_id, { default: "true" });
    }
    console.log(`· oauth_entity_profile ${profile.sys_id} already exists`);
  }

  const clientId = entity.client_id;

  // 6. verify: fetch a token
  console.log("\nVerifying client-credentials token…");
  let tokenOk = false;
  if (clientId && clientSecret) {
    const probe = new SnowClient({
      baseUrl: instance.url,
      credential: { mode: "oauth_cc", clientId, clientSecret },
    });
    const who = await probe.get<{ result?: { user_name?: string } }>("/api/now/ui/user/current_user");
    tokenOk = who.ok && !!who.body?.result?.user_name;
    console.log(
      tokenOk
        ? `✓ token works — authenticates as ${who.body!.result!.user_name}`
        : `✗ token call failed: ${who.error?.kind} (${who.status}) ${who.error?.message ?? ""}`,
    );
  }

  // 7. wire up the Instance row + print env
  hr();
  if (tokenOk) {
    await prisma.instance.update({
      where: { id: instance.id },
      data: { authMode: "oauth_cc", credentialRef: ref, readOnlyCredentialRef: ref },
    });
    console.log(`✓ Instance row updated: authMode=oauth_cc, credentialRef="${ref}"`);
  } else {
    console.log("Instance row left as-is (authMode=" + instance.authMode + ") — resolve the OAuth issue and re-run.");
  }
  const R = ref.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
  console.log("\nAdd to the repo-root .env:\n");
  console.log(`SNOW_CRED_${R}_CLIENT_ID=${clientId ?? "<from the oauth_entity record>"}`);
  console.log(`SNOW_CRED_${R}_CLIENT_SECRET=${clientSecret ?? "<from the oauth_entity record>"}`);
  console.log(`# SNOW_CRED_${R}_TOKEN_URL=  (optional — defaults to <instance>/oauth_token.do)`);
  hr();

  // sanity: the EnvCredentialProvider will find these once they're set
  try {
    credentials.resolve(ref);
    console.log(`· credentialRef "${ref}" already resolvable from the current env`);
  } catch {
    console.log(`· set the SNOW_CRED_${R}_* vars above, then \`pnpm --filter web probe-instance ${instance.id}\``);
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error("\nSETUP FAILED:", e instanceof Error ? (e.stack ?? e.message) : e);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
