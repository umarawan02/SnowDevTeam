import fs from "node:fs";
import path from "node:path";
import type { Instance } from "@prisma/client";
import { SnowClient } from "@/lib/servicenow/client";
import { validatePlan } from "@/lib/nativeengine/plan";
import { lintPlan, type LintFinding } from "@/lib/nativeengine/lint";
import { typecheckScripts } from "@/lib/nativeengine/scripts";
import { dryRunDiff } from "@/lib/nativeengine/diff";

/**
 * The native-tier quality gate (NATIVE_ENGINE_BRIEF §4 + §7.2). One function
 * behind `validate_plan` (the Developer's tool), `runPlanGate` (the pipeline),
 * and `scripts/validate-plan.mts`. It replaces `now-sdk build` for this tier.
 *
 * Every ServiceNow call it makes is a GET — it asserts that itself. No writes,
 * ever.
 */

export interface GateInput {
  /** Raw parsed change-plan JSON. */
  planInput: unknown;
  /** Directory holding the plan's `script.file` `.js` files (already written). */
  scriptsDir: string;
  /** For the dry-run diff. Omit to skip the diff stage. */
  instance?: Instance | null;
  scopeKind?: "global" | "scoped";
}

export interface GateResult {
  ok: boolean;
  /** Fatal problems — schema, semantics, lint errors, type errors, unexpected writes. */
  errors: string[];
  warnings: string[];
  lintFindings: LintFinding[];
  /** Apply order, when the plan validates. */
  order?: string[];
  /** The dry-run diff markdown (the CHANGE_PLAN_DIFF artifact), when an instance was given. */
  diffMarkdown?: string;
  /** Non-GET requests seen during the diff — must be 0. */
  writesDetected: number;
  /** Compact human-readable rollup for the tool result / gate log. */
  summary: string;
}

function readScriptFrom(dir: string) {
  const root = path.resolve(dir);
  return (rel: string): string | null => {
    const resolved = path.resolve(dir, rel);
    if (!resolved.startsWith(root + path.sep)) return null;
    return fs.existsSync(resolved) ? fs.readFileSync(resolved, "utf8") : null;
  };
}

export async function runValidation(input: GateInput): Promise<GateResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  let lintFindings: LintFinding[] = [];
  let diffMarkdown: string | undefined;
  let writesDetected = 0;

  // 1. schema + semantics
  const v = validatePlan(input.planInput, { scopeKind: input.scopeKind });
  errors.push(...v.errors);
  warnings.push(...v.warnings);
  const order = v.order;

  // 2. lint (only when the plan parsed)
  if (v.ok && v.plan) {
    lintFindings = lintPlan(v.plan, readScriptFrom(input.scriptsDir));
    for (const f of lintFindings) {
      if (f.severity === "error") errors.push(`lint [${f.rule}] ${f.where}: ${f.message}`);
      else warnings.push(`lint [${f.rule}] ${f.where}: ${f.message}`);
    }
  }

  // 3. script typecheck (best-effort)
  const tc = await typecheckScripts(input.scriptsDir);
  for (const e of tc.errors) errors.push(`typecheck: ${e}`);

  // 4. dry-run diff (read-only) — only when the plan is otherwise clean + an instance is given
  if (errors.length === 0 && v.plan && input.instance) {
    const client = SnowClient.forInstance(input.instance);
    try {
      const diff = await dryRunDiff(v.plan, client);
      diffMarkdown = diff.markdown;
      if (!diff.ok) {
        for (const c of diff.perChange) for (const e of c.errors) errors.push(`diff [${c.id}]: ${e}`);
      }
    } finally {
      writesDetected = client.requestLog.filter((r) => r.method !== "GET").length;
      if (writesDetected > 0) {
        errors.push(`dry-run made ${writesDetected} non-GET request(s) — validate_plan must be read-only`);
      }
    }
  }

  const ok = errors.length === 0;
  const summary =
    (ok ? "✓ plan is valid" : `✗ ${errors.length} error(s)`) +
    (warnings.length ? ` · ${warnings.length} warning(s)` : "") +
    (order ? ` · apply order: ${order.join(" → ")}` : "");

  return { ok, errors, warnings, lintFindings, order, diffMarkdown, writesDetected, summary };
}
