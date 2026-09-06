import type { Instance } from "@prisma/client";
import { SnowClient } from "@/lib/servicenow/client";

/**
 * The router (NATIVE_ENGINE_BRIEF §6). Deterministic code — not an LLM
 * judgement — that decides *where* a request's work belongs. The Architect
 * (Phase 7) consumes the result and may only argue for something more
 * conservative.
 *
 * Rules, in order (first match wins):
 *   1. vendor scope           → NOT_SUPPORTED (Build Agent / human)
 *   2. explicit new-app ask   → FLUENT_SCOPED_APP  (the ONLY way to get here)
 *   3. Flow Designer flow     → reuse | reuse+extension (native) | FLUENT_FLOW | human
 *   4. customer-owned app     → NATIVE_SCOPED
 *   5. default                → NATIVE_GLOBAL
 *
 * "Scope follows the work, never the tool." A new application scope is chosen
 * only when the requirement text explicitly asks for one, and the requirement
 * line is quoted (acceptance #5).
 */

export type RouteTier = "NATIVE_GLOBAL" | "NATIVE_SCOPED" | "FLUENT_FLOW" | "FLUENT_SCOPED_APP" | "NOT_SUPPORTED";
export type FlowRoute = "reuse" | "reuse_plus_extension" | "fluent_flow" | "human";

export interface ReusedRecord {
  table: string;
  sysId: string;
  name: string;
  scope: string;
}

export interface Route {
  tier: RouteTier;
  /** "global" | "x_acme_hr" | "" (NOT_SUPPORTED) */
  scope: string;
  rationale: string;
  reused: ReusedRecord[];
  flowRoute?: FlowRoute;
  /** The requirement sentence that asked for a new app scope (tier FLUENT_SCOPED_APP). */
  requirementQuote?: string;
  blocked?: { reason: string; recommendation: string };
}

export interface OwnScopedApp {
  scope: string;
  name: string;
}

export interface RouteInput {
  requestText: string;
  customer: { id: string; allowFluentFlows: boolean };
  instance: Instance | null;
  scopedApps: OwnScopedApp[];
}

// --- pattern tables ------------------------------------------------------

/** Vendor scope prefixes + OOB table families the native engine will not touch. */
const VENDOR_SCOPE_RE = /\bsn_[a-z0-9_]+\b/i;
const VENDOR_TABLE_HINTS: { re: RegExp; product: string }[] = [
  { re: /\bcsm\b|customer service (case|management)|sn_customerservice|\bsn_cs\b/i, product: "Customer Service Management" },
  { re: /\bhrsd\b|hr (case|service delivery)|sn_hr_core|human resources? case/i, product: "HR Service Delivery" },
  { re: /\bitom\b|discovery|service mapping|event management|sn_itom/i, product: "IT Operations Management" },
  { re: /\bsecops\b|security incident response|vulnerability response|sn_si_|sn_vul/i, product: "Security Operations" },
  { re: /\birm\b|\bgrc\b|policy and compliance|risk management|sn_grc|sn_risk/i, product: "Governance, Risk & Compliance" },
  { re: /field service management|\bfsm\b|sn_fsm|wm_order/i, product: "Field Service Management" },
];

/** The request explicitly asks for a brand-new application scope. */
const NEW_APP_RE =
  /\bnew (scoped |custom |standalone )?app(lication)?\b|\bgreenfield app\b|\bits own scope\b|\bseparate scoped application\b|\bbuild .{0,40}\bas an? (new )?application\b/i;

/** The request implies a Flow Designer flow. */
const FLOW_RE = /\bflow designer\b|\bsubflow\b|\borchestrat\w*\b|\bmulti[- ]step (approval|workflow)\b|\bflow\b/i;
/** Wording that says an existing flow already does the job. */
const FLOW_REUSE_RE = /\bexisting flow\b|\balready has a flow\b|\breuse the .{0,30}flow\b|\bhook (into|onto) the .{0,30}flow\b/i;
const FLOW_EXTEND_RE = /\bextend the .{0,30}flow\b|\badditional (business rule|logic) (on top|alongside)\b/i;

// --- artefact hints (deliberately loose; Phase 7 replaces with structured BA output) ---

export type ArtifactKind = "catalog_item" | "business_rule" | "script_include" | "ui_policy" | "acl" | "notification" | "flow" | "sla";

export interface ArtifactHint {
  kind: ArtifactKind;
  name: string;
}

