"use client";

import { useMemo } from "react";
import {
  ReactFlow,
  Handle,
  Position,
  type Node,
  type Edge,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { AGENT_ROLES } from "@/lib/constants";
import { roleMeta, stepStatusMeta, durationLabel } from "@/lib/ui";
import { PersonaAvatar } from "@/components/PersonaAvatar";
import type { StepJson, PersonaJson } from "@/lib/types";

type StageData = {
  roleLabel: string;
  personaName: string;
  accent: string;
  seed: string;
  statusLabel: string;
  tone: string;
  duration: string;
  running: boolean;
};

function StageNode({ data }: NodeProps<Node<StageData>>) {
  return (
    <div className={`pf-node ${data.tone}${data.running ? " running" : ""}`}>
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <div className="pf-top">
        <PersonaAvatar name={data.personaName} accent={data.accent} seed={data.seed} size={26} />
        <div className="pf-id">
          <span className="pf-role">{data.roleLabel}</span>
          <span className="pf-name">{data.personaName}</span>
        </div>
      </div>
      <div className="pf-foot">
        <span className={`pf-dot ${data.tone}`} />
        {data.statusLabel}
        {data.duration && <span className="pf-dur">{data.duration}</span>}
      </div>
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </div>
  );
}

const nodeTypes = { stage: StageNode };

export function PipelineFlow({
  steps,
  personas,
}: {
  steps: StepJson[];
  personas: Record<string, PersonaJson>;
}) {
  const { nodes, edges } = useMemo(() => {
    const byRole = new Map(steps.map((s) => [s.role, s]));
    const nodes: Node<StageData>[] = AGENT_ROLES.map((role, i) => {
      const step = byRole.get(role);
      const meta = stepStatusMeta(step?.status ?? "PENDING");
      const p = personas[role];
      return {
        id: role,
        type: "stage",
        position: { x: i * 234, y: 0 },
        data: {
          roleLabel: roleMeta(role).label,
          personaName: p?.name ?? roleMeta(role).label,
          accent: p?.accent ?? "#64748b",
          seed: p?.avatarSeed ?? role,
          statusLabel: meta.label,
          tone: meta.tone,
          duration: durationLabel(step?.startedAt, step?.completedAt),
          running: step?.status === "RUNNING",
        },
      };
    });

    const edges: Edge[] = AGENT_ROLES.slice(1).map((role, i) => {
      const prev = byRole.get(AGENT_ROLES[i]);
      const active = prev?.status === "COMPLETE" && byRole.get(role)?.status === "RUNNING";
      return {
        id: `${AGENT_ROLES[i]}-${role}`,
        source: AGENT_ROLES[i],
        target: role,
        animated: active,
        style: {
          stroke: prev?.status === "COMPLETE" ? "var(--accent)" : "var(--border-strong)",
          strokeWidth: 1.5,
        },
      };
    });

    return { nodes, edges };
  }, [steps, personas]);

  return (
    <div className="pf-wrap">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.12 }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        panOnDrag
        zoomOnScroll={false}
        zoomOnPinch={false}
        zoomOnDoubleClick={false}
        preventScrolling={false}
      />
    </div>
  );
}
