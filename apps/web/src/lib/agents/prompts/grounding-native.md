# The native engine — working knowledge

You are working on a **native-tier** ticket. You do **not** write ServiceNow
Fluent / `.now.ts` code and you do **not** run `now-sdk build`. Instead the
engine writes metadata records directly through the Table API, exactly the way a
human developer does: application picker set to the right scope, a per-ticket
**update set** current, records edited one by one, the update set promoted
dev → test → prod.

The Developer's build output is a **change plan** — a validated JSON document —
plus any server-side script files it references.

## The change plan

```jsonc
{
  "scope": "global",                          // from the Project context — "global" or an x_… app scope
  "updateSetName": "SDT-abcdef Reset MFA",     // informational; the engine creates it
  "changes": [
    {
      "id": "cat_item",                        // unique within the plan; other changes $ref it
      "table": "sc_cat_item",
      "op": "insert",                          // "insert" | "update" — NEVER "delete"
      "coalesce": { "name": "name" },          // how to find-or-create: {recordField: fieldNameInFields}
      "fields": {
        "name": "Reset MFA",
        "short_description": "Reset your multi-factor authentication",
        "active": true,
        "sc_catalogs": { "$lookup": { "table": "sc_catalog", "query": "title=Service Catalog", "field": "sys_id" } }
      },
      "reason": "The catalog item users order from."             // one line, for the reviewer
    },
    {
      "id": "var_reason",
      "table": "item_option_new",
      "op": "insert",
      "coalesce": { "name": "name", "cat_item": "cat_item" },
      "fields": {
        "name": "reason",
        "question_text": "Why do you need a reset?",
        "type": "2",
        "cat_item": { "$ref": "cat_item" }     // → the sys_id of the change with id "cat_item"
      },
      "reason": "Captures context for the fulfiller."
    },
    {
      "id": "assign_br",
      "table": "sys_script",
      "op": "insert",
      "coalesce": { "name": "name", "collection": "collection" },
      "fields": { "name": "Reset MFA — route to Service Desk", "collection": "sc_req_item", "when": "before" },
      "script": { "file": "route-to-service-desk.js" },          // a script field lives in a file
      "reason": "Sets the fulfilment group when the item is a Reset MFA request."
    }
  ]
}
```

### Field values

A `fields` value is a string, number, boolean, or one of:

- **`{ "$ref": "<change id>" }`** — resolves to the sys_id the engine creates for
  that change. Ordering is derived from the `$ref` graph automatically.
- **`{ "$lookup": { "table": "<t>", "query": "<encoded query>", "field": "sys_id" } }`**
  — resolves an **existing** OOB record at apply time (a group by name, a
  catalog, a category). Use this for every reference to a record you did not
  create.

### ⚠ Never invent or hard-code a sys_id

A literal 32-hex string anywhere in a `fields` value is a **hard validation
error**. Reference records by `$ref` (things you create) or `$lookup` (things
that already exist). This mirrors the Fluent rule and the reason is the same:
sys_ids differ per instance.

### `op` is only `insert` or `update`

There is no `delete`. The engine never removes a record by any route.
`insert` + `coalesce` is idempotent find-or-create.

## Tables you may write

Call **`table_spec <table>`** for the exact required fields, coalesce keys, risk
and gotchas of any table before you first use it. The allow-list, grouped:

- **Catalog:** `sc_cat_item`, `sc_cat_item_producer` (record producer),
  `item_option_new` (variable), `item_option_new_set` / `io_set_item` (variable
  sets), `catalog_ui_policy` (+ `_action`), `catalog_script_client`,
  `sc_cat_item_user_criteria_mtom`, `sc_category`.
- **Server logic:** `sys_script` (business rule), `sys_script_include`,
  `sys_script_client` (client script), `sys_ui_action`, `sys_ui_policy`
  (+ `_action`), `sys_security_acl` (+ `_role`) — **high risk**,
  `sysevent_email_action` (notification), `sysevent_register`, `sysauto_script`
  (scheduled job).
- **Data model — fields on EXISTING tables only:** `sys_dictionary` (high risk —
  a field on an existing table, never a new table), `sys_choice`.
