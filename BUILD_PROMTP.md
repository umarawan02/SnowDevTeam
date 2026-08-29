# Claude Code Build Prompt — ServiceNow AI Delivery Team, MVP

Paste this whole document into Claude Code as your starting instruction.
Work through the phases **in order** — each phase has its own done
criteria. Don't start the next phase until the current one is verifiably
working, and tell me clearly when a phase is complete and what you
verified.

---

<context>
I'm building a SaaS product: an AI-staffed ServiceNow delivery team. A
customer submits a feature request, a pipeline of specialized AI agents
(Business Analyst, Architect, Senior Developer, Developer, QA) works
through it in sequence, and a human reviews and approves everything
before it deploys to a real ServiceNow instance. Nothing reaches
ServiceNow without explicit human approval — that gate is the core value
proposition, not an afterthought.

This is the MVP: a working local build that proves the full pipeline
end-to-end for ONE narrow use case — a Service Catalog item with an
attached fulfillment flow. "MVP" here means **fully functional**, not a
mockup: at the end of this, clicking Approve must produce a real catalog
item and flow that actually exist in my ServiceNow instance.
</context>

<what_i_actually_have>
Be precise about this — do not assume more exists than does:

- I have a ServiceNow PDI (Personal Developer Instance). That's it. No
  now-sdk project has been initialized yet. No prior scaffolding exists.
- I have an Anthropic API key.
- I do NOT have a pre-existing now-sdk workspace, so initializing and
  authenticating one against my PDI is part of this build, not a
  prerequisite I've already done.
</what_i_actually_have>

<available_resources>
These are tools/references available to leverage while building — not
things that are already wired into a product:

- **`now-sdk`** (`@servicenow/sdk`) — the actual ServiceNow code-first
  development CLI. Check its own docs/skill/`--help` output for current
  commands and Fluent syntax rather than relying on training-data memory
  of it — flag anything you're unsure about instead of guessing at
  Fluent API shape.
- **ServiceNow Community** — a knowledge source for current best
  practice and known gotchas. Not wired into the agents in this MVP
  (that's a later phase) — mentioned here so you know it exists as
  context, not something to integrate yet.
- **`now-sdk`'s own `explain` and `query` subcommands are a real,
  tool-callable documentation and live-data system — use them as tools,
  not just a reference.** Specifically:
  - `npx @servicenow/sdk explain quickstart --list --format=raw` and
    `explain fluent-language --list --format=raw` (plus `explain
    keys-file --format=raw`) are the required orientation for any
    now-sdk project — read every topic they return in full before
    generating Fluent code. This is documented in the now-sdk skill
    itself; follow its exact workflow rather than approximating it.
  - `explain <topic> --peek --format=raw` before reading a full topic;
    only open the full topic if the peek confirms relevance.
  - `query <table> -q '<query>' -o json` reads live instance data (not
    documentation) — useful for checking naming conflicts before
    finalizing a design, and for verifying a deployed artifact actually
    exists afterward.
  - Before wiring any `now-sdk` subcommand into our backend code (build,
    deploy, query), run `npx @servicenow/sdk <subcommand> --help` first
    to get real current flags. Do not hardcode assumed flags for build/
    deploy — the skill is explicit that top-level `--help` does not show
    subcommand flags, so guessing here is a documented mistake, not a
    reasonable shortcut.
  - Hard safety rule carried into the Developer and Sr. Developer
    prompts below: never delete a `Table()` / `BusinessRule()` /
    `Record()` definition from a `.now.ts` file without explicit human
    confirmation — a deletion may need to propagate as an upgrade-time
    delete via `keys.ts`, which the code alone can't reveal.
- **My ITSM skill document** (attached separately, "IT Service Manager"
  skill) — this defines the real templates my organization uses for
  service catalog design and change management. Use it as the grounding
  structure for the BA and Architect prompts, specifically:
  - The **Service Catalog Design Template** (Service Record, Service
    Details, Service Levels, Request Fulfillment, Maintenance sections)
    should shape what the BA agent's requirements output looks like —
    adapt it into a requirements document for a catalog item, not a
    finished operational service record (some fields like SLA/RTO won't
    apply to a fulfillment request, use judgment on which sections
    genuinely transfer).
  - The **Change Management Framework's risk scoring** (Impact 1–5 ×
    Probability 1–5 = Risk score, with Low/Medium/High/Very High bands)
    should be used verbatim by the Architect agent for its risk
    assessment section, instead of an invented risk scale.
</available_resources>

