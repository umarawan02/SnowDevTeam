import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "@/lib/config";
import { SnowClient, SnowError } from "@/lib/servicenow/client";

/**
 * Install + probe the "SnowDevTeam Native Engine" Scripted REST resource
 * (NATIVE_ENGINE_BRIEF Phase 5). See
 * `src/lib/nativeengine/serverscript/apply-resource.js` for why it exists and
 * what it does. Installed only by `scripts/setup-native-engine.mts`, never
 * automatically.
 */

export const NATIVE_SERVICE_ID = "sdt_native";
export const NATIVE_SI_NAME = "SDTNativeEngine";
const DEF_NAME = "SnowDevTeam Native Engine";

const SCRIPT_INCLUDE_FILE = path.join(
  REPO_ROOT,
  "apps/web/src/lib/nativeengine/serverscript/apply-resource.js",
);

/** The Script Include body pushed to the instance. */
export function nativeScriptIncludeBody(): string {
  return fs.readFileSync(SCRIPT_INCLUDE_FILE, "utf8");
}

const OPERATION_SCRIPTS: Record<string, { httpMethod: string; relativePath: string; script: string }> = {
  session: {
    httpMethod: "GET",
    relativePath: "/session",
    script: `(function process(request, response) {\n    return new ${NATIVE_SI_NAME}().session();\n})(request, response);\n`,
  },
  apply: {
    httpMethod: "POST",
    relativePath: "/apply",
    script: `(function process(request, response) {\n    return new ${NATIVE_SI_NAME}().apply(request, response);\n})(request, response);\n`,
  },
};

const nsCache = new WeakMap<SnowClient, string>();

/** The namespace segment of a Global-scope Scripted REST URL = the company code. */
export async function globalNamespace(client: SnowClient): Promise<string> {
  const cached = nsCache.get(client);
  if (cached) return cached;
  const row = await client.table.getOne<{ value: string }>("sys_properties", {
    query: "name=glide.appcreator.company.code",
    fields: "value",
  });
  const ns = (row?.value || "").trim();
  if (!ns) throw new Error("glide.appcreator.company.code is unset — cannot form the Global Scripted REST namespace");
  nsCache.set(client, ns);
  return ns;
}

/** e.g. `/api/1460392/sdt_native` */
export async function nativeBasePath(client: SnowClient): Promise<string> {
  return `/api/${await globalNamespace(client)}/${NATIVE_SERVICE_ID}`;
}

export interface NativeSession {
  currentUpdateSet: string;
  currentScope: string;
  user: string;
}

/**
 * `GET <base>/session`. Returns null when the resource isn't installed (404) so
 * callers can print a clear "run setup-native-engine first".
 */
export async function probeNativeResource(client: SnowClient): Promise<NativeSession | null> {
  const base = await nativeBasePath(client);
  const res = await client.get<{ result?: NativeSession } & NativeSession>(`${base}/session`);
  if (res.status === 404) return null;
  const ok = client.expectOk(res).body;
  return (ok as { result?: NativeSession }).result ?? (ok as NativeSession);
}

async function upsert(
  client: SnowClient,
  table: string,
  coalesceQuery: string,
  fields: Record<string, string>,
): Promise<{ sysId: string; action: "created" | "updated" }> {
  const existing = await client.table.getOne<{ sys_id: string }>(table, { query: coalesceQuery, fields: "sys_id" });
  if (existing) {
    await client.table.update(table, existing.sys_id, fields);
    return { sysId: existing.sys_id, action: "updated" };
  }
  const row = await client.table.insert<{ sys_id: string }>(table, fields);
  return { sysId: row.sys_id, action: "created" };
}

/**
 * Try to enable `sn_atf.schedule.enabled` — `sn_cicd/testsuite/run` rejects
 * with "Scheduled test/suite execution is disabled" without it. On some
 * instances a business rule ("Check if scheduled suites allowed") blocks the
 * Table API write; then it must be toggled by an admin in
 * **ATF → Administration → Properties** ("Enable scheduled test execution").
 */