const HINT_RULES: { kind: ArtifactKind; table: string; re: RegExp }[] = [
  { kind: "catalog_item", table: "sc_cat_item", re: /\bcatalog item\b|\brequest item\b|\border(able)? (item|service)\b|\brecord producer\b/i },
  { kind: "business_rule", table: "sys_script", re: /\bbusiness rule\b/i },
  { kind: "script_include", table: "sys_script_include", re: /\bscript include\b/i },
  { kind: "ui_policy", table: "sys_ui_policy", re: /\bui policy\b/i },
  { kind: "acl", table: "sys_security_acl", re: /\bacl\b|\baccess control\b/i },
  { kind: "notification", table: "sysevent_email_action", re: /\b(email )?notification\b/i },
  { kind: "flow", table: "sys_hub_flow", re: FLOW_RE },
  { kind: "sla", table: "contract_sla", re: /\bsla\b|\bservice level\b/i },
];

const TABLE_FOR_KIND: Record<ArtifactKind, string> = {
  catalog_item: "sc_cat_item",
  business_rule: "sys_script",
  script_include: "sys_script_include",
  ui_policy: "sys_ui_policy",
  acl: "sys_security_acl",
  notification: "sysevent_email_action",
  flow: "sys_hub_flow",
  sla: "contract_sla",
};

/** Pull a plausible name for a hinted artefact — a Quoted Phrase or a Capitalised run near the keyword. */
function nameNear(text: string, idx: number): string {
  const window = text.slice(Math.max(0, idx - 80), idx + 80);
  const quoted = window.match(/["'“”]([^"'“”]{3,60})["'“”]/);
  if (quoted) return quoted[1].trim();
  const titled = window.match(/\b([A-Z][A-Za-z0-9]+(?:\s+[A-Z][A-Za-z0-9]+){0,4})\b/);
  return titled ? titled[1].trim() : "";
}

