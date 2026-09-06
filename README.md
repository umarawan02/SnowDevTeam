# SnowDevTeam — AI ServiceNow Delivery Team

A pipeline of specialized AI agents (Business Analyst → Architect → Senior
Developer → Developer → QA) turns a customer feature request into deployed
ServiceNow artifacts. A human reviews every stage and must click **Approve**
before anything reaches a real instance.

## How work is delivered

A deterministic **router** (`apps/web/src/lib/pipeline/route.ts`) decides where
each request's work belongs — at ticket creation, never by an LLM:

| Route | Where the work lands |
|---|---|
| **`NATIVE_GLOBAL`** (the default) | The engine writes metadata via the **Table API** into the Global scope with a **per-ticket update set** — exactly what a human developer does (app picker → update set → edit records → promote). |
| `NATIVE_SCOPED` | The same, into a customer-owned application scope. |
| `FLUENT_FLOW` | A net-new Flow Designer flow — authored as ServiceNow **Fluent** (`.now.ts`) in a per-customer project, `now-sdk build` + `install`. |
| `FLUENT_SCOPED_APP` | A brand-new application the requirement explicitly asked for. |
| `NOT_SUPPORTED` | A vendor scope (`sn_*`, CSM/HRSD/…) — refused, with a Build-Agent recommendation in the ADR. |

A new application scope is **only** chosen when the requirement text explicitly
asks for one. See `docs/native-pipeline.md` and `NATIVE_ENGINE_BRIEF.md`.

### The native path

The Developer emits a **validated JSON change plan** (not code), gated by a
read-only `validate_plan` tool instead of a compiler. The human approves the
rendered **change-plan diff** — field-level old→new against the dev instance,
zero writes. **Approve** then applies it: one update set, verified per record,
then promoted dev → test → prod via `sn_cicd` (retrieve → preview → commit, with
progress polling; any unresolved preview problem blocks). Nothing an LLM agent
can reach ever writes to an instance.

### The Fluent path

The **Architect** leads with out-of-the-box ServiceNow — inventories the instance
and researches best practice before designing anything custom. The **Developer**'s
code is run through `now-sdk build` **before QA sees it**; a compile failure
re-runs the Developer against the errors (≤2×). When **QA** returns
`NEEDS_REWORK`, the pipeline **loops back automatically** (≤2 rounds); a reviewer
can also **Send back for rework** from the gate.

Status: **complete** — `BUILD_PROMTP.md` (the 4-phase MVP), then
`refactor_brief.md` phases 1–2 (multi-customer data model + per-ticket git), then
`NATIVE_ENGINE_BRIEF.md` (the native engine, phases 3–7). `docs/phase4-validation.md`
and `docs/servicenow-smoke-findings.md` are the validation write-ups.

### The app (`apps/web`)

| Screen | What |
|---|---|
| `/` Dashboard | KPIs, throughput, per-agent stage timing, pipeline funnel, review queue, activity feed, spend. |
| `/intake`, `/intake/[id]` | Chat intake — talk to an assistant that gathers the requirements, then **Start development** creates the ticket and kicks off the pipeline. |
| `/board` | Live status kanban — cards move across columns as the pipeline runs. |
| `/agents`, `/agents/[role]` | The 5 AI personas (`AgentPersona` table). Rename them and rewrite their profile + "voice" — the name and voice are threaded into that agent's system prompt on every run. |
| `/tickets/[id]` | Run detail: the pipeline as a live node graph, the route badge + rationale, the review gate, the change-plan diff as the review surface for native tickets, the release-gate stepper (dev → test → prod), and every artifact. |
| `/login` | Split-screen sign-in (email + password). |
| `/settings/users` | Admin — invite users, set roles, activate/deactivate. |
| `/settings/infrastructure` | Admin — customers, their ServiceNow instances (env, auth mode, `credentialRef`, release/probe status), and the Fluent projects. Create + edit; `allowFluentFlows` per customer. |

Glassmorphic design system in `src/app/globals.css` (light + dark + toggle);
`@xyflow/react` for the flow diagrams; charts are hand-rolled SVG.

### Auth & roles

Every route requires a signed-in user (`src/middleware.ts`). Sessions are a signed
JWT (`jose`) in an httpOnly cookie; passwords are bcrypt hashes. Auth code lives in
`src/lib/auth/`.

| Role | Can |
|---|---|
| **Admin** | everything + user management + edit agent personas |
| **Reviewer** | approve / reject / send back for rework at the review gate, submit, view |
| **Requester** | submit requests, view runs — no approve/reject/rework |

Accounts are invite-only: the seeded admin (`AUTH_ADMIN_*` in `apps/web/.env`)
creates users from `/settings/users`.

