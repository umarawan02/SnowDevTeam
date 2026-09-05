# SnowDevTeam — Refactor Brief: from single-PDI MVP to a multi-customer, scope-aware delivery platform

> Give this whole file to Claude Code at the repo root. Work through the phases **in order**; each phase must build (`pnpm -r build`), lint, and leave `pnpm --filter web pipeline` runnable before moving on. Ask before any destructive change to `servicenow/delivery-app` or `keys.ts`.

## 0. Why this refactor exists (read first)

The MVP works, but its ServiceNow integration model has four structural problems that block selling it to enterprises:

1. **The Fluent workspace is a per-ticket scratchpad, not an application.** `cleanWorkspace()` in `apps/web/src/lib/nowsdk/workspace.ts` deletes every previously generated `.now.ts` before each build/deploy, and `deploy.ts` only keeps `keys.ts` on a successful deploy. So after ticket #2 deploys, the source for ticket #1's records is gone. Git is not the source of truth; the instance is. Per the SDK's own rule (`now-sdk explain sdlc-guide`, `keys-file`), removing a constructor call while its `keys.ts` entry survives can emit a **delete** on a later install. This is the most dangerous defect in the repo.
2. **Scope is a hard-coded pair of PDI-specific apps.** `x_1460392_delivery` / `f53ca6b1…` and "AI Delivery Global" / `a53b8a58…` are baked into `workspace.ts`, `constants.ts`, `grounding.md`, `architect.md`, `README.md`. `now.config.json` is hot-swapped at build time. A customer will never accept their incident/catalog customizations living in an app called "AI Delivery Global" owned by the vendor.
3. **Only two execution tiers exist (net-new global, net-new scoped).** Missing: (a) taking ownership of *existing* OOB global metadata via `now-sdk move` → `transform`, (b) a governed fallback for instances below the **Australia** release (global apps in the SDK need Australia+), and (c) a route for customizing non-global scoped products (CSM/HRSD/SecOps), which Fluent cannot do at all.
4. **Auth and promotion are dev-only.** Basic auth with an admin user for everything; agents and the deployer share credentials; `now-sdk install` goes straight to the instance with no Git commit, no PR, no App Repo publish path.

