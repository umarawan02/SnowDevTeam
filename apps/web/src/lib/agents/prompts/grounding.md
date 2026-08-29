# ServiceNow SDK / Fluent — working knowledge

This is a curated distillation of the project's cached orientation
(`docs/now-sdk-orientation.md`, generated from `@servicenow/sdk` v4.11.2). It is
**not exhaustive**. For the exact shape of any metadata type you are about to
use — especially `Flow`, `CatalogItem`, `CatalogItemRecordProducer`, `Table`,
`Acl` — call the `explain` tool: `mode:"list"` to find the topic, `mode:"peek"`
to confirm it's relevant, `mode:"full"` to read it. Do not write Fluent from
memory when `explain` can give you the real syntax.

## This project

- now-sdk project: `servicenow/delivery-app/`
- Application scope: **`x_1460392_delivery`** — every custom table this app
  creates is named `x_1460392_delivery_<something>`.
- Fluent source lives in `src/fluent/**/*.now.ts`; server-side modules in
  `src/server/**/*.ts`. `keys.ts` is auto-generated at `src/fluent/generated/keys.ts`.
- Build: `now-sdk build`. Deploy: `now-sdk install` (alias `now-sdk deploy`).
  Deploy is **human-gated in this product** and only happens in Phase 3 — never
  assume it has run.

## Fluent basics

`.now.ts` files import metadata constructors from `@servicenow/sdk/core` and call
them at module top level:

```typescript
import { Table, StringColumn, BooleanColumn, Reference } from '@servicenow/sdk/core'

export const x_1460392_delivery_request = Table({
  name: 'x_1460392_delivery_request',
  schema: {
    short_description: StringColumn({ label: 'Short description', maxLength: 160, mandatory: true }),
    approved: BooleanColumn({ label: 'Approved' }),
  },
})
```

- The `Now` global (`Now.ID`, `Now.ref`, `Now.include`, `Now.attach`, `Now.del`)
  and the data helpers (`Duration`, `Time`, `TemplateValue`, `FieldList`) are
  **injected globals — never import them**. Import metadata constructors
  (`Table`, `BusinessRule`, `Record`, column types, `CatalogItem`, the
  `*Variable` types, `CatalogUiPolicy`, `CatalogClientScript`, `UiPolicy`,
  `UserCriteria`, `EmailNotification`, `Sla`, `Acl`, `Role`) from
  `@servicenow/sdk/core`. Import flow constructs (`Flow`, `FlowStage`, `wfa`,
  `trigger`, `action`) from `@servicenow/sdk/automation`.

## Fluent authoring — hard rules (these break the build)

The `.now.ts` transpiler **statically parses the AST** — it does not execute your
code. Violating any of these fails `now-sdk build`, which blocks deploy.

### Property values must be static

- A property value is a **single string literal**, a **single template literal**,
  a number/boolean, an imported Fluent record reference, `Now.ref(...)`,
  `Now.include(...)`, `TemplateValue({...})`, `Duration({...})`, `Time({...})`,
  or an object/array literal of those.
- **Never** use `'a' + 'b'` string concatenation, a function call you wrote, a
  ternary, or a local `const` as a value. `messageHtml: '<p>x</p>' + '<p>y</p>'`
  → `TS303 Failed to parse property` / `TS213 Unsupported variable initializer`.
  Put the whole HTML in one backtick template literal instead.
- Don't declare helper functions or factories in a `.now.ts` file.

### Catalog variables (`SingleLineTextVariable`, `MultiLineTextVariable`, `SelectBoxVariable`, `ReferenceVariable`, `DateVariable`, `CheckboxVariable`, `RequestedForVariable`)

- There is **no `maxLength`** on any variable type — that is a `StringColumn`
  property only. `validateRegex` exists on `SingleLineTextVariable` but **not**
  on `MultiLineTextVariable`. Don't put input-length limits on variables at all
  for the MVP.
- `mandatory: true` **cannot** coexist with `readOnly: true` or `hidden: true` on
  the same variable — the SDK rejects it. To get an auto-populated read-only
  field that must have a value, make it `mandatory` and enforce read-only with a
  `CatalogUiPolicy` (`readOnly` action), not on the variable.
- `dependentQuestion` takes the **string name** of the other variable (e.g.
  `'requested_for'`), not the variable const.
- Common real props: `question` (required), `mandatory`, `readOnly`, `hidden`,
  `order`, `defaultValue`, `helpText`, `validateRegex`, `choices` (SelectBox),
  `referenceTable` + `referenceQualCondition` (Reference), `useDynamicDefault` +
  `dependentQuestion` + `dotWalkPath`.

### Flows — the declarative rules (`explain wfa-flow-guide` + `wfa-flow-actions-guide` in full first)

