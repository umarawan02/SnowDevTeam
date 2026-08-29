import { AGENT_ROLES } from "@/lib/constants";
import { ROLE_META, stepStatusMeta, durationLabel } from "@/lib/ui";
import type { StepJson } from "@/lib/types";

/** Five-stage progress strip: one node per pipeline role, in order. */
export function PipelineStrip({ steps }: { steps: StepJson[] }) {
  const byRole = new Map(steps.map((s) => [s.role, s]));

  return (
    <div className="pipe">
      {AGENT_ROLES.map((role, idx) => {
        const step = byRole.get(role);
        const meta = stepStatusMeta(step?.status ?? "PENDING");
        const dur = durationLabel(step?.startedAt, step?.completedAt);
        return (
          <div className="pnode" key={role}>
            <div className="pn">Stage {idx + 1}</div>
            <div className="pr">{ROLE_META[role].label}</div>
            <div className="ps">
              <span className={`pdot ${meta.tone}`} />
              {meta.label}
              {dur && <span className="dur">{dur}</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
