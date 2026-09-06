/**
 * Validate a native-engine change plan (NATIVE_ENGINE_BRIEF Phase 4).
 *
 *   pnpm --filter web validate-plan <planFile.json> [<instanceId>]
 *
 * Runs, in order:
 *   1. validatePlan  — zod schema + semantic checks (table allow-list, no
 *      literal sys_ids, $ref graph, apply order).
 *   2. lintPlan      — the quality gate (heuristic checks on every script body).
 *   3. typecheckScripts — best-effort `tsc --checkJs` over the plan's *.js files.
 *   4. dryRunDiff    — only with an <instanceId>: a read-only field-level diff
 *      against that PDI. Writes nothing (asserted via client.requestLog).
 *
 * Exit code is non-zero on any error (warnings do not fail the run).
 */
import "@/lib/config";
import fs from "node:fs";
import path from "node:path";
import { prisma } from "@/lib/db";
import { SnowClient } from "@/lib/servicenow/client";
import { validatePlan } from "@/lib/nativeengine/plan";
import { lintPlan, type LintFinding } from "@/lib/nativeengine/lint";
import { typecheckScripts } from "@/lib/nativeengine/scripts";
import { dryRunDiff } from "@/lib/nativeengine/diff";

function hr() {
  console.log("─".repeat(70));
}

function printFindings(findings: LintFinding[]): { errors: number; warnings: number } {
  let errors = 0;
  let warnings = 0;
  for (const f of findings) {
    if (f.severity === "error") errors++;
    else warnings++;
    const tag = f.severity === "error" ? "✗ ERROR" : "• warn ";
    console.log(`  ${tag}  [${f.rule}] ${f.where}: ${f.message}`);
  }
  return { errors, warnings };
}

async function main() {
  const planFile = process.argv[2];
  const instanceId = process.argv[3];
  if (!planFile) throw new Error("usage: validate-plan <planFile.json> [<instanceId>]");

  const abs = path.resolve(planFile);
  const dir = path.dirname(abs);
  const raw = JSON.parse(fs.readFileSync(abs, "utf8")) as unknown;
  const readScript = (rel: string): string | null => {
    const resolved = path.resolve(dir, rel);
    if (!resolved.startsWith(dir + path.sep)) return null;
    return fs.existsSync(resolved) ? fs.readFileSync(resolved, "utf8") : null;
  };

  let hardErrors = 0;

  // 1. schema + semantic --------------------------------------------------
  hr();
  console.log(`1. Schema & semantics — ${path.basename(abs)}`);
  hr();
  const result = validatePlan(raw);
  for (const e of result.errors) console.log(`  ✗ ERROR  ${e}`);
  for (const w of result.warnings) console.log(`  • warn   ${w}`);
  hardErrors += result.errors.length;
  if (result.ok && result.order) {
    console.log(`  ✓ schema OK — ${result.plan!.changes.length} change(s)`);
    console.log(`  apply order: ${result.order.join(" → ")}`);
  }

  // 2. lint -------------------------------------------------------------------
  hr();
  console.log("2. Script lint (quality gate)");
  hr();
  if (result.plan) {
    const findings = lintPlan(result.plan, readScript);
    if (findings.length === 0) console.log("  ✓ lint clean");
    const { errors } = printFindings(findings);
    hardErrors += errors;
  } else {
    console.log("  — skipped (plan did not pass schema validation)");
  }

  // 3. script typecheck -----------------------------------------------------
  hr();
  console.log("3. Script typecheck (tsc --checkJs, best-effort)");
  hr();
  {
    const { errors } = await typecheckScripts(dir);
    if (errors.length === 0) console.log("  ✓ no type errors");
    for (const e of errors) console.log(`  ✗ ${e}`);
    hardErrors += errors.length;
  }

  // 4. dry-run diff -------------------------------------------------------
  if (instanceId) {
    hr();
    console.log(`4. Dry-run diff against instance ${instanceId} (read-only)`);
    hr();
    if (result.plan) {
      const instance = await prisma.instance.findUniqueOrThrow({ where: { id: instanceId } });
      // Use the deploy credential (not the read-only one) so the preview sees
      // exactly what Phase 5's apply will see — the read-only service user
      // can't read ACL-restricted tables (sys_script_include, sys_atf_*), which
      // would make the diff wrongly report "create" for records that exist.
      // Safety is enforced below: every request in this run must be a GET.
      const client = SnowClient.forInstance(instance);
      const diff = await dryRunDiff(result.plan, client);
      console.log(diff.markdown);
      hr();
      const writes = client.requestLog.filter((r) => r.method !== "GET");
      console.log(`requests: ${client.requestLog.length} (${writes.length} non-GET)`);
      if (writes.length > 0) {
        console.log("  ✗ ERROR  dry-run made non-GET requests — this must never happen");
        for (const w of writes) console.log(`    ${w.method} ${w.path}`);
        hardErrors += writes.length;
      } else {
        console.log("  ✓ zero writes");
      }
      if (!diff.ok) {
        console.log("  ✗ diff reported unresolved lookups / errors (see above)");
        hardErrors += 1;
      }
    } else {
      console.log("  — skipped (plan did not pass schema validation)");
    }
  } else {
    hr();
    console.log("4. Dry-run diff — skipped (no <instanceId> given)");
    hr();
  }

  hr();
  console.log(hardErrors === 0 ? "RESULT: PASS" : `RESULT: FAIL — ${hardErrors} error(s)`);
  hr();
  await prisma.$disconnect().catch(() => {});
  process.exit(hardErrors === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error("\nVALIDATE-PLAN CRASHED:", e instanceof Error ? (e.stack ?? e.message) : e);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
