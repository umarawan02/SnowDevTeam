"use client";

import { useMemo } from "react";
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Handle,
  Position,
  type Node,
  type Edge,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { parseGeneratedFlow, type ParsedFlow, type FlowStep } from "@/lib/flow/parse";

type StepData = { label: string; kind: FlowStep["kind"]; index: number };

const KIND_ICON: Record<FlowStep["kind"], string> = {
  trigger: "▶",
  action: "•",
  approval: "✔",
  end: "■",
};

function StepNode({ data }: NodeProps<Node<StepData>>) {
  return (
    <div className={`bf-node ${data.kind}`}>
      <Handle type="target" position={Position.Top} isConnectable={false} />
      <span className="bf-ic">{KIND_ICON[data.kind]}</span>
      <span className="bf-lbl">{data.label}</span>
      <Handle type="source" position={Position.Bottom} isConnectable={false} />
    </div>
  );
}
const nodeTypes = { step: StepNode };

export function BuiltFlowDiagram({ code, targetScope }: { code: string; targetScope?: string }) {
  const parsed: ParsedFlow = useMemo(() => parseGeneratedFlow(code), [code]);

  const { nodes, edges } = useMemo(() => {
    const nodes: Node<StepData>[] = parsed.steps.map((s, i) => ({
      id: s.id,
      type: "step",
      position: { x: 0, y: i * 92 },
      data: { label: s.label, kind: s.kind, index: i },
    }));
    const edges: Edge[] = parsed.steps.slice(1).map((s, i) => ({
      id: `${parsed.steps[i].id}-${s.id}`,
      source: parsed.steps[i].id,
      target: s.id,
      style: { stroke: "var(--border-strong)", strokeWidth: 1.5 },
    }));
    return { nodes, edges };
  }, [parsed]);

  if (!parsed.found) {
    return (
      <div className="bf-empty glass">
        Couldn&rsquo;t derive a flow diagram from the generated code — see the Code tab for the
        raw files.
      </div>
    );
  }

  return (
    <div className="bf">
      <div className="bf-canvas">
        <div className="bf-cap">
          Design intent — parsed from {parsed.fileCount} generated file{parsed.fileCount === 1 ? "" : "s"}
        </div>
        <div className="bf-rf">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            fitView
            fitViewOptions={{ padding: 0.16 }}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable={false}
            zoomOnScroll={false}
            zoomOnDoubleClick={false}
            preventScrolling={false}
          >
            <Background variant={BackgroundVariant.Dots} gap={18} size={1} />
          </ReactFlow>
        </div>
      </div>

      <aside className="bf-side">
        <div className="bf-block">
          <h4>Target scope</h4>
          <p className="bf-name-row">{targetScope === "scoped" ? "Scoped app" : "Global"}</p>
        </div>
        {parsed.catalogItemName && (
          <div className="bf-block">
            <h4>Catalog item</h4>
            <p className="bf-name-row">{parsed.catalogItemName}</p>
          </div>
        )}
        {parsed.variables.length > 0 && (
          <div className="bf-block">
            <h4>Form fields ({parsed.variables.length})</h4>
            <ul className="bf-list">
              {parsed.variables.map((v) => (
                <li key={v.name}>
                  <span className="bf-v-label">{v.label}</span>
                  <span className="bf-v-meta">
                    {v.type}
                    {v.mandatory && <b> · required</b>}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {parsed.supportingRecords.length > 0 && (
          <div className="bf-block">
            <h4>Supporting records</h4>
            <ul className="bf-list">
              {parsed.supportingRecords.map((r, i) => (
                <li key={i}>
                  <span className="bf-v-label">{r.label}</span>
                  <span className="bf-v-meta mono">{r.table}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {parsed.tables.length > 0 && (
          <div className="bf-block">
            <h4>Custom tables</h4>
            <ul className="bf-list">
              {parsed.tables.map((t) => (
                <li key={t}>
                  <span className="bf-v-label mono">{t}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </aside>
    </div>
  );
}
