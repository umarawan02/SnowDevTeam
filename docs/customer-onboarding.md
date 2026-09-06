# Customer / instance onboarding

The default per instance is **`authMode = "oauth_cc"`** with **two** ServiceNow
service users — `svc_snowdevteam_ro` (agent probes, `snc_read_only`) and
`svc_snowdevteam_deploy` (writes + promotion) — each with its own
client-credentials OAuth client. `setup-service-users` provisions both;
`setup-oauth` (single user) is the older quick path.

## 1. Register the customer and instance

```
pnpm --filter web seed-demo-customer          # the demo PDI, or
# /settings/infrastructure                    # New customer / New instance (admin)
```

An `Instance` row needs: `url`, `env` (`dev` | `test` | `prod`), and a
`credentialRef`. `authMode` starts `basic` and flips to `oauth_cc` after step 2.

## 2. OAuth client-credentials (per instance)

```
pnpm --filter web setup-oauth <instanceId>
```

This uses the admin basic-auth creds (`SN_USERNAME` / `SN_PASSWORD`) to:

- set `glide.oauth.inbound.client.credential.grant_type.enabled = true`;
- create an `oauth_entity` named **"SnowDevTeam Native Engine"** with
  `client_type = integration_as_a_user`, `inbound_grant_type = client_credential`,
  the **OAuth Application User** (`user` field) = `admin` for now, and an
  explicit `client_secret` (the Table API returns the stored secret encrypted,
  so we set one we can keep);
- create a default `oauth_entity_profile` with `grant_type = client_credentials`;
- verify a token round-trip, then set the `Instance` row to `authMode = oauth_cc`,
  `credentialRef = <instance name>`.

It prints the two env vars to add to the repo-root `.env`:

```
SNOW_CRED_<REF>_CLIENT_ID=…
SNOW_CRED_<REF>_CLIENT_SECRET=…
```

`<REF>` is the `Instance.name`, uppercased with non-alphanumerics → `_`
(e.g. `dev424712` → `SNOW_CRED_DEV424712_*`).

Re-running `setup-oauth` rotates the secret and reprints it.

## 3. Probe the instance

```
pnpm --filter web probe-instance <instanceId>
```

Persists `releaseName` / `releaseBuild` / `releaseDetectedAt`, prints the
resolved Global `sys_scope` sys_id and deploy user, and round-trips a scope
switch. The Fluent-tier check `supportsFluentGlobalApps` needs the release to
be **Australia or later**.

## 4. Smoke tests (run once per instance)

```
pnpm --filter web smoke <instanceId>          # writes docs/servicenow-smoke-findings.md
pnpm --filter web smoke-cleanup <instanceId>  # sweep, if a smoke crashed mid-run
```

The findings gate the Phase 4–6 design — see
`docs/servicenow-smoke-findings.md`.

## 5. Native engine resource (once per instance)

```
pnpm --filter web setup-native-engine <instanceId>
```

Installs the **SnowDevTeam Native Engine** Scripted REST resource (a Global
`sys_script_include` + `sys_ws_definition` + two `sys_ws_operation` rows), and
sets `sn_atf.schedule.enabled = true` (without it `sn_cicd/testsuite/run`
rejects every run). It is required before `apply.ts` can write: a headless REST
session can't make an update set current (smoke open items #1/#2), so the writes
run server-side through this resource with `new GlideUpdateSet().set()` first.
Idempotent — re-run to push script changes. Source of truth:
`apps/web/src/lib/nativeengine/serverscript/apply-resource.js`.

The base path is `/api/<glide.appcreator.company.code>/sdt_native` (Global
Scripted REST APIs are namespaced by the company-code property, not `global`).

Phase 5 supports the **Global route only**. A scoped-app target would need a
resource running in that scope — that's Phase 6.

## 6. Promotion (test / prod instances)

Update-set promotion (`promote-ticket <id> TEST|PROD`) needs a
`sys_update_set_source` on the **target** instance pointing at the source:

1. On the target: **Retrieved Update Sets → Update Sources → New**.
2. URL = the source instance URL; set credentials; **Test Connection**; Active.

`promote.ts` detects its absence and blocks with instructions. Prod promotion
also needs `changeRequestRef` set on the ticket.

## Prerequisites the smokes surface (not configured by the scripts)

- **`com.glide.continuousdelivery`** — present on Australia PDIs. Needed for
  `sn_cicd/update_set/*` (create, retrieve, preview, commit) and
  `sn_cicd/testsuite/run`. Grant the OAuth user `sn_cicd.sys_ci_automation`.
- **`sys_update_set_source`** on `test` / `prod` instances, pointing at the
  source instance — required for update-set promotion (Phase 5 §5.3).
- **ATF execution** — `sn_cicd/testsuite/run` needs `sn_atf.schedule.enabled =
  true`. `setup-native-engine` tries to set it; on some instances a business
  rule ("Check if scheduled suites allowed") blocks the Table API write and it
  must be toggled in **ATF → Administration → Properties**. Until then the
  pipeline's ATF step is **advisory** — it writes an `ATF_RESULTS` artifact
  noting the gap and does not fail the ticket.
- A **scheduled client test runner** (or container runner) if ATF tests use
  UI-interaction steps; server-side ATF runs without one.