export async function ensureAtfScheduleEnabled(client: SnowClient): Promise<"already" | "set" | "blocked"> {
  const prop = "sn_atf.schedule.enabled";
  const row = await client.table.getOne<{ sys_id: string; value: string }>("sys_properties", {
    query: `name=${prop}`,
    fields: "sys_id,value",
  });
  if (row?.value === "true") return "already";
  try {
    if (row) await client.table.update("sys_properties", row.sys_id, { value: "true" });
    else await client.table.insert("sys_properties", { name: prop, value: "true", type: "boolean" });
    return "set";
  } catch (e) {
    if (e instanceof SnowError && (e.info.kind === "FORBIDDEN" || e.info.kind === "SERVER_ERROR")) return "blocked";
    throw e;
  }
}

export interface InstallResult {
  basePath: string;
  scriptInclude: "created" | "updated";
  definition: "created" | "updated";
  operations: Record<string, "created" | "updated">;
}

/** Idempotently create/update the Script Include, the API definition and its two operations. */
export async function installNativeResource(client: SnowClient): Promise<InstallResult> {
  const namespace = await globalNamespace(client);

  const si = await upsert(client, "sys_script_include", `name=${NATIVE_SI_NAME}`, {
    name: NATIVE_SI_NAME,
    api_name: `global.${NATIVE_SI_NAME}`,
    script: nativeScriptIncludeBody(),
    active: "true",
    access: "public",
    client_callable: "false",
    description: "SnowDevTeam Native Engine — server-side apply (NATIVE_ENGINE_BRIEF Phase 5).",
  });

  const def = await upsert(client, "sys_ws_definition", `service_id=${NATIVE_SERVICE_ID}^namespace=${namespace}`, {
    name: DEF_NAME,
    namespace,
    service_id: NATIVE_SERVICE_ID,
    active: "true",
    consumes: "application/json",
    produces: "application/json",
    short_description: "SnowDevTeam Native Engine apply resource (Global). Do not edit — pushed by setup-native-engine.mts.",
  });

  const operations: Record<string, "created" | "updated"> = {};
  for (const [key, op] of Object.entries(OPERATION_SCRIPTS)) {
    const r = await upsert(
      client,
      "sys_ws_operation",
      `web_service_definition=${def.sysId}^http_method=${op.httpMethod}^relative_path=${op.relativePath}`,
      {
        name: `sdt_native ${key}`,
        web_service_definition: def.sysId,
        http_method: op.httpMethod,
        relative_path: op.relativePath,
        operation_script: op.script,
        active: "true",
        requires_authentication: "true",
        requires_acl_authorization: "false",
        consumes: "application/json",
        produces: "application/json",
      },
    );
    operations[key] = r.action;
  }

  return {
    basePath: `/api/${namespace}/${NATIVE_SERVICE_ID}`,
    scriptInclude: si.action,
    definition: def.action,
    operations,
  };
}

export interface ApplyOneResult {
  ok: boolean;
  sysId?: string;
  table?: string;
  operation?: "inserted" | "updated";
  currentUpdateSet?: string;
  currentScope?: string;
  error?: string;
  wanted?: string;
  got?: string;
}

/** POST one resolved change to `<base>/apply`. */
export async function applyOneChange(
  client: SnowClient,
  opts: {
    scopeSysId: string;
    updateSetSysId: string;
    change: {
      table: string;
      op: "insert" | "update";
      coalesceQuery?: string;
      sysId?: string;
      fields: Record<string, string | number | boolean>;
    };
  },
): Promise<ApplyOneResult> {
  const base = await nativeBasePath(client);
  const res = await client.post<{ result?: ApplyOneResult } & ApplyOneResult>(`${base}/apply`, {
    body: { scopeSysId: opts.scopeSysId, updateSetSysId: opts.updateSetSysId, change: opts.change },
  });
  const payload = (res.body as { result?: ApplyOneResult })?.result ?? (res.body as ApplyOneResult);
  if (res.status >= 500 || (!res.ok && !payload?.error)) {
    throw new SnowError(res.error ?? { kind: "UNKNOWN", status: res.status, message: "native /apply failed" });
  }
  return payload;
}
