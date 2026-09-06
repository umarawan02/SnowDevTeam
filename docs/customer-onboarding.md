# Customer / instance onboarding

> Partial — covers what NATIVE_ENGINE_BRIEF Phase 3 needs. Phase 7 adds the
> read-only/deploy user split, `sys_update_set_source` for promotion, and the
> full runbook.

## 1. Register the customer and instance

```
pnpm --filter web seed-demo-customer          # the demo PDI, or:
# (admin UI CRUD — Phase 7)
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

## Prerequisites the smokes surface (not configured by the scripts)

- **`com.glide.continuousdelivery`** — present on Australia PDIs. Needed for
  `sn_cicd/update_set/*` (create, retrieve, preview, commit) and
  `sn_cicd/testsuite/run`. Grant the OAuth user `sn_cicd.sys_ci_automation`.
- **`sys_update_set_source`** on `test` / `prod` instances, pointing at the
  source instance — required for update-set promotion (Phase 5 §5.3).
- A **scheduled client test runner** (or container runner) if ATF tests use
  UI-interaction steps; server-side ATF runs without one.