## Layout (pnpm workspace monorepo)

| Path | What |
|---|---|
| `apps/web` | Next.js 16 (App Router, TS) + Prisma 6 / PostgreSQL. The review UI + API. |
| `docker-compose.yml` | PostgreSQL 16 for the app (host port **5433**). `docker compose up -d`. |
| `servicenow/delivery-app` | now-sdk (ServiceNow Fluent) project. Deploy target for generated code. |
| `docs/` | Cached now-sdk orientation + CLI reference (grounding for later agent prompts). |
| `.env` | Runtime config (Anthropic key, PDI creds). Git-ignored; copy from `.env.example`. |

## Prerequisites

- Node ≥ 20.18 (using v24), pnpm ≥ 10.8 (`npm i -g pnpm`).
- **Microsoft Visual C++ 2015–2022 Redistributable (x64)** — the ServiceNow SDK's
  native credential-store addon (`@napi-rs/keyring`) needs `VCRUNTIME140.dll`.
  Install with `winget install Microsoft.VCRedist.2015+.x64` if `now-sdk`
  fails with "Cannot find native binding".
- pnpm is configured with `nodeLinker: hoisted` (in `pnpm-workspace.yaml`) so the
  SDK's native addons resolve — do not remove that.

## Common commands

```bash
docker compose up -d               # start PostgreSQL (host port 5433)
pnpm install                       # install all workspaces
pnpm --filter web db:migrate       # apply Prisma migrations
pnpm --filter web db:seed          # create the admin from apps/web/.env (AUTH_ADMIN_*)
pnpm dev                           # run the Next.js app (apps/web) on :3000
pnpm --filter web db:studio        # browse the DB

# Agent pipeline (Phase 1) — needs ANTHROPIC_API_KEY in the repo-root .env
pnpm --filter web pipeline                         # run the laptop-request example end to end
pnpm --filter web pipeline "Title" "Description"    # run a custom request
pnpm --filter web pipeline -- --resume <ticketId>  # rerun only the failed/pending stages
# API: POST /api/tickets {title,description} kicks off the pipeline (fire-and-forget);
#      GET /api/tickets and GET /api/tickets/:id for status + artifacts.
# A full 5-stage run takes ~15-25 min and costs roughly $0.30-1.00 on claude-sonnet-5.

# ServiceNow SDK (run inside servicenow/delivery-app)
pnpm exec now-sdk auth --list
pnpm exec now-sdk query <table> -q '<encoded query>' -o json
pnpm exec now-sdk build
pnpm exec now-sdk install          # (alias: deploy) — Phase 3, gated by Approve
```

## Environment split

- **`.env`** (repo root) — `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `SN_*`,
  `WORKSPACES_ROOT`. Loaded by the app/pipeline.
- **`apps/web/.env`** — only `DATABASE_URL` (Prisma CLI convention).

## Customers, Instances, Projects

A ticket is attributed to a `Customer` → `Instance` (a ServiceNow environment).
A **Fluent-tier** ticket also gets a `FluentProject` — a standalone `now-sdk`
project (own directory, `package.json`, `node_modules`, git repo) under
`WORKSPACES_ROOT` (default `./workspaces/`, git-ignored). A **native-tier** ticket
has no project; its script files live in `workspaces/<customer>/native/<ticket>/`
and its records go straight through the Table API. Manage all of this at
`/settings/infrastructure`, or seed the demo:
`pnpm --filter web seed-demo-customer` registers the PDI (dev424712) as the demo
customer + instance and imports its two apps as projects.

Per-instance setup for the native engine (once): `setup-service-users` (the
`svc_snowdevteam_ro` / `_deploy` OAuth users, `authMode = "oauth_cc"`),
`probe-instance` (release detection), `setup-native-engine` (the server-side
Scripted REST resource). See `docs/customer-onboarding.md`.

### The project accumulates (git per ticket)

Each ticket's generated code lands in **its own subdirectory** —
`src/fluent/t-<id>-<slug>/` and `src/server/t-<id>-<slug>/` — and stays; the whole
project compiles as one, so a ticket that conflicts with delivered work fails its
build gate. The pipeline runs each ticket on a `ticket/…` branch in the project
repo; a passing build gate commits the branch. **Approve** rebuilds just that
ticket's sources onto the default branch (no `git merge` → no `keys.ts` conflict),
runs `now-sdk build --frozenKeys` as a CI check, installs, then commits. `keys.ts`
is a committed, branch-tracked file — never snapshot/restored.

Same-project tickets serialize only on the three tree-touching steps (build gate,
the Developer's `build` tool, deploy); their agent stages run in parallel.