export function extractArtifactHints(text: string): ArtifactHint[] {
  const hints: ArtifactHint[] = [];
  const seen = new Set<string>();
  for (const rule of HINT_RULES) {
    const m = rule.re.exec(text);
    if (!m) continue;
    const name = nameNear(text, m.index);
    const key = `${rule.kind}:${name.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    hints.push({ kind: rule.kind, name });
  }
  return hints;
}

// --- scope classification ----------------------------------------------

export function classifyScope(scopeName: string, ownScopes: string[]): "global" | "customer" | "vendor" {
  const s = (scopeName || "").trim();
  if (!s || s === "global" || s === "Global") return "global";
  if (ownScopes.includes(s)) return "customer";
  if (/^sn_/i.test(s)) return "vendor";
  // an x_ scope that isn't the customer's own is treated as a vendor/3rd-party app
  return /^x_/i.test(s) ? "vendor" : "global";
}

// --- instance probe (§6.1) -------------------------------------------

/**
 * For each hinted artefact, look for an existing record on the instance and
 * record its scope. Read-only; best-effort — a probe failure never blocks
 * routing. `nameLIKE` so a loose hint still finds near-matches.
 */
export async function probeArtifacts(
  instance: Instance,
  hints: ArtifactHint[],
  ownScopes: string[],
): Promise<{ reused: ReusedRecord[]; vendorHits: { name: string; scope: string; product?: string }[] }> {
  const reused: ReusedRecord[] = [];
  const vendorHits: { name: string; scope: string }[] = [];
  if (hints.length === 0) return { reused, vendorHits };

  let client: SnowClient;
  try {
    client = SnowClient.forInstance(instance, { readOnly: true });
  } catch {
    return { reused, vendorHits };
  }

  for (const hint of hints) {
    if (!hint.name || hint.name.length < 3) continue;
    const table = TABLE_FOR_KIND[hint.kind];
    try {
      const rows = await client.table.list<{ sys_id: string; name?: string; short_description?: string; "sys_scope.scope"?: string }>(
        table,
        { query: `nameLIKE${hint.name}^ORshort_descriptionLIKE${hint.name}`, fields: "sys_id,name,short_description,sys_scope.scope", limit: 3 },
      );
      for (const r of rows) {
        const scope = String(r["sys_scope.scope"] ?? "global");
        const name = String(r.name ?? r.short_description ?? hint.name);
        reused.push({ table, sysId: r.sys_id, name, scope });
        if (classifyScope(scope, ownScopes) === "vendor") vendorHits.push({ name, scope });
      }
    } catch {
      /* best-effort */
    }
  }
  return { reused, vendorHits };
}

// --- the router ------------------------------------------------------

function firstSentenceMatching(text: string, re: RegExp): string | undefined {
  for (const sentence of text.split(/(?<=[.!?\n])\s+/)) {
    if (re.test(sentence)) return sentence.trim().slice(0, 300);
  }
  return undefined;
}

export async function routeTicket(input: RouteInput): Promise<Route> {
  const text = input.requestText;
  const ownScopes = input.scopedApps.map((a) => a.scope);
  const hints = extractArtifactHints(text);
  const probe = input.instance ? await probeArtifacts(input.instance, hints, ownScopes) : { reused: [], vendorHits: [] };

  // 1. vendor scope — named product family, an sn_ scope/table, or a probe that
  //    landed in a vendor scope.
  const vendorProduct = VENDOR_TABLE_HINTS.find((v) => v.re.test(text));
  const namesVendorScope = VENDOR_SCOPE_RE.test(text) && !ownScopes.some((s) => text.includes(s));
  if (vendorProduct || namesVendorScope || probe.vendorHits.length > 0) {
    const reason =
      vendorProduct
        ? `The request targets ${vendorProduct.product}, a vendor-owned scope.`
        : namesVendorScope
          ? `The request names a vendor (sn_*) scope the customer does not own.`
          : `An implied artefact already lives in a vendor scope (${probe.vendorHits.map((h) => h.scope).join(", ")}).`;
    return {
      tier: "NOT_SUPPORTED",
      scope: "",
      rationale: `${reason} Vendor scopes are not Table-API authorable and the native engine will not create a new app to work around it.`,
      reused: probe.reused,
      blocked: {
        reason,
        recommendation: "Route to the Build Agent or a human developer working inside the vendor application.",
      },
    };
  }

  // 2. explicit new-application request — the ONLY path to FLUENT_SCOPED_APP.
  if (NEW_APP_RE.test(text)) {
    const quote = firstSentenceMatching(text, NEW_APP_RE);
    return {
      tier: "FLUENT_SCOPED_APP",
      scope: "",
      rationale: `The requirement explicitly asks for a new application scope: "${quote ?? "(new app requested)"}". Building it via the Fluent project machinery.`,
      reused: probe.reused,
      requirementQuote: quote,
    };
  }

  // 3. Flow Designer.
  if (FLOW_RE.test(text)) {
    const flowHits = probe.reused.filter((r) => r.table === "sys_hub_flow");
    if (FLOW_REUSE_RE.test(text) || flowHits.length > 0) {
      return {
        tier: "NATIVE_GLOBAL",
        scope: "global",
        rationale: `An existing flow${flowHits.length ? ` (${flowHits[0].name})` : ""} covers the orchestration; only the item→flow link and its configuration are written natively.`,
        reused: probe.reused,
        flowRoute: "reuse",
      };
    }
    if (FLOW_EXTEND_RE.test(text)) {
      return {
        tier: "NATIVE_GLOBAL",
        scope: "global",
        rationale: `An existing flow is reused with a server-side business rule / script include for the extra behaviour — the flow itself is not modified.`,
        reused: probe.reused,
        flowRoute: "reuse_plus_extension",
      };
    }
    if (input.customer.allowFluentFlows) {
      return {
        tier: "FLUENT_FLOW",
        scope: "global",
        rationale: `A net-new Flow Designer flow is required; authored in a Fluent global app and deployed separately from the update set (allowFluentFlows is on for this customer).`,
        reused: probe.reused,
        flowRoute: "fluent_flow",
      };
    }
    return {
      tier: "FLUENT_FLOW",
      scope: "global",
      rationale: `A net-new Flow Designer flow is required but Fluent flows are disabled for this customer. The ticket waits at an AWAITING_FLOW gate for a human to build it with the ticket's update set current.`,
      reused: probe.reused,
      flowRoute: "human",
      blocked: {
        reason: "A net-new flow must be built by a human.",
        recommendation: "Build the flow against the ticket's update set, then resume the pipeline to verify it.",
      },
    };
  }

  // 4. customer-owned scoped app.
  const ownedHit =
    input.scopedApps.find((a) => new RegExp(`\\b${escapeRe(a.name)}\\b`, "i").test(text)) ??
    input.scopedApps.find((a) => text.includes(a.scope) || text.includes(`${a.scope}_`));
  const probeInOwned = probe.reused.find((r) => classifyScope(r.scope, ownScopes) === "customer");
  if (ownedHit || probeInOwned) {
    const app = ownedHit ?? input.scopedApps.find((a) => a.scope === probeInOwned!.scope)!;
    return {
      tier: "NATIVE_SCOPED",
      scope: app.scope,
      rationale: `The work belongs to the customer-owned application "${app.name}" (${app.scope}); written into that scope with an update set in that scope.`,
      reused: probe.reused,
    };
  }

  // 5. default.
  return {
    tier: "NATIVE_GLOBAL",
    scope: "global",
    rationale:
      probe.reused.length > 0
        ? `Global-scope work. Reuses ${probe.reused.length} existing record(s); everything new lands in Global with the ticket's update set.`
        : `Global-scope work (catalog / server logic / OOB-table configuration). Written to Global with the ticket's update set.`,
    reused: probe.reused,
  };
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** True when the pipeline should skip the Fluent build machinery for this tier. */
export function isNativeTier(tier: string | null | undefined): boolean {
  return !!tier && tier.startsWith("NATIVE");
}
