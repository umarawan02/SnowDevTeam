/**
 * Table allow-list for the native engine change plan (NATIVE_ENGINE_BRIEF §4.2).
 * The Developer may only write to these tables via the Table API; everything
 * else is denied with a message naming the correct route (Fluent tier, Build
 * Agent, or a human).
 */

export interface TableSpec {
  label: string;
  /** Fields that must be present on an `insert`. */
  requiredFields: string[];
  /** Sensible `coalesce` keys for find-or-create. */
  coalesce: string[];
  /** Which `fields` key on this table holds a script body, if any. */
  scriptField?: string;
  risk?: "high";
  notes?: string;
}

export const ALLOWED: Record<string, TableSpec> = {
  // --- Service Catalog ---------------------------------------------------
  sc_cat_item: {
    label: "Catalog Item",
    requiredFields: ["name", "short_description"],
    coalesce: ["name"],
    notes: "set sc_catalogs / category via $lookup; leave sys_class_name unless a record producer",
  },
  sc_cat_item_producer: {
    label: "Record Producer",
    requiredFields: ["name", "table_name"],
    coalesce: ["name"],
  },
  item_option_new: {
    label: "Catalog Variable",
    requiredFields: ["name", "question_text", "type", "cat_item"],
    coalesce: ["name", "cat_item"],
    notes: "type is a number (6=single line, 8=reference, …); cat_item via $ref",
  },
  io_set_item: { label: "Variable Set → Item", requiredFields: ["sc_cat_item", "variable_set"], coalesce: ["sc_cat_item", "variable_set"] },
  item_option_new_set: { label: "Variable Set", requiredFields: ["title"], coalesce: ["internal_name"] },
  catalog_ui_policy: {
    label: "Catalog UI Policy",
    requiredFields: ["catalog_item", "short_description"],
    coalesce: ["short_description", "catalog_item"],
  },
  catalog_ui_policy_action: {
    label: "Catalog UI Policy Action",
    requiredFields: ["ui_policy", "catalog_item", "catalog_variable"],
    coalesce: ["ui_policy", "catalog_variable"],
  },
  catalog_script_client: {
    label: "Catalog Client Script",
    requiredFields: ["name", "cat_item", "type", "script"],
    coalesce: ["name", "cat_item"],
    scriptField: "script",
  },
  sc_cat_item_user_criteria_mtom: {
    label: "Catalog Item → User Criteria",
    requiredFields: ["sc_cat_item", "user_criteria"],
    coalesce: ["sc_cat_item", "user_criteria"],
  },
  sc_category: { label: "Catalog Category", requiredFields: ["title"], coalesce: ["title", "sc_catalog"] },

  // --- Server logic ----------------------------------------------------------
  sys_script: {
    label: "Business Rule",
    requiredFields: ["name", "collection", "when"],
    coalesce: ["name", "collection"],
    scriptField: "script",
    notes: "wrap the body in (function executeRule(current, previous){…})(current, previous);",
  },
  sys_script_include: {
    label: "Script Include",
    requiredFields: ["name", "script"],
    coalesce: ["name"],
    scriptField: "script",
    notes: "Class.create() / prototype shape when it declares an API",
  },
  sys_script_client: {
    label: "Client Script",
    requiredFields: ["name", "table", "type", "script"],
    coalesce: ["name", "table"],
    scriptField: "script",
  },
  sys_ui_action: {
    label: "UI Action",
    requiredFields: ["name", "table"],
    coalesce: ["name", "table"],
    scriptField: "script",
  },
  sys_ui_policy: {
    label: "UI Policy",
    requiredFields: ["table", "short_description"],
    coalesce: ["short_description", "table"],
  },
  sys_ui_policy_action: {
    label: "UI Policy Action",
    requiredFields: ["ui_policy", "field"],
    coalesce: ["ui_policy", "field"],
  },
  sys_security_acl: {
    label: "ACL",
    requiredFields: ["name", "operation"],
    coalesce: ["name", "operation", "type"],
    scriptField: "script",
    risk: "high",
    notes: "an over-broad ACL is a security hole — always scope with roles / a condition",
  },
  sys_security_acl_role: {
    label: "ACL → Role",
    requiredFields: ["sys_security_acl", "sys_user_role"],
    coalesce: ["sys_security_acl", "sys_user_role"],
  },
  sysevent_email_action: {
    label: "Notification",
    requiredFields: ["name", "collection"],
    coalesce: ["name", "collection"],
  },
  sysevent_register: { label: "Event Registration", requiredFields: ["event_name", "table"], coalesce: ["event_name"] },
  sysauto_script: {
    label: "Scheduled Job",
    requiredFields: ["name"],
    coalesce: ["name"],
    scriptField: "script",
  },

  // --- Data model (fields on existing tables only) --------------------------
  sys_dictionary: {
    label: "Dictionary (field on an existing table)",
    requiredFields: ["name", "element", "internal_type"],
    coalesce: ["name", "element"],
    risk: "high",
    notes: "fields on existing tables ONLY — never a new table; prefer the Fluent tier or a human",
  },
  sys_choice: {
    label: "Choice",
    requiredFields: ["name", "element", "value", "label"],
    coalesce: ["name", "element", "value"],
  },

  // --- Forms / UI ----------------------------------------------------------
  sys_ui_form: { label: "Form", requiredFields: ["name", "view"], coalesce: ["name", "view"] },
  sys_ui_section: { label: "Form Section", requiredFields: ["name"], coalesce: ["name", "view"] },
  sys_ui_element: { label: "Form Element", requiredFields: ["sys_ui_section"], coalesce: ["sys_ui_section", "element"] },

  // --- SLA ----------------------------------------------------------------
  contract_sla: { label: "SLA Definition", requiredFields: ["name", "collection"], coalesce: ["name", "collection"] },

  // --- ATF ---------------------------------------------------------------
  sys_atf_test: { label: "ATF Test", requiredFields: ["name"], coalesce: ["name"] },
  sys_atf_step: {
    label: "ATF Step",
    requiredFields: ["test", "step_config"],
    coalesce: ["test", "step_config"],
    notes: "no stable natural key — `order` is auto-assigned and ATF may re-point `step_config`; a re-apply can create a duplicate step (rework loops only, harmless)",
  },
  sys_atf_test_suite: { label: "ATF Test Suite", requiredFields: ["name"], coalesce: ["name"] },
  sys_atf_test_suite_test: {
    label: "ATF Test Suite → Test",
    requiredFields: ["test_suite", "test"],
    coalesce: ["test_suite", "test"],
    notes: "links a test into a suite so it can be run headless via sn_cicd/testsuite/run",
  },

  // --- Service Portal ---------------------------------------------------------
  sp_widget: {
    label: "Service Portal Widget",
    requiredFields: ["name", "id"],
    coalesce: ["id"],
    scriptField: "script",
  },
};

