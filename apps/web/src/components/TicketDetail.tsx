"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ticketStatusMeta, roleMeta, isTerminal, relativeTime } from "@/lib/ui";
import { parseQaVerdict } from "@/lib/pipeline/parse";
import type { TicketDetailJson, PersonaJson } from "@/lib/types";
import { PipelineFlow } from "@/components/ticket/PipelineFlow";
import { BuiltFlowDiagram } from "@/components/ticket/BuiltFlowDiagram";
import { ArtifactTabs } from "@/components/ArtifactTabs";
import { ReviewGate } from "@/components/ReviewGate";

const POLL_MS = 3000;

export function TicketDetail({
  initial,
  instanceLabel,
  personas,
  canReview,
}: {
  initial: TicketDetailJson;
  instanceLabel: string;
  personas: Record<string, PersonaJson>;
  canReview: boolean;
}) {
  const [ticket, setTicket] = useState<TicketDetailJson>(initial);

  const refetch = useCallback(async () => {
    try {
      const res = await fetch(`/api/tickets/${initial.id}`, { cache: "no-store" });
      if (!res.ok) return;
      const { ticket: fresh } = (await res.json()) as { ticket: TicketDetailJson };
      setTicket(fresh);
    } catch {
      /* transient — ignore */
    }
  }, [initial.id]);

  const live = !isTerminal(ticket.status) || ticket.status === "DEPLOYING";
  useEffect(() => {
    if (!live) return;
    const h = setInterval(refetch, POLL_MS);
    return () => clearInterval(h);
  }, [live, refetch]);

  const meta = ticketStatusMeta(ticket.status);
  const failedStep = ticket.steps.find((s) => s.status === "FAILED");
  const qaArtifact = ticket.artifacts.find((a) => a.type === "QA_REPORT");
  const verdict = qaArtifact ? parseQaVerdict(qaArtifact.content) : null;
  const codeArtifact = ticket.artifacts.find((a) => a.type === "CODE");
  const hasDeployLog = ticket.artifacts.some((a) => a.type === "DEPLOY_LOG");

  return (
    <div className="page tdetail">
      <p className="crumb">
        <Link href="/board">← Story board</Link>
      </p>

      <header className="td-head">
        <div className="td-title">
          <h1>{ticket.title}</h1>
          <span className={`pill ${meta.tone}${live ? " pulsing" : ""}`}>
            <span className="pdot" />
            {meta.label}
          </span>
        </div>
        <div className="td-meta">
          {ticket.priority && <span className="chip">{cap(ticket.priority)} priority</span>}
          {ticket.requester && <span className="chip">Requested by {ticket.requester}</span>}
          {ticket.category && <span className="chip">{ticket.category}</span>}
          <span className="chip idle">Opened {relativeTime(ticket.createdAt)}</span>
        </div>
        <p className="td-req">&ldquo;{ticket.description}&rdquo;</p>
      </header>

      <section className="glass panel td-pipeline">
        <header>
          <h3>Pipeline</h3>
          <span className="hint">BA → Architect → Senior Dev → Developer → QA</span>
        </header>
        <PipelineFlow steps={ticket.steps} personas={personas} />
      </section>

      {failedStep && (
        <div className="errcard">
          <div className="eh">{roleMeta(failedStep.role).label} stage failed</div>
          <pre>{failedStep.error ?? "No error message recorded."}</pre>
        </div>
      )}

      {ticket.status === "DEPLOYING" && (
        <div className="deploybanner idle">
          <span className="pdot" /> Building and deploying to {instanceLabel}…
        </div>
      )}
      {ticket.status === "DEPLOYED" && (
        <div className="deploybanner ok">✓ Deployed to {instanceLabel} — see the Deploy Verification tab.</div>
      )}
      {ticket.status === "FAILED" && hasDeployLog && (
        <div className="deploybanner crit">Deploy failed — see the Deploy Log tab.</div>
      )}
      {ticket.status === "REJECTED" && ticket.reviewNote && (
        <div className="notecard">
          <div className="eh">Rejected</div>
          <p>{ticket.reviewNote}</p>
        </div>
      )}

      {ticket.status === "READY_FOR_REVIEW" &&
        (canReview ? (
          <ReviewGate ticketId={ticket.id} instanceLabel={instanceLabel} onChanged={refetch} />
        ) : (
          <div className="gate gate-locked">
            <div className="gate-head">
              <strong>Waiting on a reviewer</strong>
              <span>
                This run is ready for review. Only reviewers and admins can approve or reject —
                ask an admin to grant you the Reviewer role.
              </span>
            </div>
          </div>
        ))}

      {verdict && (
        <div className={`verdict ${verdict === "READY_FOR_HUMAN_REVIEW" ? "ready" : "rework"}`}>
          <span className="vlbl">QA verdict</span>
          <span className="vval">
            {verdict === "READY_FOR_HUMAN_REVIEW" ? "Ready for human review" : "Needs rework"}
          </span>
        </div>
      )}
      {qaArtifact && !verdict && (
        <div className="verdict unknown">
          <span className="vlbl">QA verdict</span>
          <span className="vval">Could not parse — see the QA Report tab</span>
        </div>
      )}

      {codeArtifact && (
        <section className="glass panel td-built">
          <header>
            <h3>What gets built</h3>
            <span className="hint">catalog item + fulfillment flow</span>
          </header>
          <BuiltFlowDiagram code={codeArtifact.content} />
        </section>
      )}

      <ArtifactTabs artifacts={ticket.artifacts} steps={ticket.steps} running={live} />
    </div>
  );
}

function cap(s: string) {
  return s.charAt(0) + s.slice(1).toLowerCase();
}