- **Forms:** `sys_ui_form`, `sys_ui_section`, `sys_ui_element`.
- **SLA:** `contract_sla`.
- **ATF:** `sys_atf_test`, `sys_atf_step`, `sys_atf_test_suite`,
  `sys_atf_test_suite_test`.
- **Service Portal:** `sp_widget`.

Anything else — `sys_db_object` (new table), `sys_hub_flow` and `sys_hub_*`
(Flow Designer), `sys_ux_*` / `sys_aw_*` (UI Builder / Agent Workspace), any
`sn_*` vendor table — is **denied**. `table_spec` returns the correct route
(the Fluent flow/app tier, the Build Agent, or a human). Do not try to work
around a denial.

## Script files — the lint rules (these fail `validate_plan`)

Script bodies (`sys_script`, `sys_script_include`, `sys_ui_action`,
`catalog_script_client`, `sysauto_script`, `sp_widget`) live in `.js` files you
emit alongside the plan. They must pass these checks:

- **No hard-coded 32-hex sys_id** — resolve records with a filtered
  `GlideRecord` query, not by id.
- **`gs.info` / `gs.warn` / `gs.error`, never `gs.log`** — `gs.log` is unavailable
  in scoped code.
- **No `eval(`**, no `document.` / `window.` / jQuery in a server script.
- **A business rule body is wrapped:**
  `(function executeRule(current, previous) { … })(current, previous);`
- **No `current.update()` in a `when="before"` business rule** — the platform
  saves `current` for you.
- **Every `GlideRecord` is filtered** — an `addQuery` / `addEncodedQuery` /
  `.get()` before `.query()`. A `while (gr.next())` loop that calls `.update()`
  needs a `setLimit`.
- **A `when="before"` business rule on a large table** (`incident`, `task`,
  `sys_user`, `sc_req_item`, `sc_task`, `cmdb_ci`, `change_request`, `problem`)
  **must have a `condition` or `filter_condition`** on the record.
- **A script include that exposes an API uses `Class.create()` / `prototype`.**
- Warnings (won't fail, but fix if easy): a `sn_ws.RESTMessageV2` call with no
  `try/catch`; writes with no visible `sys_domain` handling; a script over 150
  lines that should be a script include.

## ITSM idioms

The common request is **one catalog item + its variables + a UI policy +
notifications + an ATF test**. Typical plan shape:

1. `sc_cat_item` (coalesce on `name`) — set `sc_catalogs` and `category` via
   `$lookup`.
2. `item_option_new` variables (coalesce on `name` + `cat_item` via `$ref`).
   `type` is a number string: `"6"` single-line, `"2"` multi-line, `"8"`
   reference, `"5"` select box, `"3"` checkbox, `"1"` yes/no.
3. `catalog_ui_policy` (+ `_action`) for read-only / mandatory / visibility
   behaviour driven by other variables.
4. A `sys_script` **before** business rule on `sc_req_item` (with a `condition`
   scoping it to this item — required) for server-side routing / defaulting,
   OR a flow reuse (see the route — if the route says a flow already covers the
   orchestration, only write the item→flow configuration, not new logic).
5. `sysevent_email_action` notifications on `sc_req_item` — reference catalog
   variables in the template with `${variables.<name>}`.
6. `contract_sla` if the requirement has a fulfilment target.
7. **ATF:** one `sys_atf_test` + its `sys_atf_step`s, wrapped in a
   `sys_atf_test_suite` (+ `sys_atf_test_suite_test` linking the test into the
   suite) so QA can run it headless. Use `$lookup` on `sys_atf_step_config` by
   `name` for the step type (e.g. `name=Order Catalog Item`).

Reading a catalog-variable value server-side: `current.getValue('variables.<name>')`
in a business rule / script include on `sc_req_item` (the typed accessor doesn't
know custom variables).

## `validate_plan` is your build step

Call **`validate_plan`** with the full CHANGE_PLAN JSON and every script file.
It runs the schema + semantic checks, the lint rules, a TypeScript check of the
scripts, and a **read-only** dry-run diff against the instance. Fix every error
it reports and call it again. **Do not emit your final answer until it reports
no errors.** It never writes anything — apply happens later, only after a human
approves the diff.
