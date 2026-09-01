# SnowDevTeam — AI ServiceNow Delivery Team (MVP)

A pipeline of specialized AI agents (Business Analyst → Architect → Senior
Developer → Developer → QA) turns a customer feature request into deployable
ServiceNow artifacts. A human reviews every stage and must click **Approve**
before anything is built and deployed to a real ServiceNow instance.

The **Architect** leads with out-of-the-box ServiceNow — it inventories the
instance and researches best practice (`WebSearch`/`WebFetch`, scoped to
servicenow.com) before designing anything custom, and hands the build team an
authoritative *Implementation guidance* spec. The **Developer**'s code is run
through `now-sdk build` **before QA sees it** (the Developer also has a `build`
tool to self-check); a compile failure re-runs the Developer against the errors,
up to 3 times, then fails the ticket at that stage. When **QA** returns
`NEEDS_REWORK`, the pipeline **loops back automatically** (up to 2 rounds) from
the stage QA points at, with the findings as a must-fix directive; a reviewer
can also **Send back for rework** from the gate.

Status: **MVP complete** — all 4 build phases done, plus a product-UI redesign.
Submitting a request in the browser runs the 5 agents, the human reviews every
artifact, and clicking **Approve** builds + deploys a real catalog item and flow
to the PDI (verified by a post-deploy query). See `BUILD_PROMTP.md` for the phase
plan and `docs/phase4-validation.md` for the end-to-end validation write-up.

### The app (`apps/web`)

| Screen | What |
|---|---|
| `/` Dashboard | KPIs, throughput, per-agent stage timing, pipeline funnel, review queue, activity feed, spend. |
| `/intake`, `/intake/[id]` | Chat intake — talk to an assistant that gathers the requirements, then **Start development** creates the ticket and kicks off the pipeline. |
| `/board` | Live status kanban — cards move across columns as the pipeline runs. |
| `/agents`, `/agents/[role]` | The 5 AI personas (`AgentPersona` table). Rename them and rewrite their profile + "voice" — the name and voice are threaded into that agent's system prompt on every run. |
| `/tickets/[id]` | Run detail: the pipeline as a live node graph, the review gate, a "what gets built" flow diagram parsed from the generated code, and every artifact. |
| `/login` | Split-screen sign-in (email + password). |
| `/settings/users` | Admin — invite users, set roles, activate/deactivate. |

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
  `NOW_SDK_WORKSPACE`. Loaded by the app/pipeline.
- **`apps/web/.env`** — only `DATABASE_URL` (Prisma CLI convention).