- **Every trigger-data or action-output reference used in an action parameter or
  a condition must be wrapped in `wfa.dataPill(expr, 'type')`.** Bare
  `params.trigger.x` or `result.field` → `TS211: Datapill reference must be
  inside a wfa.dataPill call`.
- **Never assign a data pill to a `const`/`let`/`var`.** Use it directly in the
  action-parameter object. The one allowed capture is
  `const r = wfa.action(action.core.X, {$id}, {...})` to reference `r.output`
  later (itself wrapped: `wfa.dataPill(r.record, 'reference')`).
- **`params.trigger.request_item` (serviceCatalog trigger) only dot-walks to
  real `sc_req_item` columns / references:** `.request`, `.cat_item`,
  `.requested_for`, `.opened_by`, `.state`, `.number`, `.sys_id`. **There is
  `.variables.<name>` — accessing it fails to typecheck (`Property '<name>'
  does not exist on type 'string | number'`).** The SDK does **not** let a flow
  read an individual catalog-variable value. See "Catalog fulfillment" below.
- **Conditions are template literals** with interpolated pills:
  `` condition: `${wfa.dataPill(approval.approval_state, 'choice')}=approved` ``.
  No `javascript:` expressions in `flowLogic.if/elseIf/else` conditions.
- **Template-literal interpolation only works in `ah_subject` and `log_message`.**
  In `message`, `ah_body`, and anywhere inside `TemplateValue({...})`, a
  `${...}` is written literally — pass the data pill directly as the value there.
- `askForApproval` → the **exact** `approvalRules` shape (from the SDK type
  defs — the prose docs are inconsistent, this is authoritative):

  ```typescript
  approval_conditions: wfa.approvalRules({
    conditionType: 'OR',                         // outer: ALWAYS 'OR'
    ruleSets: [{
      action: 'ApprovesRejects',                 // 'Approves' | 'Rejects' | 'ApprovesRejects'
      conditionType: 'AND',                       // inner: ALWAYS 'AND'
      rules: [[{                                  // note the double array [[ ]]
        ruleType: 'Any',                          // camelCase: 'Any' | 'All' | 'Res' | 'Count' | 'Percent'
        users: [wfa.dataPill(params.trigger.request_item.requested_for.manager, 'reference')],
        groups: [],
        manual: false,
      }]],
    }],
  })
  ```
- Exactly one `wfa.trigger(...)` per flow. If a flow callback names `(params)`
  but never uses it, the SDK errors (`TS6133`) — use it or drop the parameter.
- Email-subject/body pills use type `'string_full_utf8'`, not `'string'`.
- `Time.addDays()` / `Time.nowDateTime()` / `gs.daysAgoStart()` do **not** exist.

### Catalog fulfillment — the SDK-idiomatic pattern (do NOT fight this)

A flow **cannot read catalog-variable values**. So:

- **Fulfillment work item = `action.core.createCatalogTask`** (`sc_task`). It
  inherits the catalog variables automatically for the fulfiller to see; pass
  `catalog_variables: [item.variables.a, item.variables.b]` to surface specific
  ones. Do NOT create a custom table with one column per catalog variable and do
  NOT try to populate columns from variables in the flow — that design is
  impossible in Fluent.
- Only introduce a **custom table** if the design needs structured state the
  `sc_task`/RITM don't have (e.g. an expiry timestamp, a provisioned-account id).
  Keep it to a handful of columns plus a reference back to `sc_req_item`. Never
  mirror the form.
- **Notifications** reference catalog variables in their **own** template with
  `${variables.guest_email}` syntax (`EmailNotification` on `sc_req_item`
  supports it) — not via the flow.
- If server-side logic genuinely must read a variable value, do it in a
  **business rule / script include** on `sc_req_item` using
  `current.variables.<name>` — never in the declarative flow.
- The flow's job is: `getCatalogVariables` → `askForApproval` →
  `flowLogic.if` approved → `createCatalogTask` (+ optional minimal
  `createRecord` on a small custom table, populated only from trigger dot-walks
  and static values) → `updateRecord` to set RITM state.

### Server modules

- `src/server/**/*.ts` may import from `@servicenow/glide` and other
  `src/server/` files **only** — importing from `src/fluent/**` fails with
  `TS6059: not under rootDir`. Shared constants a flow needs go inline in the
  `.now.ts`, not in a shared file under `src/fluent/`.

## Record identity — `Now.ID` and `keys.ts`

- Give every top-level record a stable identity: `$id: Now.ID['descriptive-kebab-key']`.
- **Never invent or hardcode a sys_id.** The build system generates sys_ids and
  stores them in `keys.ts`, keyed by your `Now.ID` name. The only real sys_id
  strings allowed in source are ones returned by a live `query`/`transform`.
