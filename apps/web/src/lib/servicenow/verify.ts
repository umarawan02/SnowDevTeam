import { runNowSdk } from "@/lib/nowsdk/cli";
import { config } from "@/lib/config";

const SCOPE = "x_1460392_delivery";

interface QueryOutcome {
  table: string;
  query: string;
  ok: boolean;
  records: Record<string, unknown>[];
  raw: string;
}

async function scopeQuery(table: string, query: string, fields: string): Promise<QueryOutcome> {
  const { stdout, stderr, code } = await runNowSdk(
    ["query", table, "-q", query, "-f", fields, "--limit", "50", "-o", "json"],
    { timeoutMs: 60_000 },
  );
  const raw = (stdout || stderr).trim();
  try {
    const parsed = JSON.parse(stdout) as { ok?: boolean; records?: Record<string, unknown>[] };
    return { table, query, ok: code === 0 && parsed.ok !== false, records: parsed.records ?? [], raw };
  } catch {
    return { table, query, ok: false, records: [], raw };
  }
}

export interface DeploymentVerification {
  /** True only if the scoped app row exists AND at least one catalog item is in scope. */
  confirmed: boolean;
  reason: string;
  markdown: string;
  app: QueryOutcome;
  catalogItems: QueryOutcome;
  flows: QueryOutcome;
  tables: QueryOutcome;
}

/**
 * Post-deploy check: a clean `now-sdk install` exit code is not evidence. Query
 * the instance for what should now exist in the app scope.
 */
export async function verifyDeployment(): Promise<DeploymentVerification> {
  const [app, catalogItems, flows, tables] = await Promise.all([
    scopeQuery("sys_app", `scope=${SCOPE}`, "name,scope,version,active"),
    scopeQuery("sc_cat_item", `sys_scope.scope=${SCOPE}`, "name,sys_id,active,sys_class_name"),
    scopeQuery("sys_hub_flow", `sys_scope.scope=${SCOPE}`, "name,sys_id,active,type"),
    scopeQuery("sys_db_object", `nameSTARTSWITH${SCOPE}_`, "name,label,sys_id"),
  ]);

  const appOk = app.records.length > 0;
  const hasCatalogItem = catalogItems.records.length > 0;
  const confirmed = appOk && hasCatalogItem;
  const reason = confirmed
    ? "Scoped app installed and at least one catalog item is present."
    : !appOk
      ? `No sys_app row for scope ${SCOPE} — the install did not land.`
      : `App installed but no catalog item found in scope ${SCOPE}.`;

  const list = (o: QueryOutcome, nameKey = "name") =>
    o.records.length === 0
      ? "_(none)_"
      : o.records
          .map((r) => `- \`${String(r[nameKey] ?? "?")}\` — \`${String(r.sys_id ?? "?")}\``)
          .join("\n");

  const markdown = [
    `# Deploy Verification`,
    ``,
    `Instance: \`${config.SN_INSTANCE_URL ?? "(PDI)"}\`  ·  scope: \`${SCOPE}\``,
    `Checked: ${new Date().toISOString()}`,
    ``,
    `**Result: ${confirmed ? "CONFIRMED" : "NOT CONFIRMED"}** — ${reason}`,
    ``,
    `## Scoped application (\`sys_app\`)`,
    app.records.length
      ? app.records
          .map((r) => `- \`${String(r.name)}\` v\`${String(r.version ?? "?")}\` (active: ${String(r.active)})`)
          .join("\n")
      : "_(not found)_",
    ``,
    `## Catalog items (\`sc_cat_item\`) — ${catalogItems.records.length}`,
    list(catalogItems),
    ``,
    `## Flows (\`sys_hub_flow\`) — ${flows.records.length}`,
    list(flows),
    ``,
    `## Custom tables (\`sys_db_object\`) — ${tables.records.length}`,
    list(tables),
    ``,
    `---`,
    ``,
    `## Raw query output`,
    ``,
    ...[app, catalogItems, flows, tables].flatMap((o) => [
      `### \`${o.table}\` — \`${o.query}\``,
      "```json",
      o.raw,
      "```",
      "",
    ]),
  ].join("\n");

  return { confirmed, reason, markdown, app, catalogItems, flows, tables };
}
