/**
 * Negative-case checks for the native-engine validator (NATIVE_ENGINE_BRIEF
 * Phase 4 verification). No test runner in this package yet — this is a
 * self-contained assert script.
 *
 *   pnpm --filter web validate-plan-negatives
 *
 * Each case feeds a deliberately bad plan / script through validatePlan or
 * lintScript and asserts the expected rule fires. Exit non-zero on any miss.
 */
import "@/lib/config";
import { validatePlan } from "@/lib/nativeengine/plan";
import { lintScript } from "@/lib/nativeengine/lint";

const HEX32 = "0".repeat(32);

interface Case {
  name: string;
  run: () => { hit: boolean; detail: string };
}

const base = (changes: unknown[]) => ({ scope: "global", updateSetName: "SDT-x test", changes });

const cases: Case[] = [
  {
    name: 'op:"delete" is rejected',
    run: () => {
      const r = validatePlan(
        base([{ id: "a", table: "sc_cat_item", op: "delete", fields: { name: "x", short_description: "y" }, reason: "delete not allowed" }]),
      );
      return {
        hit: !r.ok && r.errors.some((e) => /\bop\b/i.test(e) && /insert|update|delete/i.test(e)),
        detail: r.errors.join(" | "),
      };
    },
  },
  {
    name: "literal 32-hex sys_id in a field is rejected",
    run: () => {
      const r = validatePlan(
        base([
          {
            id: "a",
            table: "sc_cat_item",
            op: "insert",
            fields: { name: "x", short_description: "y", category: HEX32 },
            reason: "hard-coded id",
          },
        ]),
      );
      return { hit: !r.ok && r.errors.some((e) => /literal 32-hex sys_id/i.test(e)), detail: r.errors.join(" | ") };
    },
  },
  {
    name: "sys_hub_flow is denied with the flow-tier route",
    run: () => {
      const r = validatePlan(base([{ id: "a", table: "sys_hub_flow", op: "insert", fields: { name: "x" }, reason: "flow" }]));
      return { hit: !r.ok && r.errors.some((e) => /flow tier/i.test(e)), detail: r.errors.join(" | ") };
    },
  },
  {
    name: "$ref cycle is detected",
    run: () => {
      const r = validatePlan(
        base([
          { id: "a", table: "sc_cat_item", op: "insert", fields: { name: "x", short_description: "y", u_link: { $ref: "b" } }, reason: "first of the cycle" },
          { id: "b", table: "sc_cat_item", op: "insert", fields: { name: "z", short_description: "w", u_link: { $ref: "a" } }, reason: "second of the cycle" },
        ]),
      );
      return { hit: !r.ok && r.errors.some((e) => /cycle/i.test(e)), detail: r.errors.join(" | ") };
    },
  },
  {
    name: "gs.log in a script body is a lint error",
    run: () => {
      const findings = lintScript("(function executeRule(current, previous){ gs.log('hi'); })(current, previous);", {
        where: "t",
        scriptField: "script",
        table: "sys_script",
        when: "after",
      });
      return {
        hit: findings.some((f) => f.severity === "error" && f.rule === "no-gs-log"),
        detail: findings.map((f) => `${f.severity}:${f.rule}`).join(" | "),
      };
    },
  },
  {
    name: "unknown table routes to the Fluent tier / a human",
    run: () => {
      const r = validatePlan(base([{ id: "a", table: "u_made_up_table", op: "insert", fields: { name: "x" }, reason: "made-up table" }]));
      return { hit: !r.ok && r.errors.some((e) => /allow-list|Fluent tier or a human/i.test(e)), detail: r.errors.join(" | ") };
    },
  },
];

let failures = 0;
for (const c of cases) {
  const { hit, detail } = c.run();
  console.log(`${hit ? "✓" : "✗"}  ${c.name}`);
  if (!hit) {
    failures++;
    console.log(`     got: ${detail || "(no errors)"}`);
  }
}

console.log("");
console.log(failures === 0 ? "RESULT: PASS" : `RESULT: FAIL — ${failures} case(s) missed`);
process.exit(failures === 0 ? 0 : 1);
