import type { ChangePlan } from "@/lib/nativeengine/plan";
import { ALLOWED } from "@/lib/nativeengine/tables";
import type { AppliedChange } from "@/lib/nativeengine/apply";

/**
 * The human-readable "what was built and deployed" list (Phase 8). Written as a
 * `DELIVERY_SUMMARY` artifact after a successful apply, and shown as a panel on
 * the ticket page — so a reviewer sees exactly what landed, by name, with links.
 */

const GROUP_ORDER: { label: string; tables: string[] }[] = [
  { label: "Catalog item", tables: ["sc_cat_item", "sc_cat_item_producer"] },
  { label: "Category", tables: ["sc_category"] },
  { label: "Variables", tables: ["item_option_new", "item_option_new_set", "io_set_item"] },
  { label: "UI policies", tables: ["catalog_ui_policy", "catalog_ui_policy_action", "sys_ui_policy", "sys_ui_policy_action"] },
  { label: "Client scripts", tables: ["catalog_script_client", "sys_script_client"] },
  { label: "Business rules", tables: ["sys_script"] },
  { label: "Script includes", tables: ["sys_script_include"] },
  { label: "UI actions", tables: ["sys_ui_action"] },
  { label: "Notifications", tables: ["sysevent_email_action", "sysevent_register"] },
  { label: "ACLs", tables: ["sys_security_acl", "sys_security_acl_role"] },
  { label: "SLAs", tables: ["contract_sla"] },
  { label: "Scheduled jobs", tables: ["sysauto_script"] },
  { label: "Fields & choices", tables: ["sys_dictionary", "sys_choice"] },
  { label: "Forms", tables: ["sys_ui_form", "sys_ui_section", "sys_ui_element"] },
  { label: "ATF", tables: ["sys_atf_test", "sys_atf_step", "sys_atf_test_suite", "sys_atf_test_suite_test"] },
];

function recordLabel(plan: ChangePlan, changeId: string, table: string): string {
  const c = plan.changes.find((x) => x.id === changeId);
  const f = c?.fields ?? {};
  const pick = (k: string) => (typeof f[k] === "string" ? (f[k] as string) : undefined);
  return (
    pick("name") ??
    pick("title") ??
    pick("question_text") ??
    pick("short_description") ??
    pick("event_name") ??
    `${ALLOWED[table]?.label ?? table} (${changeId})`
  );
}

function deepLink(instanceUrl: string, table: string, sysId: string): string {
  return `${instanceUrl.replace(/\/+$/, "")}/nav_to.do?uri=${table}.do%3Fsys_id%3D${sysId}`;
}

export function deliverySummaryMarkdown(opts: {
  plan: ChangePlan;
  applied: AppliedChange[];
  instanceName: string;
  instanceUrl: string;
  updateSetName: string;
  updateSetSysId: string;
  scope: string;
}): string {
  const { plan, applied, instanceUrl } = opts;
  const lines: string[] = [
    `# Delivered — ${applied.length} record(s)`,
    "",
    `**${opts.instanceName}** · scope \`${opts.scope}\` · update set ` +
      `[${opts.updateSetName}](${deepLink(instanceUrl, "sys_update_set", opts.updateSetSysId)})`,
    "",
  ];

  const seen = new Set<string>();
  for (const g of GROUP_ORDER) {
    const rows = applied.filter((a) => g.tables.includes(a.table));
    if (rows.length === 0) continue;
    lines.push(`## ${g.label}`, "");
    for (const r of rows) {
      seen.add(r.sysId);
      const name = recordLabel(plan, r.changeId, r.table);
      lines.push(`- [${name}](${deepLink(instanceUrl, r.table, r.sysId)}) — \`${r.table}\` · ${r.operation}`);
    }
    lines.push("");
  }

  const other = applied.filter((a) => !seen.has(a.sysId));
  if (other.length) {
    lines.push("## Other", "");
    for (const r of other) {
      lines.push(`- [${recordLabel(plan, r.changeId, r.table)}](${deepLink(instanceUrl, r.table, r.sysId)}) — \`${r.table}\` · ${r.operation}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