<tech_stack>
- Frontend + backend: Next.js (App Router), TypeScript, single app
- Database: Prisma ORM + SQLite (local file, zero external setup)
- AI orchestration: Anthropic's Agent SDK. Verify the current package
  name and API against docs.claude.com before writing orchestration
  code — do not assume it from training data.
- ServiceNow integration: `now-sdk` CLI invoked via child_process
</tech_stack>

<agent_roles>
Five roles, in pipeline order. Each produces one clearly-structured
markdown (or code) deliverable and stays in its lane.

1. **ServiceNow Business Analyst** — raw feature request → structured
   requirements grounded in the Service Catalog Design Template
   (adapted as above), plus numbered testable acceptance criteria.
   Flags ambiguity explicitly instead of silently resolving it.
2. **ServiceNow Architect** — requirements → solution design (ADR):
   which now-sdk/Fluent artifacts are needed (Catalog Item, Record
   Producer, Flow, Table, Business Rule, ACL, etc.), data model,
   security considerations, and a risk assessment using the ITSM skill's
   Impact × Probability scoring. Does not write code. **Has live tool
   access to `now-sdk explain`** (search → peek → read, per the skill's
   own workflow) so the design is grounded in the actual installed SDK
   version's Fluent capabilities, not assumed from memory. May also use
   `now-sdk query` read-only to check whether similar artifacts already
   exist on the instance before proposing new ones.
3. **Senior ServiceNow Developer** — design → ordered implementation
   task list + file plan, and defines the review checklist it will use
   later (security, naming, no hardcoded sys_ids, no destructive changes
   to existing definitions without explicit confirmation — see the
   deletion safety rule above). Has the same `explain`/`query` tool
   access as the Architect for planning purposes.
4. **ServiceNow Developer** — task list → actual now-sdk (Fluent)
   TypeScript code, output in a clearly parseable per-file format. **Has
   live tool access to `now-sdk explain`** to look up exact Fluent
   syntax for whatever metadata types the task list calls for before
   writing code — do not let this agent write Fluent code from memory
   alone when the actual syntax is one `explain` call away.
5. **ServiceNow QA** — requirements + design + code → test plan (test
   cases per acceptance criterion) + static review with PASS/CONCERN/
   BLOCKER findings + an overall READY FOR HUMAN REVIEW / NEEDS REWORK
   verdict. Be strict — a BLOCKER must not get soft-pedaled into a
   CONCERN.
</agent_roles>

<human_review_gate>
The single most important requirement in this system:

- A ticket reaches READY_FOR_REVIEW only after all five stages complete
  successfully.
- The human reviews requirements, design, generated code, and the QA
  verdict — all rendered clearly in the UI.
- Only an explicit Approve click triggers writing the generated code
  into the now-sdk workspace and running a real `now-sdk build` then
  `now-sdk deploy` against my PDI.
- Reject (with a required note) stops the ticket and records the note.
  It does not need to auto-loop back into the pipeline in this MVP.
- Never auto-approve or skip this gate, including in test scaffolding.
  If you need to re-test the build/deploy step repeatedly, write a
  separate dev-only script — don't weaken the real gate to do it.
</human_review_gate>

---

## Build phases

Work through these in order. After each phase, tell me what you built,
run whatever verification is listed, and confirm it actually works
before moving on.

<phase_0_setup>
**Goal:** a working now-sdk project authenticated against my PDI, and a
scaffolded Next.js + TypeScript + Prisma app — nothing agent-related yet.

