import { runNowSdk } from "@/lib/nowsdk/cli";
import { config } from "@/lib/config";
import type { TargetScope } from "@/lib/constants";
import type { KeyRecord } from "@/lib/nowsdk/keys";
import type { SnowClient } from "@/lib/servicenow/client";

interface QueryOutcome {
  table: string;
  query: string;
  ok: boolean;
  records: Record<string, unknown>[];
  raw: string;
}

async function snQuery(projectDir: string, table: string, query: string, fields: string): Promise<QueryOutcome> {
  const { stdout, stderr, code } = await runNowSdk(
    ["query", table, "-q", query, "-f", fields, "--limit", "50", "-o", "json"],
    { cwd: projectDir, timeoutMs: 60_000, maxChars: 12_000 },
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
  /** True only if this build's catalog item(s) resolve on the instance and are active. */
  confirmed: boolean;
  reason: string;
  markdown: string;
}

function idQuery(ids: string[]): string {
  return ids.map((id) => `sys_id=${id}`).join("^OR");
}

/**
 * Post-deploy check: a clean `now-sdk install` exit code is not evidence. Look
 * up the exact sys_ids this build created (from the keys.ts diff) and confirm
 * they exist and are active on the instance — scope-agnostic.
 */
export async function verifyDeployment(opts: {
  scope: TargetScope;
  /** The project's real scope string, e.g. "x_1460392_delivery" or "global" —
   *  the actual customer app, not a hard-coded constant. */
  scopeName: string;
  /** The project directory to run `now-sdk query` from. */
  projectDir: string;
  /** Net-new records from the keys.ts diff for this build. */
  created: KeyRecord[];
  /** Every record in keys.ts after the build — fallback when `created` is empty
   *  (e.g. a re-deploy where the records were already in the baseline). */
  allRecords?: KeyRecord[];
}): Promise<DeploymentVerification> {
  const { scope, scopeName, projectDir, created } = opts;
  const byTable = (recs: KeyRecord[], t: string) => recs.filter((r) => r.table === t).map((r) => r.id);
  const pick = (t: string) => {
    const net = byTable(created, t);
    return net.length > 0 ? net : byTable(opts.allRecords ?? [], t);
  };
  const catItemIds = pick("sc_cat_item");
  const flowIds = pick("sys_hub_flow");
  const tableIds = pick("sys_db_object");

  const queries: Promise<QueryOutcome>[] = [];
  const catIdx = catItemIds.length ? queries.push(snQuery(projectDir, "sc_cat_item", idQuery(catItemIds), "name,sys_id,active,sys_scope.scope")) - 1 : -1;
  const flowIdx = flowIds.length ? queries.push(snQuery(projectDir, "sys_hub_flow", idQuery(flowIds), "name,sys_id,active")) - 1 : -1;
  const tableIdx = tableIds.length ? queries.push(snQuery(projectDir, "sys_db_object", idQuery(tableIds), "name,label,sys_id")) - 1 : -1;
  const appIdx =
    scope === "scoped"
      ? queries.push(snQuery(projectDir, "sys_app", `scope=${scopeName}`, "name,scope,version,active")) - 1
      : -1;

  const results = await Promise.all(queries);
  const catItems = catIdx >= 0 ? results[catIdx] : null;
  const flows = flowIdx >= 0 ? results[flowIdx] : null;
  const tables = tableIdx >= 0 ? results[tableIdx] : null;
  const app = appIdx >= 0 ? results[appIdx] : null;

  const isActive = (r: Record<string, unknown>) => r.active === true || r.active === "true";
  const foundCat = catItems?.records ?? [];
  const activeCat = foundCat.filter(isActive);

  const appOk = scope === "global" || (app?.records.length ?? 0) > 0;
  const catExpected = catItemIds.length;
  const catOk = catExpected > 0 && activeCat.length >= catExpected;
  const confirmed = appOk && catOk;

  const reason = !appOk
    ? `No sys_app row for scope ${scopeName} — the scoped install did not land.`
    : catExpected === 0
      ? "This build declared no catalog item — nothing to confirm."
      : catOk
        ? `All ${catExpected} catalog item(s) resolve on the instance and are active.`
        : `Expected ${catExpected} active catalog item(s); found ${activeCat.length}.`;

  const list = (recs: Record<string, unknown>[], nameKey = "name") =>
    recs.length === 0
      ? "_(none)_"
      : recs
          .map(
            (r) =>
              `- \`${String(r[nameKey] ?? "?")}\` — \`${String(r.sys_id ?? "?")}\`` +
              (r["sys_scope.scope"] ? ` · scope: \`${String(r["sys_scope.scope"])}\`` : "") +
              (r.active !== undefined ? ` (active: ${String(r.active)})` : ""),
          )
          .join("\n");

  const declaredRecs = created.length > 0 ? created : (opts.allRecords ?? []);
  const declared = (t: string) =>
    declaredRecs.filter((r) => r.table === t).map((r) => `- \`${r.key}\` — \`${r.id}\``).join("\n") ||
    "_(none)_";

  const markdown = [
    `# Deploy Verification`,
    ``,
    `Instance: \`${config.SN_INSTANCE_URL ?? "(PDI)"}\`  ·  scope: \`${scopeName}\``,
    `Checked: ${new Date().toISOString()}`,
    ``,
    `**Result: ${confirmed ? "CONFIRMED" : "NOT CONFIRMED"}** — ${reason}`,
    ``,
    `## Records checked${created.length === 0 ? " (full keys.ts — re-deploy)" : " (keys.ts diff)"}`,
    ``,
    `**Catalog items**`,
    declared("sc_cat_item"),
    ``,
    `**Flows**`,
    declared("sys_hub_flow"),
    ``,
    `**Custom tables**`,
    declared("sys_db_object"),
    ``,
    ...(scope === "scoped"
      ? [
          `## Scoped application (\`sys_app\`)`,
          app && app.records.length
            ? app.records
                .map(
                  (r) =>
                    `- \`${String(r.name)}\` v\`${String(r.version ?? "?")}\` (active: ${String(r.active)})`,
                )
                .join("\n")
            : "_(not found)_",
          ``,
        ]
      : []),
    `## Catalog items found on instance — ${foundCat.length}/${catExpected}`,
    list(foundCat),
    ``,
    `## Flows found on instance — ${flows?.records.length ?? 0}/${flowIds.length}`,
    list(flows?.records ?? []),
    ``,
    `## Custom tables found on instance — ${tables?.records.length ?? 0}/${tableIds.length}`,
    list(tables?.records ?? []),
    ``,
    `---`,
    ``,
    `## Raw query output`,
    ``,
    ...[app, catItems, flows, tables]
      .filter((o): o is QueryOutcome => o != null)
      .flatMap((o) => [`### \`${o.table}\` — \`${o.query}\``, "```json", o.raw, "```", ""]),
  ].join("\n");

  return { confirmed, reason, markdown };
}

// --- Native engine (NATIVE_ENGINE_BRIEF §5.2) -----------------------------

const SCOPELESS_TABLES = new Set(["sys_atf_test_suite_test", "sys_security_acl_role", "io_set_item"]);

/**
 * Post-apply check for the native engine: re-query every record the change plan
 * created and confirm it exists, is active where the table has an `active`
 * field, and its `sys_scope` matches the intended scope. A clean apply is not
 * evidence — the records must actually resolve.
 */
export async function verifyNativeRecords(
  client: SnowClient,
  opts: {
    created: { changeId: string; table: string; sysId: string }[];
    expectedScopeSysId: string;
    /** The scope *name* ("global", "x_acme_hr") for the human-readable check. */
    expectedScopeName: string;
  },
): Promise<DeploymentVerification> {
  const rows: { changeId: string; table: string; sysId: string; ok: boolean; note: string }[] = [];

  for (const rec of opts.created) {
    try {
      const r = await client.table.getOne<Record<string, unknown>>(rec.table, {
        sysId: rec.sysId,
        fields: "sys_id,active,name,short_description,sys_scope,sys_scope.scope",
      });
      if (!r) {
        rows.push({ ...rec, ok: false, note: "not found on the instance" });
        continue;
      }
      const problems: string[] = [];
      if ("active" in r && (r.active === false || r.active === "false")) problems.push("inactive");
      const scopeVal = String(r["sys_scope.scope"] ?? r["sys_scope"] ?? "");
      if (!SCOPELESS_TABLES.has(rec.table) && scopeVal && scopeVal !== opts.expectedScopeName && !(opts.expectedScopeName === "global" && (scopeVal === "global" || scopeVal === "Global"))) {
        problems.push(`sys_scope="${scopeVal}" (expected "${opts.expectedScopeName}")`);
      }
      rows.push({
        ...rec,
        ok: problems.length === 0,
        note: problems.length ? problems.join("; ") : `\`${String(r.name ?? r.short_description ?? "")}\``,
      });
    } catch (e) {
      rows.push({ ...rec, ok: false, note: e instanceof Error ? e.message : String(e) });
    }
  }

  const bad = rows.filter((r) => !r.ok);
  const confirmed = bad.length === 0 && rows.length > 0;
  const reason = confirmed
    ? `All ${rows.length} record(s) resolve on the instance, active, sys_scope = ${opts.expectedScopeName}.`
    : rows.length === 0
      ? "No records were applied."
      : `${bad.length}/${rows.length} record(s) failed verification: ${bad.map((b) => `${b.table}/${b.sysId} (${b.note})`).join("; ")}`;

  const markdown = [
    "# Deploy Verification (native)",
    "",
    `Checked: ${new Date().toISOString()}  ·  scope: \`${opts.expectedScopeName}\``,
    "",
    `**Result: ${confirmed ? "CONFIRMED" : "NOT CONFIRMED"}** — ${reason}`,
    "",
    "| Change | Table | sys_id | OK | Note |",
    "| --- | --- | --- | --- | --- |",
    ...rows.map((r) => `| ${r.changeId} | \`${r.table}\` | \`${r.sysId}\` | ${r.ok ? "✓" : "✗"} | ${r.note.replace(/\|/g, "\\|")} |`),
    "",
  ].join("\n");

  return { confirmed, reason, markdown };
}
