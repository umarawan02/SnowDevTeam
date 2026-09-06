/**
 * Router cases (NATIVE_ENGINE_BRIEF §6). No test runner in this repo — a
 * self-contained assert script, like validate-plan-negatives.mts.
 *
 *   pnpm --filter web route-cases
 *
 * All cases run with `instance: null` so they're deterministic and offline —
 * the instance probes (§6.1) are exercised separately against a real PDI.
 */
import "@/lib/config";
import { routeTicket, type RouteInput, type RouteTier } from "@/lib/pipeline/route";

const DEMO_APPS = [{ scope: "x_acme_onboard", name: "Acme Onboarding" }];

function input(requestText: string, over: Partial<RouteInput> = {}): RouteInput {
  return {
    requestText,
    customer: { id: "c1", allowFluentFlows: true },
    instance: null,
    scopedApps: DEMO_APPS,
    ...over,
  };
}

interface Case {
  name: string;
  input: RouteInput;
  expect: (r: Awaited<ReturnType<typeof routeTicket>>) => string | null; // null = pass
}

const tierIs = (want: RouteTier) => (r: { tier: RouteTier }) => (r.tier === want ? null : `got tier ${r.tier}, want ${want}`);

const cases: Case[] = [
  {
    name: "plain catalog item → NATIVE_GLOBAL",
    input: input("Add a 'Laptop request' catalog item with a manager-approval step and a fulfilment task."),
    expect: tierIs("NATIVE_GLOBAL"),
  },
  {
    name: "business rule on an OOB table → NATIVE_GLOBAL",
    input: input("Add a business rule to the incident table that pauses the SLA when the caller is on hold."),
    expect: tierIs("NATIVE_GLOBAL"),
  },
  {
    name: "explicit new scoped app → FLUENT_SCOPED_APP with a quote",
    input: input("Build this as a new scoped application called Acme Expense so it can ship on the store."),
    expect: (r) =>
      r.tier !== "FLUENT_SCOPED_APP"
        ? `got ${r.tier}`
        : r.requirementQuote && /new scoped application/i.test(r.requirementQuote)
          ? null
          : `requirementQuote missing/weak: ${r.requirementQuote ?? "(none)"}`,
  },
  {
    name: "CSM case table → NOT_SUPPORTED + Build Agent rec",
    input: input("Add a field to the CSM customer service case form and a business rule on sn_customerservice_case."),
    expect: (r) =>
      r.tier !== "NOT_SUPPORTED"
        ? `got ${r.tier}`
        : r.blocked && /build agent|human/i.test(r.blocked.recommendation)
          ? null
          : `blocked.recommendation missing: ${JSON.stringify(r.blocked)}`,
  },
  {
    name: "names a vendor sn_ scope → NOT_SUPPORTED",
    input: input("Update the sn_hr_core_case business rule to route onboarding tasks to Facilities."),
    expect: tierIs("NOT_SUPPORTED"),
  },
  {
    name: "work in the customer's own scoped app → NATIVE_SCOPED, right scope",
    input: input("In the Acme Onboarding app, add a UI policy to the new-hire request form."),
    expect: (r) => (r.tier === "NATIVE_SCOPED" && r.scope === "x_acme_onboard" ? null : `got ${r.tier} / ${r.scope}`),
  },
  {
    name: "net-new flow, allowFluentFlows on → FLUENT_FLOW",
    input: input("Create a new multi-step approval workflow in Flow Designer for capital purchases."),
    expect: (r) => (r.tier === "FLUENT_FLOW" && r.flowRoute === "fluent_flow" ? null : `got ${r.tier} / ${r.flowRoute}`),
  },
  {
    name: "net-new flow, allowFluentFlows off → human",
    input: input("Create a new multi-step approval workflow in Flow Designer for capital purchases.", {
      customer: { id: "c1", allowFluentFlows: false },
    }),
    expect: (r) => (r.tier === "FLUENT_FLOW" && r.flowRoute === "human" ? null : `got ${r.tier} / ${r.flowRoute}`),
  },
  {
    name: "reuse an existing flow → NATIVE_GLOBAL (reuse)",
    input: input("Wire the new catalog item into the existing 'Standard hardware' flow — reuse the flow, just link it."),
    expect: (r) => (r.tier === "NATIVE_GLOBAL" && r.flowRoute === "reuse" ? null : `got ${r.tier} / ${r.flowRoute}`),
  },
];

// The guarantee (acceptance #5): none of these — which never ask for a new app —
// may route to FLUENT_SCOPED_APP.
const NEVER_NEW_APP = [
  "Add a catalog item for ordering a monitor.",
  "Create a business rule on sc_req_item to set the assignment group.",
  "Add an ACL so only managers can see the salary field.",
  "Build a client script that hides a variable when the country is not US.",
  "Add an SLA definition for P1 incidents.",
  "Create a scheduled job that closes stale requests after 30 days.",
  "Add a notification when a request is approved.",
  "Make a UI policy that requires a justification over $500.",
  "Add a script include with a helper to look up a user's manager.",
];

async function main() {
  let failures = 0;

  for (const c of cases) {
    const r = await routeTicket(c.input);
    const err = c.expect(r);
    console.log(`${err ? "✗" : "✓"}  ${c.name}${err ? `  — ${err}` : ""}`);
    if (err) failures++;
  }

  console.log("\n— never-pick-a-new-app guarantee —");
  for (const text of NEVER_NEW_APP) {
    const r = await routeTicket(input(text));
    const bad = r.tier === "FLUENT_SCOPED_APP";
    console.log(`${bad ? "✗" : "✓"}  ${r.tier.padEnd(16)} ${text}`);
    if (bad) failures++;
  }

  console.log("");
  console.log(failures === 0 ? "RESULT: PASS" : `RESULT: FAIL — ${failures} case(s)`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("route-cases CRASHED:", e instanceof Error ? (e.stack ?? e.message) : e);
  process.exit(1);
});
