# SnowDevTeam — AI ServiceNow Delivery Team (MVP)

A pipeline of specialized AI agents (Business Analyst → Architect → Senior
Developer → Developer → QA) turns a customer feature request into deployable
ServiceNow artifacts. A human reviews every stage and must click **Approve**
before anything is built and deployed to a real ServiceNow instance.

Status: **Phase 1 complete** (agent pipeline). Phase 2 next (review UI).
See `BUILD_PROMTP.md` for the full phase plan.

## Layout (pnpm workspace monorepo)

| Path | What |
|---|---|
| `apps/web` | Next.js 16 (App Router, TS) + Prisma 6 / SQLite. The review UI + API. |
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
pnpm install                       # install all workspaces
pnpm dev                           # run the Next.js app (apps/web) on :3000
pnpm --filter web db:migrate       # apply a new Prisma migration
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