/** Explicitly denied — with the correct route. */
export const DENIED: Record<string, string> = {
  sys_db_object: "table creation is not a Table-API operation — use the Fluent tier or a human for schema",
  sys_hub_flow: "Flow Designer flows are not reliably authorable via Table API — route to the Fluent flow tier",
  sys_hub_action_instance_v2: "flow internals — route to the Fluent flow tier",
  sys_hub_flow_logic_instance_v2: "flow internals — route to the Fluent flow tier",
  sys_hub_trigger_instance_v2: "flow internals — route to the Fluent flow tier",
  sys_hub_action_type_definition: "custom flow actions — route to the Fluent flow tier",
};

const DENIED_PREFIXES = ["sys_hub_", "sys_ux_", "sys_aw_", "sys_declarative_", "sn_"];

export type TableClassification =
  | { kind: "allowed"; spec: TableSpec }
  | { kind: "denied"; reason: string };

export function classifyTable(name: string): TableClassification {
  if (ALLOWED[name]) return { kind: "allowed", spec: ALLOWED[name] };
  if (DENIED[name]) return { kind: "denied", reason: DENIED[name] };
  const prefix = DENIED_PREFIXES.find((p) => name.startsWith(p));
  if (prefix) {
    return {
      kind: "denied",
      reason:
        prefix === "sys_hub_"
          ? `${name} is Flow Designer internals — route to the Fluent flow tier`
          : prefix === "sn_"
            ? `${name} is a vendor-scoped table — not supported; recommend Build Agent / a human in the ADR`
            : `${name} (UI Builder / Agent Workspace / declarative) is not reliably Table-API authorable — route to a human`,
    };
  }
  return {
    kind: "denied",
    reason: `${name} is not on the native allow-list — if it is genuinely needed, route to the Fluent tier or a human`,
  };
}
