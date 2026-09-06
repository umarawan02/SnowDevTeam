import { randomBytes } from "node:crypto";
import type { SnowClient } from "@/lib/servicenow/client";

/**
 * Admin-side helpers for provisioning inbound OAuth client-credentials on a
 * ServiceNow instance. Used by `scripts/setup-oauth.mts` and
 * `scripts/setup-service-users.mts`. Requires an admin (basic-auth) client.
 */

export const GRANT_PROP = "glide.oauth.inbound.client.credential.grant_type.enabled";

/** Ensure `glide.oauth.inbound.client.credential.grant_type.enabled = true`. */
export async function ensureInboundGrantEnabled(admin: SnowClient): Promise<"created" | "updated" | "already"> {
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
    return "created";
  }
  if (prop.value !== "true") {
    await admin.table.update("sys_properties", prop.sys_id, { value: "true" });
    return "updated";
  }
  return "already";
}

export interface OAuthClient {
  entitySysId: string;
  clientId: string;
  clientSecret: string;
}

/**
 * Find-or-create a client-credentials `oauth_entity` mapped to `userSysId`,
 * with a fresh explicit `client_secret` (the Table API returns the stored
 * secret encrypted, so we always set one we can keep). Also ensures a default
 * client-credentials `oauth_entity_profile`.
 */
export async function provisionOAuthClient(
  admin: SnowClient,
  opts: { name: string; userSysId: string },
): Promise<OAuthClient> {
  const clientSecret = randomBytes(24).toString("base64url");
  const fields = {
    name: opts.name,
    active: "true",
    client_type: "integration_as_a_user",
    inbound_grant_type: "client_credential",
    default_grant_type: "client_credentials",
    send_client_credentials_as: "request_body_parameter",
    user: opts.userSysId,
    client_secret: clientSecret,
  };

  let entity = await admin.table.getOne<{ sys_id: string; client_id: string }>("oauth_entity", {
    query: `name=${opts.name}`,
    fields: "sys_id,client_id",
  });
  if (!entity) {
    const created = await admin.table.insert<{ sys_id: string }>("oauth_entity", fields);
    entity = await admin.table.getOne<{ sys_id: string; client_id: string }>("oauth_entity", {
      sysId: created.sys_id,
      fields: "sys_id,client_id",
    });
  } else {
    await admin.table.update("oauth_entity", entity.sys_id, fields);
  }
  if (!entity) throw new Error(`failed to read back oauth_entity "${opts.name}"`);

  const profile = await admin.table.getOne<{ sys_id: string; default: string }>("oauth_entity_profile", {
    query: `oauth_entity=${entity.sys_id}^grant_type=client_credentials`,
    fields: "sys_id,default",
  });
  if (!profile) {
    await admin.table.insert("oauth_entity_profile", {
      name: `${opts.name} - client credentials`,
      oauth_entity: entity.sys_id,
      grant_type: "client_credentials",
      default: "true",
    });
  } else if (profile.default !== "true") {
    await admin.table.update("oauth_entity_profile", profile.sys_id, { default: "true" });
  }

  return { entitySysId: entity.sys_id, clientId: entity.client_id, clientSecret };
}

/** Grant `roleNames` to `userSysId` (idempotent). Returns the roles it added. */
export async function grantRoles(admin: SnowClient, userSysId: string, roleNames: string[]): Promise<string[]> {
  const added: string[] = [];
  for (const roleName of roleNames) {
    const role = await admin.table.getOne<{ sys_id: string }>("sys_user_role", {
      query: `name=${roleName}`,
      fields: "sys_id",
    });
    if (!role) throw new Error(`role "${roleName}" not found on this instance`);
    const has = await admin.table.getOne<{ sys_id: string }>("sys_user_has_role", {
      query: `user=${userSysId}^role=${role.sys_id}`,
      fields: "sys_id",
    });
    if (!has) {
      await admin.table.insert("sys_user_has_role", { user: userSysId, role: role.sys_id });
      added.push(roleName);
    }
  }
  return added;
}

/** Find-or-create a web-service-only service account. */
export async function ensureServiceUser(
  admin: SnowClient,
  opts: { userName: string; firstName: string; email?: string },
): Promise<{ sysId: string; created: boolean }> {
  const existing = await admin.table.getOne<{ sys_id: string }>("sys_user", {
    query: `user_name=${opts.userName}`,
    fields: "sys_id",
  });
  if (existing) return { sysId: existing.sys_id, created: false };

  const created = await admin.table.insert<{ sys_id: string }>("sys_user", {
    user_name: opts.userName,
    first_name: opts.firstName,
    last_name: "(service)",
    email: opts.email ?? `${opts.userName}@example.invalid`,
    web_service_access_only: "true",
    active: "true",
    locked_out: "false",
    password_needs_reset: "false",
    // a random password it will never use (client-credentials is passwordless)
    user_password: randomBytes(18).toString("base64url"),
  });
  return { sysId: created.sys_id, created: true };
}
