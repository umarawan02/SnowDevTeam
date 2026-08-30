/**
 * Best-effort structural parse of the Developer's generated ServiceNow Fluent
 * code, so the run-detail page can draw a flow diagram of *what was built*.
 *
 * This reads the `=== FILE: … ===` blocks from the CODE artifact and pulls out
 * the catalog item, its variables, the fulfillment flow's trigger + ordered
 * actions, and any supporting records / custom tables. It is heuristic and
 * NEVER throws — an unrecognised shape just yields fewer nodes.
 */
import { parseGeneratedFiles } from "@/lib/pipeline/parse";

export interface FlowStep {
  id: string;
  label: string;
  kind: "trigger" | "action" | "approval" | "end";
  detail?: string;
}

export interface FlowVariable {
  name: string;
  label: string;
  type: string;
  mandatory: boolean;
}

export interface ParsedFlow {
  found: boolean;
  catalogItemName: string | null;
  flowName: string | null;
  steps: FlowStep[];
  variables: FlowVariable[];
  supportingRecords: { table: string; label: string }[];
  tables: string[];
  fileCount: number;
  warnings: string[];
}

const VAR_TYPE_LABEL: Record<string, string> = {
  RequestedForVariable: "Requested-for user",
  ReferenceVariable: "Reference",
  SelectBoxVariable: "Choice",
  MultiLineTextVariable: "Multi-line text",
  StringVariable: "Text",
  SingleLineTextVariable: "Text",
  CheckboxVariable: "Checkbox",
  DateVariable: "Date",
  DateTimeVariable: "Date / time",
  NumericScaleVariable: "Numeric scale",
  LookupSelectBoxVariable: "Lookup choice",
  MultipleChoiceVariable: "Multiple choice",
  ContainerStartVariable: "Container",
  LabelVariable: "Label",
};

const ACTION_LABEL: Record<string, { label: string; kind: FlowStep["kind"] }> = {
  getCatalogVariables: { label: "Get catalog variables", kind: "action" },
  askForApproval: { label: "Ask for approval", kind: "approval" },
  createCatalogTask: { label: "Create catalog task", kind: "action" },
  createTask: { label: "Create task", kind: "action" },
  createRecord: { label: "Create record", kind: "action" },
  updateRecord: { label: "Update record", kind: "action" },
  lookUpRecord: { label: "Look up record", kind: "action" },
  lookUpRecords: { label: "Look up records", kind: "action" },
  deleteRecord: { label: "Delete record", kind: "action" },
  sendNotification: { label: "Send notification", kind: "action" },
  sendEmail: { label: "Send email", kind: "action" },
  wait: { label: "Wait", kind: "action" },
  ifElse: { label: "Branch", kind: "action" },
  forEach: { label: "For each", kind: "action" },
  callSubflow: { label: "Call subflow", kind: "action" },
  restStep: { label: "REST step", kind: "action" },
  script: { label: "Run script", kind: "action" },
};

const TRIGGER_LABEL: { re: RegExp; label: string }[] = [
  { re: /trigger\.application\.serviceCatalog/, label: "Catalog item submitted" },
  { re: /trigger\.record\.(created|createdOrUpdated|updated)/, label: "Record created / updated" },
  { re: /trigger\.record\.created/, label: "Record created" },
  { re: /trigger\.schedule/, label: "Scheduled" },
  { re: /trigger\.(inbound|email)/, label: "Inbound email" },
];

function firstStringField(body: string, field: string): string | null {
  const m = body.match(new RegExp(`${field}\\s*:\\s*(['"\`])([^'"\`]+)\\1`));
  return m ? m[2].trim() : null;
}

export function parseGeneratedFlow(codeArtifact: string): ParsedFlow {
  const out: ParsedFlow = {
    found: false,
    catalogItemName: null,
    flowName: null,
    steps: [],
    variables: [],
    supportingRecords: [],
    tables: [],
    fileCount: 0,
    warnings: [],
  };

  const { files, warnings } = parseGeneratedFiles(codeArtifact ?? "");
  out.warnings = [...warnings];
  out.fileCount = files.length;
  if (files.length === 0) return out;

  for (const f of files) {
    const src = f.content;

    // --- catalog item + its variables ---
    if (/\bCatalogItem\s*\(/.test(src)) {
      out.catalogItemName ??= firstStringField(src, "name");
      const varBlock = src.match(/variables\s*:\s*\{([\s\S]*)\}\s*,?\s*\}\s*\)\s*;?\s*$/m);
      const scope = varBlock ? varBlock[1] : src;
      const varRe = /(\w+)\s*:\s*(\w*Variable)\s*\(\s*\{([\s\S]*?)\}\s*\)/g;
      let vm: RegExpExecArray | null;
      while ((vm = varRe.exec(scope)) !== null) {
        const [, name, ctor, vbody] = vm;
        if (out.variables.some((v) => v.name === name)) continue;
        out.variables.push({
          name,
          label: firstStringField(vbody, "question") ?? firstStringField(vbody, "label") ?? name,
          type: VAR_TYPE_LABEL[ctor] ?? ctor.replace(/Variable$/, ""),
          mandatory: /mandatory\s*:\s*true/.test(vbody),
        });
      }
    }

    // --- custom tables ---
    const tableRe = /\bTable\s*\(\s*\{[\s\S]*?name\s*:\s*(['"`])([a-z0-9_]+)\1/g;
    let tm: RegExpExecArray | null;
    while ((tm = tableRe.exec(src)) !== null) {
      if (!out.tables.includes(tm[2])) out.tables.push(tm[2]);
    }

    // --- supporting records (Record({ table, data:{ name|title } })) ---
    const recRe = /\bRecord\s*\(\s*\{[\s\S]*?table\s*:\s*(['"`])([a-z0-9_]+)\1[\s\S]*?\}\s*\)/g;
    let rm: RegExpExecArray | null;
    while ((rm = recRe.exec(src)) !== null) {
      const seg = rm[0];
      const label = firstStringField(seg, "name") ?? firstStringField(seg, "title") ?? rm[2];
      if (!out.supportingRecords.some((r) => r.table === rm![2] && r.label === label)) {
        out.supportingRecords.push({ table: rm[2], label });
      }
    }

    // --- the flow: trigger + ordered actions ---
    if (/\bFlow\s*\(/.test(src) && /wfa\.(trigger|action)\s*\(/.test(src)) {
      out.flowName ??= firstStringField(src, "name");
      const trig = TRIGGER_LABEL.find((t) => t.re.test(src));
      out.steps.push({
        id: "trigger",
        label: trig?.label ?? "Trigger",
        kind: "trigger",
      });
      const actRe = /action\.[a-zA-Z0-9_]+\.([a-zA-Z0-9_]+)/g;
      let am: RegExpExecArray | null;
      let i = 0;
      while ((am = actRe.exec(src)) !== null) {
        const key = am[1];
        const meta = ACTION_LABEL[key] ?? { label: humanize(key), kind: "action" as const };
        out.steps.push({ id: `a${i++}`, label: meta.label, kind: meta.kind });
      }
      out.steps.push({ id: "end", label: "Flow complete", kind: "end" });
    }
  }

  out.found = out.steps.length > 0 || out.variables.length > 0 || out.catalogItemName != null;
  if (!out.found) out.warnings.push("Could not derive a flow shape from the generated code.");
  return out;
}

function humanize(s: string): string {
  return s
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^./, (c) => c.toUpperCase());
}