- Renaming a `Now.ID` key orphans the old record and creates a new one — choose
  names deliberately.
- `keys.ts` is committed to version control (it is the source of truth for
  record identity). It is auto-generated — do not hand-edit.

### ⚠ Deletion safety rule (carry into every review)

Removing a `Table()` / `BusinessRule()` / `Record()` (or any constructor call)
from a `.now.ts` file is **not** a harmless edit. If its `keys.ts` entry remains,
the build emits a **delete record** that removes it from every instance the app
is installed on, through future upgrades. Whether that's correct depends on
install history, which the code alone can't reveal. **An agent must never delete
a constructor call without explicit human confirmation**, and must state that the
deletion may need to propagate via `keys.ts`.

## Referencing other records — `Now.ref`

```typescript
// by coalesce keys
Now.ref('sys_user_role', { name: 'itil' })
// by sys_id (only a real one from a query)
Now.ref('sys_hub_flow', 'a1b2c3…')
// a record defined elsewhere in THIS project: import the exported variable and
// pass it directly (or `variable.$id` where a string identifier is required).
```

- To use a project record's sys_id inside an **encoded-query string** (a
  notification `condition`, a business-rule `condition`), interpolate
  **`${myItem.$id}`** — **not** `${myItem.sys_id}` (`.sys_id` does not exist on
  the constructor's return type).

## Reading catalog variables server-side (business rule / script include)

The `@servicenow/glide` types don't know your custom variables, so
`current.variables.my_var` fails to typecheck. Use **`getValue` with a dot-walk
string**: `current.getValue('variables.guest_account_username')`. Same for a
looked-up RITM: `ritm.getValue('variables.<name>')`.

## Catalog item constructor — MVP constraints

- Do **not** set `deliveryTime` / `fulfillmentTime` with `Duration({...})` — the
  build fails (`Failed to cast DurationShape to ObjectShape`). Omit these props
  for the MVP.
- `$id: Now.ID['…']`, `name`, `shortDescription`, `description`, `active`,
  `category` (`Now.ref('sc_category', {...})` or an imported category record),
  `catalogs`, `availableFor: [userCriteriaRecord]`, `variables: { … }`. No
  `roles`, no `workflow`, no `executionPlan`.

## Server-side scripts — modules vs `Now.include`

- **APIs that accept a function** (`BusinessRule`, `ScriptAction`, `UiAction`,
  scripted REST route handlers, **`CatalogItemRecordProducer` `script` /
  `postInsertScript`**, `ScheduledScript`): write the logic as a typed module in
  `src/server/…`, import Glide APIs explicitly
  (`import { gs, GlideRecord } from '@servicenow/glide'`), and pass the imported
  function to the `script` property.
- **APIs whose `script` is string-only** (`ScriptInclude`, `ClientScript`,
  `CatalogClientScript`, `CatalogUiPolicy`, `UiPolicy`, widget scripts, HTML/CSS,
  `Record` data fields): use `Now.include('./relative/file.js')` or an inline
  template string.
- In scoped apps: import Glide APIs in module files; do **not** use
  `gs.nowDateTime()` (use `new GlideDateTime()`); only use methods that exist in
  `@servicenow/glide` type definitions.

## Demo / sample data

Use the `Record` API with `$meta: { installMethod: 'demo' }` for seed data.

## Catalog item + fulfillment flow (this MVP's target)

The narrow use case is **one Service Catalog item with an attached fulfillment
flow**. The relevant Fluent constructors and their exact properties must be
confirmed with `explain` before use — likely topics:
`explain "catalog" mode:"list"`, `explain "flow" mode:"list"`,
`explain "record producer" mode:"list"`. Expect to need:

- a **Catalog Item** or **Record Producer** (`sc_cat_item` family) with variables
  (form fields) for what the requester provides,
- an **approval** (often modelled inside the flow, or via a catalog item
  `approval` setting),
- a **Flow** (`sys_hub_flow`) that runs on request: manager approval → on
  approval, create a fulfillment `task` / `sc_task` for IT ops,
- optionally a small **custom table** if the request needs to store structured
  data beyond the OOB request tables.

Check the instance first with `query` (e.g. `query sc_cat_item nameLIKElaptop`)
to avoid colliding with an existing item.

## CLI reference (real flags — from the orientation doc)

- `now-sdk build [source]` — `--frozenKeys`, `--errorOnConflict`, `--skipClean`.
- `now-sdk install` (alias `deploy`) — `--auth <alias>`, `-r/--reinstall`,
  `--demoData` (default true), `-b/--open-browser`, `--skip-flow-activation`.
- `now-sdk query <table> -q '<encoded query>' -o json` — `--limit`, `-f/--fields`,
  `--display-value`, `-a/--auth`.
- `now-sdk explain <topic> [--list|--peek] --format=raw`.
