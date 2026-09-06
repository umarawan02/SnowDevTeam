# The native pipeline

How a native-tier ticket flows through the agent pipeline (NATIVE_ENGINE_BRIEF
§6–§7). Contrast with the Fluent flow/app tier, which still builds `.now.ts`
source and runs `now-sdk build`.

## Routing (§6)

`createTicket` → `routeTicket` (`src/lib/pipeline/route.ts`), deterministically,
at creation. `NATIVE_GLOBAL` is the default. The ticket stores `executionTier`,
`tierRationale`, `routeScope`. A native ticket gets **no** `FluentProject`.

## The pipeline (§7)

`runPipeline` builds a `PipelineContext` with `native: true`, the
`{{PROJECT_CONTEXT}}` block (`src/lib/agents/project-context.ts`), the ticket's
`Instance`, and `nativeScriptsDir` (`workspaces/<customer>/native/<ticketDir>/`).

Each stage:

- **Prompts** — `systemPromptFor(role, { native: true })`. The Developer gets
  `developer-native.md`; the Architect / Senior Dev / Developer / QA all get the
  `grounding-native.md` appendix instead of the Fluent one. Every grounded
  prompt is prefixed with the Project context block.
- **Tools** — a tool-using native stage mounts the **native MCP server**
  (`src/lib/nativeengine/mcp.ts`): `query` (read-only instance data),
  `table_spec` (the allow-list entry for a table), and `validate_plan`
  (schema + lint + typecheck + read-only dry-run diff — the Developer's build
  step). No `apply` / `promote` / `rollback` — ever.

### BA
Emits a `## Artefacts` list (kind + name + purpose) alongside the requirements.

### Architect
Emits a mandatory `## Scope & routing` section. May tighten the route with a
`ROUTE_OVERRIDE: <TIER>` line — never loosen it (`NATIVE_GLOBAL` → `NATIVE_SCOPED`
→ `FLUENT_FLOW` → `FLUENT_SCOPED_APP` → `NOT_SUPPORTED`). `run.ts:applyRouteOverride`
applies it: `NOT_SUPPORTED` fails the ticket, `FLUENT_*` parks it at
`AWAITING_FLOW`.

### Developer
Emits one ` ```json ` **CHANGE_PLAN** block + zero-or-more `=== FILE: <name>.js ===`
script blocks. Calls `validate_plan` until clean.

### Plan gate (replaces the build gate)
`run.ts:runPlanGate` — `parseNativePlan` → write scripts to `nativeScriptsDir` →
`runValidation` (`src/lib/nativeengine/gate.ts`). On error, re-run the Developer
with the findings (≤ 2 rounds). On success, write the `CHANGE_PLAN` and
`CHANGE_PLAN_DIFF` artifacts.

### QA
Reviews coverage: every acceptance criterion has a change + an ATF test; the
diff creates/updates exactly the design. Thin ATF coverage → `REWORK_FROM:
DEVELOPER`.

## Review + apply

The reviewer approves the **`CHANGE_PLAN_DIFF`** (the primary review surface).
Approve → `deployTicket` → `deployNativeTicket` → `applyChangePlan` (Phase 5):
one update set, verified, then promoted dev→test→prod via `sn_cicd`.

## What's still Fluent

`FLUENT_FLOW` (a net-new Flow Designer flow) and `FLUENT_SCOPED_APP` (an
explicitly-requested new application) route to the Phase 1–2 project machinery
and the original `developer.md` + `grounding.md` + `now-sdk build`.
