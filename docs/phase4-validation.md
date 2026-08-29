# Phase 4 — end-to-end validation

Date: 2026-08-29 · Instance: `dev424712` · Scope: `x_1460392_delivery`

## What was validated

One ticket was run the whole way — customer request → 5 agents → human review →
Approve → live ServiceNow artifacts — and independently re-verified against the
instance.

**Ticket:** *"Company t-shirt request"* — a Service Portal item for requesting a
branded t-shirt, manager approval, then a fulfillment task for Facilities.

| Definition-of-done item (`BUILD_PROMTP.md`) | Result |
|---|---|
| Submit a feature request in the browser | ✅ `POST /api/tickets` → redirect to the live detail page |
| All five agents run; their real output is readable | ✅ BA (64s) → Architect (5m52s) → Senior Dev (5m55s) → Developer (6m39s) → QA (5m13s); all 5 artifacts render as tabs (tables, code file-cards, severity chips) |
| Correct status tracking, no silent crashes | ✅ `PENDING → RUNNING → READY_FOR_REVIEW`; a failed stage would set `FAILED` with the error on that step (proven earlier on a rate-limit and on build failures) |
| Human reviews requirements, design, code, QA verdict in the UI | ✅ all in the ticket detail tabs; QA verdict shown as a banner |
| Approve only via an explicit click | ✅ the `Review gate` card (Approve & deploy / Reject) shows **only** when `READY_FOR_REVIEW`; `deployTicket()` and both API routes hard-require that status; `409` otherwise |
| Approve → parse code, write to workspace, `now-sdk build` then `deploy`, store the full log | ✅ 7 files written, `now-sdk build` exit 0, `now-sdk install --auth pdi` exit 0, full log saved as a `DEPLOY_LOG` artifact |
| Build failure must not deploy | ✅ `deployTicket` stops on a non-zero build exit and never calls `install` (proven on the guest-wifi and laptop tickets) |
| Post-deploy `query` verification, stored as an artifact; a clean exit code is not enough | ✅ `DEPLOY_VERIFICATION` artifact; ticket becomes `DEPLOYED` **only if** the `sys_app` row exists *and* ≥1 catalog item is in scope |
| Reject → required note, stored, status `REJECTED` | ✅ verified on the laptop ticket (note stored; `409` on any later action) |
| Nothing reaches the PDI without the Approve click | ✅ no code path deploys any other status; no test auto-approves |
| **Approve produces a real, working catalog item + fulfillment flow in the PDI** | ✅ see below |

## Live result in `dev424712` (independent CLI queries, post-approval)

| Record | sys_id | State |
|---|---|---|
| `sys_app` — AI Delivery App v0.0.1 | `f53ca6b1…` | active |
| `sc_cat_item` — **Company T-Shirt Request** | `620491dc1a2343508d724eb18ffaeb6b` | active · in "Service Catalog" · category "Employee Services" · `flow_designer_flow` → the flow below |
| 5 form variables | — | `requested_for` (Requested For, mandatory) · `tshirt_size` (Select Box, mandatory) · `office_location` (Reference, mandatory) · `special_instructions` (Multi-line, optional) · `manager_display` (Reference, optional) |
| `sys_hub_flow` — **T-Shirt Request - Approval and Fulfillment** | `3009317c122b49e3aa392401f2fd340a` | active, published (`latest_snapshot` set) · trigger `service_catalog` · 5 ordered steps: Get Catalog Variables → Ask For Approval → Create Catalog Task → Update Record → Update Record |

## Do the QA verdict, the design, and the deployed result line up?

**Architect design ↔ deployed result: match.** Every artifact the ADR specified
(CatalogItem, the four variable types, the seeded category, the
getCatalogVariables → askForApproval → createCatalogTask flow, Service Catalog
placement) is present on the instance exactly as designed.

**QA verdict ↔ deployed result: mismatch — QA over-flagged.** QA returned
`NEEDS_REWORK` on a **BLOCKER** claiming the Developer's
`flow: Now.ref('sys_hub_flow', '<Now.ID key>')` and
`catalogs: Now.ref('sc_catalog', '<sys_id>')` probably wouldn't resolve → "AC7–14
fail silently", plus a CONCERN that the `SelectBoxVariable.choices` object-map
shape might be rejected. In reality **all three build fine and the item is fully
wired** (confirmed on the instance).

Root cause: QA reviews statically and can't run `now-sdk build`, so it was
treating *"I can't confirm this construct"* as a BLOCKER. That inflates almost
every verdict to `NEEDS_REWORK`. **Fixed** in `qa.md` this phase: unverified
constructs are now explicitly CONCERN-with-a-check, and BLOCKER is reserved for
defects QA can point at and explain. (Not yet re-run against this ticket — the
change lands for the next pipeline run.)

## Known rough edges (MVP)

1. **Generated code builds clean for modest-scope requests; elaborate ones need a
   human polish pass.** The t-shirt request (7 files) built first try. The laptop
   and guest-wifi requests (~15–20 files, big flows) went through 5–6 grounding
   iterations and got to 2 residual flow-syntax errors but never fully to 0 — a
   large Fluent flow has ~50 exact-syntax points and the model's per-run variance
   bites 1–3 each time. The `grounding.md` doc absorbed ~7 sections of verified
   Fluent rules along the way; further hardening is possible but has diminishing
   returns without giving the Developer a real typecheck loop.
2. **QA verdict calibration** (above) — the prompt fix is in; needs a run to confirm.
3. **One deploy target.** The now-sdk workspace holds one app; deploying a second
   ticket would emit `keys.ts` deletes for the first. Fine for the MVP demo,
   documented, not solved.
4. **No rework loop.** A `NEEDS_REWORK` verdict or a Reject records the outcome
   and stops — it does not feed back into the pipeline (explicit non-goal).
5. **Pipeline is synchronous and unauthenticated.** A full run is ~20–25 min and
   ~$0.30–1.00; the fire-and-forget model relies on the Node server staying up
   (not serverless-safe). No auth, multi-tenancy, or billing (explicit non-goals).
6. **API rate limits** can fail a stage mid-run; it's marked `FAILED` and
   resumable (`scripts/rerun-from.mts`), but there's no automatic retry.

## Verdict

The MVP does what it set out to do: **a customer request, submitted in a browser,
becomes a real approval + fulfillment flow in a live ServiceNow instance, with a
human gate that cannot be bypassed and a post-deploy check that confirms the
artifact actually exists.** The pipeline's weak spot is generating build-clean
Fluent for large flows; that's a prompt/tooling problem with a clear path
(a Developer-side typecheck loop), not an architectural one.