The target model (matches ServiceNow's SDLC guide): **SnowDevTeam is an orchestrator, not an app.** It creates and operates *customer-owned* Fluent projects (one global app + N scoped apps per customer/instance), keeps each in Git, chooses the execution tier per ticket, and promotes via App Repo/ReleaseOps. It never appears in the customer's `sys_app`.

Reference docs are all local — use them, don't guess:
- `npx @servicenow/sdk explain sdlc-guide --format=raw` (global apps, `move`, transform loop, App Repo, "no update sets between instances")
- `npx @servicenow/sdk explain ci-integration --format=raw` (`--frozenKeys`, `SN_SDK_*` env-var auth, "do not `install` to prod from CI")
- `npx @servicenow/sdk explain keys-file --format=raw`, `now-config-reference`, `cross-scope-privilege-guide`, `atf-guide`, `testsuite-api`
- `npx @servicenow/sdk init --help`, `move --help`, `transform --help`, `cicd --help`

---

## Phase 1 — Data model: Customers, Instances, Projects (replaces the hard-coded scope pair)

### 1.1 Prisma schema (`apps/web/prisma/schema.prisma`)
Add, with a migration:

```
Customer      { id, name, slug, createdAt }
Instance      { id, customerId, name, url, env ("dev"|"test"|"prod"),
                releaseName?, releaseBuild?, releaseDetectedAt?,
                authMode ("oauth_cc"|"basic"), credentialRef,   // reference into secret store, never the secret
                readOnlyCredentialRef?,                         // separate creds for agent query access
                isDeployTarget Boolean }
FluentProject { id, customerId, name, scope, scopeId, kind ("global"|"scoped"),
                repoPath, gitRemote?, defaultBranch, createdVia ("init"|"init_from"|"import"),
                packageResolverVersion?, createdAt }
Ticket        { + customerId, instanceId, projectId?, executionTier, tierRationale, gitBranch?, prUrl?, releaseGate }
```

- `executionTier` enum: `FLUENT_GLOBAL_APP`, `FLUENT_SCOPED_APP`, `FLUENT_MOVE_CUSTOMIZE`, `REST_UPDATE_SET_FALLBACK`, `NOT_SUPPORTED`.
- Delete `targetScope` and `TARGET_SCOPES`/`DEFAULT_TARGET_SCOPE` from `constants.ts` once all readers are migrated. `TargetScope` becomes `FluentProject.kind`.
- Seed: one demo Customer with the existing PDI as a dev Instance; import the two existing PDI apps as `FluentProject` rows (`kind=scoped` for `x_1460392_delivery`, `kind=global` for the global one) so nothing regresses.

### 1.2 Project registry on disk
- New root dir `workspaces/<customer-slug>/<project-name>/` — each is a full Fluent project (its own `package.json`, `now.config.json`, `src/fluent`, `src/fluent/generated/keys.ts`, `.git`). `NOW_SDK_WORKSPACE` env var goes away; `apps/web/src/lib/config.ts` gets `WORKSPACES_ROOT` (default `./workspaces`).
- `servicenow/delivery-app` becomes the **template** for scaffolding, or is removed once `now-sdk init` is used for scaffolding (prefer `init`; keep the tsconfig files as template assets if `init --template=base` doesn't emit them).
- Add `workspaces/` to `.gitignore` of this repo — customer projects are separate Git repos, never committed here.

### 1.3 Project lifecycle service (`apps/web/src/lib/projects/`)
- `createProject({customerId, instanceId, kind, name, scopeName})` → runs `now-sdk init --appName --packageName --scopeName=<global|x_…> --template=base` in the new dir, `npm install`, writes `packageResolverVersion: "2.0.0"` when `kind=global`, `git init` + initial commit, registers the row. Naming default for the global app: `"<Customer Name> Platform Customizations"`. Never name anything "AI Delivery".
- `importProject({instanceId, appSysId})` → `now-sdk init --from <sys_id>` for customers who already have an app; register it.
- `ensureDependencies(project)` → `now-sdk dependencies`.
- Per-project lock: replace the single `withWorkspaceLock` chain with a `Map<projectId, chain>`; concurrent tickets on different projects must not serialize.

### 1.4 Remove the config-swap hack
Delete `snapshotConfig/restoreConfig/writeProjectConfig`, `SCOPED_FALLBACK`, `GLOBAL_CONFIG`, `configFor` from `workspace.ts`. `now.config.json` is never rewritten at runtime. `runNowSdk` takes a `cwd` (the project's `repoPath`) instead of the global `NOW_SDK_CWD`.

---

## Phase 2 — Make the Fluent project accumulate (fix the scratchpad)

### 2.1 Stop wiping sources
- Remove `cleanWorkspace()` from the build gate and from deploy. Generated files for a ticket are written to `src/fluent/<ticket-slug>/…` and `src/server/<ticket-slug>/…` inside the project; earlier tickets' files stay.
- `buildWorkspace()` compiles the **whole project** (all tickets), so a new ticket that conflicts with an old one fails the gate — that's correct behaviour.
- The Developer's `build` tool must be told (in its description and in `developer.md`) that it is compiling into an existing app and may only create/modify files under its ticket directory; any edit to another ticket's file is a QA blocker unless the Architect's ADR explicitly calls it out (with the deletion-safety rule).

### 2.2 Git per ticket
New `apps/web/src/lib/git/` (use `simple-git` or `execFile("git")`):
- On ticket start: `git checkout -b ticket/<id>-<slug>` from `defaultBranch` in the project repo.
- After a passing build gate: commit generated files **and** the regenerated `keys.ts`.
- Reviewer **Approve** = merge to `defaultBranch` (fast-forward or squash) **then** deploy. Reject/rework = branch stays; on reject after N days, delete branch.
- If `gitRemote` is set, push the branch and (if a `GITHUB_TOKEN`/`GITLAB_TOKEN` is configured) open a PR; store `prUrl` on the ticket. Approve in-app is still the gate; PR is the audit artifact.
- CI check equivalent inside the app: before deploy, run `now-sdk build --frozenKeys` on the merged branch; if it fails, the deploy is blocked with the diff shown to the reviewer.

### 2.3 `keys.ts` handling
- Remove `snapshotKeys/restoreKeys` restore-on-failure logic; `keys.ts` is committed on the ticket branch after the build gate and is always the current truth of the branch. Failed builds don't get committed, so a rollback is just `git checkout`.
- Keep `keysAdded()` for the verification query — compute it as `git diff defaultBranch..HEAD -- src/fluent/generated/keys.ts`.

---

## Phase 3 — Execution tiers and the Architect's scope decision

### 3.1 Instance release detection (`apps/web/src/lib/servicenow/release.ts`)
- On instance registration and before every ticket: query `sys_properties` for `glide.war` (and `glide.buildname`/`glide.buildtag`) via the read-only credential; persist `releaseName`/`releaseBuild`. Parse the family name (Yokohama, Zurich, Australia, …).
- `supportsGlobalFluentApps(instance)` = release ≥ Australia. Make the ordered family list a config constant so new releases are a one-line change.

### 3.2 Tier selection — deterministic, not the LLM's call
`apps/web/src/lib/pipeline/tier.ts` — `selectTier({instance, requirement, existingProjects})` returns `{tier, project?, rationale, blockers[]}` using this matrix. The Architect **must** consume this output and may only argue for a *more* conservative tier.

| Situation | Tier | Notes |
|---|---|---|
| Net-new, self-contained functionality (own tables, own catalog, own UI) | `FLUENT_SCOPED_APP` | reuse the customer's scoped app if one fits, else create one (`x_<vendorprefix>_<name>`). Cross-scope access to `task`/`sc_*` etc. via `CrossScopePrivilege` in Fluent. |
| Net-new records on/against global OOB tables (catalog item in an existing catalog, BR/UI policy on `incident`, `sc_req_item`, …) **and** release ≥ Australia | `FLUENT_GLOBAL_APP` | in the customer's global app |
| **Editing existing** OOB/global records (change a delivered BR, catalog item, notification) **and** release ≥ Australia | `FLUENT_MOVE_CUSTOMIZE` | `now-sdk move --ids <sys_ids>` into the global app, `transform` to Fluent, then edit. Record the moved sys_ids on the ticket. |
| Any global work **and** release < Australia | `REST_UPDATE_SET_FALLBACK` | see 3.4. Ticket UI shows a "degraded mode — upgrade to Australia+ to use Fluent" badge. |
| Customizing metadata inside a non-global scoped product (CSM, HRSD, SecOps, ITOM, any `sn_*`/`x_*` app the customer doesn't own) | `REST_UPDATE_SET_FALLBACK` or `NOT_SUPPORTED` | Fluent cannot represent this (SDLC guide: "non-global customization"). Prefer routing the customer to Build Agent in Studio; if the fallback is enabled for this customer, use it with mandatory human gate. |

Detection inputs: the BA's requirements + a `query`-based probe (does the referenced record exist? which `sys_scope` owns it? is that scope `global`, customer-owned, or vendor-owned?). Put the probe in `tier.ts`, expose the raw findings to the Architect.

### 3.3 `FLUENT_MOVE_CUSTOMIZE` flow
- New MCP tools (Architect/Senior Dev only, **not** Developer): `move(ids[])` (writes to the instance: takes ownership — requires the ticket to be in a state where a human has approved the ADR; add a lightweight "Design approved" gate before Senior Dev if it doesn't exist) and `transform(from: xmlPathOrSysId)`. Both run in the project cwd and commit the transformed Fluent on the ticket branch.
- Grounding must state: after `move`, the record belongs to the customer's global app; edits are made to the transformed `.now.ts`; never re-create a moved record as net-new.

### 3.4 `REST_UPDATE_SET_FALLBACK` engine (`apps/web/src/lib/servicenow/rest-fallback/`)
Minimal, safe, and obviously second-class:
- Creates an update set via Table API (`sys_update_set`), sets it current for the deploy user (`sys_user_preference` or `/api/now/table/sys_update_set` + `ui_current_update_set`), performs the Table API writes the Developer emitted as a **declarative JSON change plan** (not free-form code): `[{table, op: insert|update, key: {sys_id | coalesce}, fields: {...}}]`.
- Before applying: dry-run diff (fetch current values, show old→new per field) as an artifact; reviewer must approve the diff, not just the ticket.
- After applying: mark update set `complete`, export XML via `/sys_update_set.do?XML&sys_id=…` (or `sys_remote_update_set` export API) and attach it to the ticket as the deployable artifact.
- Hard limits: allow-list of tables (`sys_script`, `sys_script_include`, `sys_ui_policy*`, `sys_script_client`, `sc_cat_item*`, `item_option_new`, `sysevent_email_action`, `sys_ui_action`, `sys_security_acl*`); refuse `sys_db_object`/`sys_dictionary` changes in this tier; never `delete`.
- The Developer prompt for this tier is a separate file `developer-rest.md`; it emits the JSON plan + classic server-side JS strings, no Fluent.

---

## Phase 4 — Auth, permissions, promotion

### 4.1 Credentials
- Replace `SN_USERNAME/SN_PASSWORD/SN_AUTH_ALIAS` with per-instance `credentialRef`s resolved from a secret store (env-var-backed provider is fine for now: `SNOW_CRED_<ref>_CLIENT_ID/_CLIENT_SECRET`; design the interface so Vault/Azure Key Vault plug in).
- Default `authMode = oauth_cc`. Run every `now-sdk install`/`move`/`transform`/`cicd` with `SN_SDK_NODE_ENV=SN_SDK_CI_INSTALL`, `SN_SDK_AUTH_TYPE=oauth`, `SN_SDK_INSTANCE_URL`, `SN_SDK_OAUTH_CLIENT_ID/SECRET` in the child env (from `ci-integration`). Drop the keychain alias entirely — it doesn't work headless and can't be multi-tenant.
- Two ServiceNow accounts per instance, documented in `docs/customer-onboarding.md`: a **read-only** integration user (agents' `query`, release probe) and a **deploy** user with `admin`/`app_repo` rights used only by the Release step.

### 4.2 Role separation in the pipeline
| Agent | Tools |
|---|---|
| Intake / BA | none (plus `query` read-only for existence checks) |
| Architect | `explain`, `query`, tier findings, WebSearch (unchanged) |
| Senior Dev | `explain`, `query`, `move`, `transform` (after design gate) |
| Developer | `explain`, `query`, `build` — read-only instance access |
| QA | `explain`, `query`, `atf_run` (see 4.4) |
| Release | `install` (dev only), `cicd publish`, `cicd install`, `cicd rollback` — never callable by an LLM agent; invoked by code after human Approve |

### 4.3 Promotion path
- Instances have `env`. `now-sdk install` is allowed **only** to `env=dev`. For `test`/`prod`: bump `version` in `now.config.json` on the ticket branch, `now-sdk cicd publish` to the App Repo from the dev instance, then `now-sdk cicd install` on the target instance. Store the App Repo version on the ticket. `cicd rollback` wired to a "Roll back" button (admin only).
- Add a `ReleaseGate` step to the pipeline UI: Dev deploy → verification → "Promote to Test" (reviewer) → "Promote to Prod" (admin, requires a change-request reference field that is stored on the ticket).
- Never generate or import update sets between instances in the Fluent tiers.

### 4.4 Real QA
- QA agent authors ATF tests in Fluent (`explain atf-guide`, `test-api`, `testsuite-api`) into `src/fluent/<ticket>/tests.now.ts`, so tests ship with the app.
- After dev deploy, run the ticket's suite via `now-sdk cicd testsuite run …` (check `cicd testsuite --help` for exact flags) and parse results; failures flip the ticket to `FAILED` with the report as an artifact. Keep the existing post-deploy `verifyDeployment` query as a smoke check.

---

## Phase 5 — Prompts and grounding become project-aware

- `grounding.md`: remove every literal `x_1460392_delivery`, "AI Delivery", `u_<name>` default, and the "Target scope" section. Replace with a `{{PROJECT_CONTEXT}}` block injected at runtime by `persona-prompt.ts`: project name, `kind`, scope prefix (or "none — global app"), release family, tier, and a one-paragraph description of the tier's rules (from `tier.ts`, single source). Keep all the Fluent hard-rules — they're good.
- `architect.md`: add a mandatory `## Scope & Tier decision` ADR section that restates the selected tier and rationale, lists moved sys_ids for `FLUENT_MOVE_CUSTOMIZE`, and explicitly states "no existing metadata is deleted" or lists what is (human confirmation required). Add "check for an OOB feature that already solves this" as step 0 with a required `query`/`explain` evidence line.
- `developer.md` / `senior-developer.md`: "you are adding to an existing application; only touch `src/fluent/<ticket>/`", the deletion-safety rule, and `CrossScopePrivilege` guidance for scoped tier.
- New `developer-rest.md` for the fallback tier.
- `intake-assistant.md`: stop asking the user for scope. Ask for customer/instance if more than one exists; scope is decided by the pipeline.
- `.claude/skills/itsm-service-manager/SKILL.md`: keep, but strip PDI-specific sys_ids if any.

---

## Phase 6 — UI and docs

- Settings → Customers / Instances / Projects CRUD (admin). Instance card shows release family and "Fluent global apps: supported / not supported".
- Ticket detail: tier badge with rationale; Git branch/PR link; release-gate stepper (Dev → Test → Prod); for fallback tier, the field-level diff approval.
- README: rewrite the "Target scope" section to describe tiers; document customer onboarding (create OAuth app registry entries, the two users, Australia+ recommendation).

---

## Acceptance criteria (verify before declaring done)

1. Two tickets deployed back-to-back into the same global project leave **both** tickets' `.now.ts` files and both sets of `keys.ts` entries in the repo; `now-sdk build --frozenKeys` passes on `main`.
2. `grep -r "1460392\|a53b8a58\|AI Delivery" apps/ servicenow/ docs/` returns nothing outside migrations/seed.
3. A ticket against a Zurich instance for a global catalog item is routed to `REST_UPDATE_SET_FALLBACK` with a visible "degraded mode" reason; the same ticket against an Australia instance goes to `FLUENT_GLOBAL_APP`.
4. A ticket that asks to "change the existing Incident assignment business rule" on Australia yields `FLUENT_MOVE_CUSTOMIZE`, a `move` of that sys_id, a transformed `.now.ts`, and no duplicate BR on the instance.
5. A ticket asking to modify a CSM (`sn_customerservice`) scoped record yields `NOT_SUPPORTED`/fallback with the Build Agent recommendation in the ADR.
6. No LLM agent can call `install`, `cicd publish/install/rollback`; those only run from `deploy.ts` after a human action, and `install` refuses non-dev instances.
7. `now-sdk` child processes run with `SN_SDK_NODE_ENV=SN_SDK_CI_INSTALL` and OAuth env vars; no basic-auth password appears in env or logs.
8. Existing end-to-end flow (`docs/phase4-validation.md`) still passes against the PDI via the seeded demo customer.

## Do not

- Do not delete or rewrite `servicenow/delivery-app/src/fluent/generated/keys.ts` without asking — those sys_ids map to live records on the PDI.
- Do not let the LLM choose the tier freely; `tier.ts` decides, the Architect explains.
- Do not reintroduce `now.config.json` hot-swapping or shared workspaces.
- Do not add update-set-based deployment for Fluent tiers.
