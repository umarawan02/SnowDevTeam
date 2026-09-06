import { updateSetName } from "@/lib/servicenow/updateset";
import { isNativeTier } from "@/lib/pipeline/route";

/**
 * The `{{PROJECT_CONTEXT}}` block (NATIVE_ENGINE_BRIEF §7.3) — a runtime,
 * per-ticket header injected into every grounded agent prompt so the prompt
 * files carry no instance-specific identifiers. `resolveAgent` interpolates it.
 */

export interface ProjectContextTicket {
  id: string;
  title: string;
  executionTier: string | null;
  tierRationale: string | null;
  routeScope: string | null;
  customer: { name: string } | null;
  instance: { name: string; url: string; env: string; releaseName: string | null } | null;
}

export function buildProjectContext(ticket: ProjectContextTicket): string {
  const scope = ticket.routeScope || "global";
  const native = isNativeTier(ticket.executionTier);
  const inst = ticket.instance;

  const lines: string[] = ["## Project context", ""];
  lines.push(`- Customer: ${ticket.customer?.name ?? "(unassigned)"}`);
  lines.push(
    inst
      ? `- Instance: ${inst.name} — ${inst.url} · env ${inst.env}${inst.releaseName ? ` · release ${inst.releaseName}` : ""}`
      : `- Instance: (none attached)`,
  );
  lines.push(`- Route: ${ticket.executionTier ?? "(unset)"}${ticket.tierRationale ? ` — ${ticket.tierRationale}` : ""}`);
  if (scope === "global") {
    lines.push(`- Scope: global — plain platform-wide records, no application prefix`);
  } else {
    lines.push(`- Scope: ${scope} — every net-new table/field carries the \`${scope}_\` prefix`);
  }
  if (native) {
    lines.push(`- Update set: \`${updateSetName(ticket.id.slice(-6), ticket.title)}\` (created at apply time — do not create it yourself)`);
  }
  lines.push(`- Reused OOB records: none recorded yet — use \`query\` to find existing catalogs / groups / flows to reference by query.`);
  lines.push("");
  return lines.join("\n");
}