- Initialize a `now-sdk` project (`npx @servicenow/sdk init` or current
  equivalent — check its actual current CLI flags, don't assume) and
  walk me through authenticating it against my PDI. Confirm with a
  simple `now-sdk query` call that auth actually works before moving on.
- Run the now-sdk skill's required orientation for this project: `explain
  quickstart --list --format=raw`, `explain fluent-language --list
  --format=raw`, `explain keys-file --format=raw`, and `--help`. Read
  every topic those return in full. Save this as a cached grounding
  document (e.g. `docs/now-sdk-orientation.md`) that Phase 1's Architect
  and Developer prompts can reference — this only needs to be redone if
  the installed `@servicenow/sdk` version changes, not per-ticket.
- Run `npx @servicenow/sdk build --help` and `deploy --help` now and
  record the real flags — Phase 3 will wire these commands using what
  you find here, not assumed syntax.
- Scaffold the Next.js app with TypeScript, install Prisma, and design
  the schema: Ticket (title, description, status, timestamps),
  AgentStep (ticketId, role, order, status, output, error, timestamps),
  Artifact (ticketId, type, content, timestamp). Show me the schema
  before running the migration.
- Set up `.env` for ANTHROPIC_API_KEY, the model string to use (verify
  current valid model names against docs.claude.com), and the path to
  the now-sdk workspace.

**Done when:** `now-sdk` can successfully read something from my PDI
from the command line, and the Next.js app runs locally with the Prisma
schema migrated.
</phase_0_setup>

<phase_1_agent_pipeline>
**Goal:** the five agent prompts and the orchestration logic, testable
from a script or API route without a UI yet.

- Write the five system prompts as their own module, grounded per
  <available_resources> above.
- Write the sequential orchestration: BA → Architect → Sr Dev →
  Developer → QA, persisting an AgentStep + Artifact after each stage.
  Any stage failure marks the ticket FAILED with the error recorded on
  that step, not a silent crash.
- Test it end-to-end with one real request (e.g. "Employees need to
  request a new laptop, with manager approval, that creates a
  fulfillment task for IT ops") and show me the actual output of all
  five stages.

**Done when:** running one ticket through this produces five real,
readable Claude outputs persisted to the database, in order, with
correct status tracking.
</phase_1_agent_pipeline>

<phase_2_review_ui>
**Goal:** a UI where I can submit a request, watch it move through the
pipeline, and read every artifact clearly.

- A page to submit a new request and see existing tickets with status.
- A ticket detail page showing live pipeline progress and every artifact
  rendered readably (not raw JSON dumps).
- Keep styling functional and deliberate — simple type scale, one
  accent color, clear status indication — not unstyled default HTML, but
  also not a marketing page. This is an internal review tool.

**Done when:** I can submit a real request in the browser and read
through all five agents' output without touching the database directly.
</phase_2_review_ui>

<phase_3_approval_and_real_deploy>
**Goal:** the human gate, wired to a real, working ServiceNow deploy.

- Add Approve / Reject controls, visible only when a ticket is
  READY_FOR_REVIEW.
- Approve: parse the Developer's generated code, write it into the
  now-sdk workspace, run `now-sdk build` then `now-sdk deploy` using the
  real flags confirmed in Phase 0, capture and store the full log either
  way, and update ticket status (DEPLOYED or FAILED).
- After a successful deploy, run a `now-sdk query` against the relevant
  table (e.g. the catalog item table) filtered to what was just created,
  and store the result as a DEPLOY_VERIFICATION artifact. A clean
  `deploy` exit code is not sufficient evidence on its own — confirm the
  record actually exists with the expected values.
- Reject: require a note, store it, set status REJECTED.

**Done when:** clicking Approve on a real ticket actually creates a
working catalog item with its fulfillment flow in my PDI — confirmed
both by the stored `query` verification artifact and by you checking the
PDI directly (Service Catalog + Flow Designer).
</phase_3_approval_and_real_deploy>

<phase_4_end_to_end_validation>
**Goal:** confirm the whole thing actually works as a product, not just
as individual working pieces.

- Run at least one full ticket from submission through to a live catalog
  item in the PDI, with me reviewing and approving at the gate.
- If the QA agent's verdict, the Architect's design, or the deployed
  result don't line up with each other, treat that as a bug in the
  pipeline or prompts, not something to smooth over.
- Give me a short summary of what you validated and any known rough
  edges before calling this MVP done.
</phase_4_end_to_end_validation>

---

<non_goals>
Explicitly do NOT build in this pass — flag it instead of quietly adding
any of these "for completeness":
- Multi-tenancy, authentication, or billing
- A background job queue (synchronous pipeline execution is fine)
- A Project Manager agent or backlog/kanban view
- ServiceNow artifact types beyond catalog item + flow
- Live web-search grounding against ServiceNow Community (this is
  distinct from `now-sdk explain`/`query` tool access, which IS in scope
  — Community search is a separate, later integration)
- Automatic rejection-feedback loop-back into the pipeline
- Multi-environment promotion (dev/test/prod) — my PDI is the only
  deploy target
</non_goals>

<working_instructions>
- Start each phase in plan mode if the phase involves a non-trivial
  design decision (e.g. Prisma schema, prompt structure, file-parsing
  format for generated code).
- Verify rather than assume: Agent SDK API shape, now-sdk CLI syntax,
  and Anthropic model strings should all be checked against current
  docs, not recalled from training data.
- If something in a phase turns out to be ambiguous in a way that
  affects architecture, ask me — don't guess and move on.
</working_instructions>

<definition_of_done>
- I can submit a feature request in the browser.
- All five agents run and I can read their real output.
- I can approve or reject at the human gate.
- Approving produces a real, working catalog item with its fulfillment
  flow in my ServiceNow PDI — verified by looking at the PDI itself.
- Rejecting stops the ticket and records my note.
- Nothing ever reaches the PDI without me clicking Approve.
</definition_of_done>