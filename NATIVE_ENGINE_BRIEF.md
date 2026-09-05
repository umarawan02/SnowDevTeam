# SnowDevTeam — Native Developer Engine (replaces REFACTOR_BRIEF phases 3–6)

> Give this to Claude Code at the repo root, alongside the existing `refactor_brief.md`. Phases 1 and 2 of that brief are **done and stay**. This document **supersedes its phases 3, 4, 5 and 6**. Work through the phases below in order. For each: produce a plan, wait for approval, implement, verify with the stated commands, commit.

## 0. What changes and why

Phases 1–2 gave us customers, instances, per-customer Fluent projects, per-project locking and per-ticket Git branches. Good. But the *delivery model* underneath is still SDK-only, and that is wrong for the product.

A Fluent project — even one whose `now.config.json` says `scope: "global"` — always produces a `sys_app` package. Records are Global-scoped but app-owned: they appear in Studio as an application, they promote through the App Repo, and they need Australia+ on the instance. Enterprise ServiceNow customers do not work that way. A human developer sets the application picker to **Global**, creates an **update set**, edits records directly, and promotes the update set dev → test → prod. That is the behaviour the product must mimic.

**New model:**

- **Native engine (primary).** The Developer agent emits a declarative change plan; the engine writes metadata records through the Table API with the deploy user's *current application* set to the correct scope and a per-ticket **update set** current. Promotion is `sn_cicd` retrieve → preview → commit.
- **Scope follows the work, never the tool.** Default = Global. Work belonging to a customer-owned scoped app is written *into that app*. A new custom app scope is created **only** on an explicit request.
- **Fluent/SDK becomes a narrow tier**, used for Flow Designer flows (Umar is validating this route) and for genuinely net-new self-contained applications. Everything Phase 1–2 built for projects stays and serves that tier.
- **Vendor scopes** (`sn_*`, CSM/HRSD/SecOps and anything the customer doesn't own) are refused, with a Build Agent / human recommendation in the ADR.

Reference: the research spec in the conversation ("Native Developer Engine — Technical Specification"). Key facts it established, which the implementation must honour:

- Record scope on a Table API write comes from the caller's **current application**, stored as the `sys_user_preference` row named `apps.current_app` (value = a `sys_scope` sys_id). Setting it via `PUT /api/now/ui/concoursepicker/application` with `{ "app_id": "<sys_scope sys_id>" }` is more reliable than writing the preference row directly, because a raw preference write may not take effect until a fresh session.
- Setting `sys_scope` in a POST body is **not** reliable. `sysparm_transaction_scope` is **not** a documented Table API parameter. Do not use either.
- An update set belongs to exactly one application scope. Writes made while a *different* scope is current land in that scope's **Default** update set — a silent, dangerous failure that the engine must detect.
- CI/CD update-set endpoints (`com.glide.continuousdelivery` plugin, role `sn_cicd.sys_ci_automation`) are **asynchronous**: every call returns `links.progress.url`; poll `GET /api/sn_cicd/progress/{id}` for status (0 pending, 1 running, 2 successful, 3 failed, 4 cancelled). HTTP 200 is not success.
- On Zurich+ an inbound OAuth client can be blocked from unscoped/cross-scope APIs by the Application Registry's **Scope Restriction** (Securely vs Broadly Scoped). Client-credentials also needs an active **OAuth Application User** mapped, or every call returns 401 despite a valid token.
- Flow Designer, UI Builder, workspaces and Now Assist skills are **not** reliably authorable through the Table API. Table/field creation via Table API is restricted — prefer Fluent or a human for schema.

---

## Phase 3 — ServiceNow REST client and scope/update-set session

Create `apps/web/src/lib/servicenow/` (extend the existing folder, which currently only holds `verify.ts`).

### 3.1 `client.ts` — one authenticated HTTP client per instance
- Constructed from an `Instance` row: base URL + a credential resolved from `credentialRef`.
- Supports both auth modes: basic (existing, dev only) and OAuth client-credentials (`POST /oauth_token.do`, `grant_type=client_credentials`, cache the token for its TTL, refetch on 401 once).
- Methods: `get/post/patch/delete(path, {query, body})`, returning parsed JSON plus status. Retries idempotent GETs twice on 5xx. Never logs secrets; redact `Authorization` and any `client_secret` in logged request/response dumps.
- Distinguishes and surfaces these errors as typed results, because the agent and the reviewer both need to see them plainly: `401 unauthenticated` (likely missing OAuth Application User), `403 forbidden` (ACL or Application Access), cross-scope refusal (message contains "cross-scope access policy"), and Zurich's `does not have unrestricted access to unscoped APIs` (Scope Restriction misconfigured).

### 3.2 `scope.ts` — current application control
- `resolveScope(client, scopeName)` → `{ sysId, name, scope }` from `GET /api/now/table/sys_scope?sysparm_query=scope=<name>`; `"global"` resolves the Global scope row.
- `setCurrentApplication(client, scopeSysId)` → `PUT /api/now/ui/concoursepicker/application` body `{ app_id }`. Then **verify**: read back `sys_user_preference?sysparm_query=user=<deployUserSysId>^name=apps.current_app` and confirm the value. If it doesn't match, throw — do not proceed to writes.
- `getDeployUserSysId(client)` → `GET /api/now/ui/user/current_user` (or `sys_user` by user_name) — cached per client.

### 3.3 `updateset.ts` — update-set lifecycle
- `createUpdateSet(client, {name, description, scopeSysId})` → `POST /api/now/table/sys_update_set`. Name format: `SDT-<ticketShortId> <ticket title truncated to 60>`.
- `setCurrentUpdateSet(client, updateSetSysId)` → write the current-update-set user preference, then verify by reading it back. **Open verification item:** the exact preference name must be confirmed on the PDI (see §7); implement it behind a single constant so it's a one-line fix.
- `capturedUpdates(client, updateSetSysId)` → `GET /api/now/table/sys_update_xml?sysparm_query=update_set=<id>` returning `{name, type, target_name, sys_id}[]`.
- `assertNoLeakage(client, {updateSetSysId, scopeSysId, expectedTargets})` → every expected artefact appears in the ticket's set, and nothing landed in that scope's Default set during the window. Fail the deploy loudly if not.
- `completeUpdateSet(client, id)` → `PATCH state=complete`.

### 3.4 Instance probe
Extend `Instance` handling with `probe.ts`: read `glide.war` / `glide.buildname` from `sys_properties`, parse the release family, persist `releaseName`/`releaseBuild`/`releaseDetectedAt`. Expose `supportsFluentGlobalApps(instance)` (Australia+) as a config-driven ordered family list, used only by the Fluent tier now.

**Verify:** an integration test script `scripts/probe-instance.mts <instanceId>` that prints release info, the resolved Global scope sys_id, the deploy user, and round-trips a scope switch to Global and back.

---

## Phase 4 — The change plan: authoring model for the Native engine

### 4.1 Plan schema (`apps/web/src/lib/nativeengine/plan.ts`)
A ticket's build output becomes a validated JSON document, not Fluent source:

```ts
type ChangePlan = {
  scope: string;                 // "global" | "x_acme_hr" — resolved, not guessed
  updateSetName: string;
  changes: Change[];
};
type Change = {
  id: string;                    // stable within the plan, referenced by other changes
  table: string;                 // sys_script, sc_cat_item, item_option_new, …
  op: "insert" | "update";       // never "delete"
  coalesce?: Record<string,string>; // how to find an existing record (e.g. {name: "..."} )
  sysId?: string;                // for updates to a known record
  fields: Record<string, string | number | boolean | { $ref: string } | { $lookup: {table, query, field} }>;
  script?: { file: string };     // for script fields, points at a file in the ticket dir
  reason: string;                // one line — why this record, for the reviewer
};
```

`$ref` resolves to another change's created sys_id (ordering is derived from the graph, and cycles are a validation error). `$lookup` resolves an OOB record at apply time by query (e.g. a group by name), so the agent never hard-codes a sys_id.

Zod-validate the plan on receipt. Reject: unknown tables (see allow-list), `op: "delete"`, any literal 32-hex sys_id in a field value that wasn't produced by `$lookup`/`$ref`, and any table outside the plan's scope's writable set.

### 4.2 Table allow-list (`tables.ts`)
Explicit, with a per-table note on required fields and gotchas. Start with what ITSM delivery actually needs:

`sc_cat_item`, `sc_cat_item_producer`, `item_option_new`, `io_set_item`, `item_option_new_set`, `catalog_ui_policy`, `catalog_ui_policy_action`, `catalog_script_client`, `sc_cat_item_user_criteria_mtom`, `sc_category`, `sys_script`, `sys_script_include`, `sys_script_client`, `sys_ui_action`, `sys_ui_policy`, `sys_ui_policy_action`, `sys_security_acl`, `sys_security_acl_role`, `sysevent_email_action`, `sysevent_register`, `sysauto_script`, `sys_dictionary` (fields on existing tables only, flagged high-risk), `sys_choice`, `sys_ui_form`/`sys_ui_section`/`sys_ui_element`, `contract_sla`, `sys_atf_test`, `sys_atf_step`, `sys_atf_test_suite`, `sp_widget`.

Explicitly **denied**: `sys_db_object`, `sys_hub_flow` and all `sys_hub_*`, `sys_ux_*`, `sys_aw_*`, anything whose `sys_scope` resolves to a vendor scope, and any table not on the list. Denials return a clear message naming the correct route (Fluent tier, Build Agent, or human).

### 4.3 Script handling
Script bodies live as real files in the ticket directory (`workspaces/<customer>/native/<ticket-slug>/*.js`) so they are diffable and Git-tracked, and are inlined into the plan at apply time. Before apply:
- type-check each script against `@servicenow/glide` types with `tsc --noEmit` in a scratch dir (the SDK's glide package is already a dependency);
- run the lint rules in §4.4.

### 4.4 Lint rules (`lint.ts`) — this replaces `now-sdk build` as the quality gate
Fail the build gate on: hard-coded 32-hex sys_ids; `gs.log` in scoped code (use `gs.info`); `current.update()` inside a before business rule; a `GlideRecord` query with no `addQuery`/`addEncodedQuery` before `query()`; `while (gr.next())` with a `.update()` and no limit; `eval`; DOM access in a server script; a business rule with no condition and `when=before` on a large table; missing `(function(){...})(current, previous);` wrapper on a business rule script; a script include not following `Class.create()`/`prototype` shape when it declares itself an API. Warn (don't fail) on: no error handling around an integration call, missing `sys_domain` awareness, long scripts (>150 lines) that should be a script include.

### 4.5 Dry-run diff (`diff.ts`)
For every change, fetch the current record (via `coalesce`/`sysId`) and produce a field-level old→new diff; for inserts, show the full proposed record. Render it as a `CHANGE_PLAN_DIFF` artifact. This is what the reviewer approves — not the raw JSON.

**Verify:** a fixture plan for "laptop request catalog item" validates, lints clean, and produces a readable diff against a PDI without writing anything.

---

## Phase 5 — Apply, verify, promote

### 5.1 `apply.ts` — the ordered sequence, exactly
Runs only after human Approve, only against an instance with `env="dev"`:

1. Resolve scope → `setCurrentApplication` → verify.
2. `createUpdateSet` in that scope → `setCurrentUpdateSet` → verify.
3. Topologically order changes; apply each via Table API; record the returned sys_id against the change `id`.
4. `capturedUpdates` + `assertNoLeakage`.
5. `completeUpdateSet`.
6. Write a `DEPLOY_LOG` artifact containing every request (method, path, redacted body), response status, and the resulting sys_id.

Any failure stops immediately and marks the ticket `FAILED` — no partial rollback attempt, because the update set *is* the rollback unit and a human should decide. Record what was applied so far.

### 5.2 Verification after apply
Re-query each created record and assert it exists, is active where expected, and its `sys_scope` matches the intended scope. Extend the existing `verify.ts` rather than replacing it.

### 5.3 `promote.ts` — dev → test → prod
- Requires `sys_update_set_source` on the target pointing at the source instance (document this in onboarding; detect its absence and fail with instructions).
- `POST /api/sn_cicd/update_set/retrieve` (`update_set_id`, `update_source_id`, `auto_preview=true`) → poll progress → capture `remote_update_set_id`.
- `POST /api/sn_cicd/update_set/preview/{id}` → poll → read `sys_update_preview_problem` for that remote set; **any unresolved problem blocks** and is shown to the reviewer as a `PREVIEW_PROBLEMS` artifact.
- `POST /api/sn_cicd/update_set/commit/{id}` → poll to successful.
- `back_out` wired to an admin-only "Roll back" action.
- Every call goes through a shared `pollProgress(client, progressUrl)` helper; treat status 3/4 as failure regardless of HTTP code.

### 5.4 Gates
`ReleaseGate` on the ticket: `DEV` → `TEST` → `PROD`. Test promotion requires a reviewer; prod requires an admin **and** a change-request reference stored on the ticket. `apply.ts` refuses any instance where `env !== "dev"`.

### 5.5 QA becomes real
- The QA agent authors ATF tests as part of the change plan (`sys_atf_test`, `sys_atf_step`, `sys_atf_test_suite`) — they ship in the same update set.
- After apply, run the suite: `POST /api/sn_cicd/testsuite/run` → poll → fetch results; failures fail the ticket with the report as an artifact. Note in onboarding docs that a headless client test runner must be scheduled or client-side steps are skipped.
- Run Instance Scan against the update set (`sn_instance_scan`, `triggerUpdateSetScan`) and attach findings.

---

## Phase 6 — Routing: where does this work belong?

`apps/web/src/lib/pipeline/route.ts` (this replaces the `tier.ts` described in the old brief). Deterministic code, not an LLM judgement. The Architect consumes its output and may only argue for something *more* conservative.

### 6.1 Probe inputs
For each artefact the requirement implies, query the instance: does a record with that name/purpose already exist; which `sys_scope` owns the table and the record; is that scope Global, a customer-owned app, or a vendor app; is there an existing catalog/category/group/flow to reuse.

### 6.2 Decision table

| Situation | Route | Where it lands |
|---|---|---|
| Anything in the default Global scope (catalog items, BRs, script includes, UI actions/policies, ACLs, notifications, SLAs, fields on OOB tables) | `NATIVE_GLOBAL` | Global, ticket update set |
| Work that belongs to an existing **customer-owned** scoped app | `NATIVE_SCOPED` | that app's scope, update set in that scope |
| Requirement needs a **Flow Designer flow** | see §6.3 | — |
| Requirement explicitly asks for a **new custom application** | `FLUENT_SCOPED_APP` | new `x_` app via the Phase 1–2 project machinery |
| Anything inside a **vendor scope** | `NOT_SUPPORTED` | refused; ADR recommends Build Agent / human |

`NATIVE_GLOBAL` is the default. Creating a new app scope requires an explicit request in the requirements — the router must never choose it to make its own life easier, and the Architect must not propose one without quoting the requirement line that asked for it.

### 6.3 Flow sub-routing (ordered)
1. **Reuse** — an existing flow/subflow already does the job; only the item→flow link and its configuration are written (Native). Prefer this.
2. **Reuse + server-side extension** — existing flow plus a business rule / script include for the extra behaviour (Native). Note in the ADR why the flow itself isn't being modified.
3. **`FLUENT_FLOW`** — author the flow in a Fluent global app via the Phase 1–2 project machinery, deployed separately from the update set. **This is the route Umar is validating**; ship it behind a per-customer feature flag (`allowFluentFlows`), default on for the demo customer.
4. **Human/Build Agent** — the ticket pauses at an `AWAITING_FLOW` gate showing the Architect's flow spec and the update set name; someone builds it with that update set current; the pipeline resumes and verifies (`sys_hub_flow` exists, active, correct scope, captured in the set).

**Modifying an existing shared flow** is never automatic. If the design requires it, the ADR must flag the blast radius (every item using that flow) and it goes to route 4.

### 6.4 Ordering when a ticket spans routes
A ticket may produce both a Fluent flow app and a Native update set. Deploy order: Fluent app first (so the flow exists), then the update set (whose item references it). The release gate treats them as one unit — both must succeed or the ticket fails.

---

## Phase 7 — Auth, agents, prompts, UI

### 7.1 Credentials
- Per-instance `credentialRef` resolved from an env-backed secret provider (`SNOW_CRED_<REF>_*`), with the interface shaped so Vault/Key Vault drop in later.
- Default `authMode = "oauth_cc"`. Two ServiceNow accounts per instance: a **read-only** user for agent probes, and a **deploy** user for writes/promotion. Document in `docs/customer-onboarding.md`: create the Application Registry entry with client-credentials grant, set the **OAuth Application User**, enable `glide.oauth.inbound.client.credential.grant_type.enabled`, choose the right **Scope Restriction** for Zurich+, install `com.glide.continuousdelivery`, grant `sn_cicd.sys_ci_automation`, and configure `sys_update_set_source` on test/prod.
- Fluent-tier SDK calls keep using `SN_SDK_NODE_ENV=SN_SDK_CI_INSTALL` with OAuth env vars.

### 7.2 Agent tool permissions
| Agent | Tools |
|---|---|
| Intake / BA | `query` (read-only creds) |
| Architect | `query`, `explain`, route findings, WebSearch |
| Senior Dev | `query`, `explain` |
| Developer | `query`, `explain`, `validate_plan` (schema + lint + typecheck + dry-run diff — **no writes**) |
| QA | `query`, `explain`, ATF authoring into the plan |
| Release | apply / promote / rollback — **not an agent tool**; invoked by code after a human action |

### 7.3 Prompts
- New `developer-native.md`: emits the change plan + script files, ITSM-idiomatic, must call `validate_plan` until clean. Carries the lint rules and the "never invent a sys_id" rule.
- `developer.md` (Fluent) is retained for the flow/app tiers.
- `grounding.md`: strip all remaining PDI-specific identifiers and the old target-scope section; inject a runtime `{{PROJECT_CONTEXT}}` block (customer, instance, release, route, scope, update set name) from `route.ts` as the single source.
- `architect.md`: add a mandatory `## Scope & routing` section that restates the route and rationale, quotes the requirement line if a new app scope is proposed, lists reused OOB records with sys_ids, and states explicitly that nothing is deleted.
- `intake-assistant.md`: never ask about scope; ask which customer/instance only when more than one exists.

### 7.4 UI
- Settings → Customers / Instances / Projects CRUD (admin). Instance card shows release family, auth mode, and probe status.
- Ticket detail: route badge + rationale; the change-plan diff as the primary review surface; update-set name and link; preview problems; release-gate stepper; `AWAITING_FLOW` gate when applicable.
- README rewritten around the Native engine, with the Fluent tier described as the flow/app route.

---

## Acceptance criteria

1. A "laptop request" ticket on a Global route produces a catalog item, variables, a script include, notifications and an ATF test — all with `sys_scope` = Global, all captured in one `SDT-…` update set, and nothing in any Default update set.
2. `grep -rn "1460392\|a53b8a58\|AI Delivery" apps/ servicenow/ docs/` returns nothing outside migrations and seed data.
3. A ticket naming an existing customer-owned scoped app writes into that app's scope with an update set in that scope — and creates no new application.
4. A ticket that would require a vendor-scope change is refused with a route of `NOT_SUPPORTED` and a Build Agent recommendation in the ADR.
5. No new application scope is ever created unless the requirement text explicitly asks for one; the router has a test proving this.
6. The Developer agent cannot write to an instance: `validate_plan` is read-only, and apply/promote are unreachable from agent tools.
7. Promotion to test runs retrieve → preview → commit with progress polling, and blocks on any `sys_update_preview_problem`.
8. `apply.ts` refuses an instance whose `env !== "dev"`.
9. Secrets never appear in logs or artifacts; a test asserts redaction.
10. The Phase 1–2 Fluent path still works for the flow tier: a `FLUENT_FLOW` ticket builds, installs, and the flow is verified active on the instance.

## Open items to smoke-test on the PDI before relying on them

Build these as `scripts/smoke-*.mts` and run them early in Phase 3 — several design decisions depend on the answers:

1. Does `PUT /api/now/ui/concoursepicker/application` reliably re-scope Table API writes for a **client-credentials OAuth user** with no interactive session? (If not, fall back to a scripted REST resource on the instance that sets scope + update set and performs the write server-side.)
2. The exact `sys_user_preference` name for the current update set, and whether a plain preference write is honoured or `GlideUpdateSet.setCurrent` is required.
3. Whether `sn_cicd/update_set/create` also sets the created set as current.
4. Zurich/Australia **Scope Restriction** behaviour for the engine's OAuth client against Global and scoped writes.
5. 403/prefix behaviour for `sys_dictionary` field creation via Table API.
6. Whether ATF client-side steps run headless with a scheduled client test runner.
7. Confirm `sysparm_transaction_scope` has no effect (expected: none) so it's never reached for.

## Do not

- Do not create a new application scope to make a write succeed. If the correct scope refuses the write, that's a routing or permissions problem to surface, not to work around.
- Do not set `sys_scope` in a POST body or use `sysparm_transaction_scope`.
- Do not emit `op: "delete"` in a change plan, or remove records by any route.
- Do not treat HTTP 200 from a `sn_cicd` endpoint as success — always poll progress.
- Do not let any LLM agent hold apply/promote/rollback tools.
- Do not deploy to a non-dev instance from `apply.ts`.
- Do not remove the Phase 1–2 project machinery; the flow tier depends on it.
