/**
 * Open item #5 — 403 / prefix behaviour for `sys_dictionary` field creation via
 * Table API. **Detect-only** (per the plan): inspect ACLs, properties and
 * recent custom fields; no field is created.
 *
 *   pnpm --filter web tsx scripts/smoke-dictionary.mts <instanceId>
 */
import "@/lib/config";
import { prisma } from "@/lib/db";
import { SnowClient } from "@/lib/servicenow/client";
import { printVerdict } from "@/lib/servicenow/smoke";

async function main() {
  const id = process.argv[2];
  if (!id) throw new Error("usage: smoke-dictionary <instanceId>");
  const instance = await prisma.instance.findUniqueOrThrow({ where: { id } });
  const client = SnowClient.forInstance(instance);

  const acls = await client.table.list<{ name: string; operation: string; admin_overrides: string; active: string }>(
    "sys_security_acl",
    { query: "nameINsys_dictionary,sys_dictionary.*^operationINcreate,write", fields: "name,operation,admin_overrides,active", limit: 50 },
  );
  const props = await client.table.list<{ name: string; value: string }>("sys_properties", {
    query: "nameLIKEdictionary^ORnameLIKEschema_change",
    fields: "name,value",
    limit: 30,
  });
  const recentFields = await client.table.list<{ name: string; element: string; sys_created_by: string; sys_created_on: string }>(
    "sys_dictionary",
    {
      query: "elementSTARTSWITHu_^sys_created_by!=system^ORDERBYDESCsys_created_on",
      fields: "name,element,sys_created_by,sys_created_on",
      limit: 8,
    },
  );

  printVerdict({
    name: "dictionary write viability (detect-only)",
    openItem: "open item #5",
    status: "INCONCLUSIVE",
    finding: "collected evidence; the definitive create-then-delete test is deferred to a hands-on run",
    detail:
      `create/write ACLs on sys_dictionary: ${acls.length ? acls.map((a) => `${a.name}:${a.operation}(active=${a.active})`).join(", ") : "none listed"}\n` +
      `        relevant properties: ${props.length ? props.map((p) => `${p.name}=${p.value}`).join(", ") : "none"}\n` +
      `        recent u_ fields (created via UI/API): ${recentFields.length ? recentFields.map((f) => `${f.name}.${f.element} by ${f.sys_created_by}`).join("; ") : "none — table/field creation likely restricted to Fluent/UI"}`,
    action:
      "Phase 4 schema route: prefer Fluent tier or human for table/field creation. If Table API turns out viable, add sys_dictionary (fields on existing tables only) to the allow-list flagged high-risk.",
  });

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error("SMOKE FAILED:", e instanceof Error ? (e.stack ?? e.message) : e);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
