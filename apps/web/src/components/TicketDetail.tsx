"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { TICKET_STATUS_META, ROLE_META, isTerminal } from "@/lib/ui";
import { parseQaVerdict } from "@/lib/pipeline/parse";
import type { TicketDetailJson } from "@/lib/types";
import { PipelineStrip } from "@/components/PipelineStrip";
import { ArtifactTabs } from "@/components/ArtifactTabs";
import { ReviewGate } from "@/components/ReviewGate";

const POLL_MS = 3000;

export function TicketDetail({
  initial,
  instanceLabel,
}: {
  initial: TicketDetailJson;
  instanceLabel: string;
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

  // Poll while the pipeline OR a deploy is in flight.
  const live = !isTerminal(ticket.status) || ticket.status === "DEPLOYING";
  useEffect(() => {
    if (!live) return;
    const h = setInterval(refetch, POLL_MS);
    return () => clearInterval(h);
  }, [live, refetch]);

  const meta = TICKET_STATUS_META[ticket.status];
  const failedStep = ticket.steps.find((s) => s.status === "FAILED");
  const qaArtifact = ticket.artifacts.find((a) => a.type === "QA_REPORT");
  const verdict = qaArtifact ? parseQaVerdict(qaArtifact.content) : null;
  const hasDeployLog = ticket.artifacts.some((a) => a.type === "DEPLOY_LOG");

  return (
    <>
      <p className="crumb">
        <Link href="/">← All requests</Link>
      </p>

      <header className="dtl-head">
        <div className="row1">
          <h1>{ticket.title}</h1>
          <span className={`pill ${meta.tone}${live ? " pulsing" : ""}`}>
            <span className="pdot" />
            {meta.label}
          </span>
        </div>
        <p className="req">“{ticket.description}”</p>
      </header>

      <PipelineStrip steps={ticket.steps} />

      {failedStep && (
        <div className="errcard">
          <div className="eh">{ROLE_META[failedStep.role].label} stage failed</div>
          <pre>{failedStep.error ?? "No error message recorded."}</pre>
        </div>
      )}

      {ticket.status === "DEPLOYING" && (
        <div className="deploybanner idle">
          <span className="pdot" /> Building and deploying to {instanceLabel}…
        </div>
      )}
      {ticket.status === "DEPLOYED" && (
        <div className="deploybanner ok">
          ✓ Deployed to {instanceLabel} — see the Deploy Verification tab.
        </div>
      )}
      {ticket.status === "FAILED" && hasDeployLog && (
        <div className="deploybanner crit">
          Deploy failed — see the Deploy Log tab.
        </div>
      )}
      {ticket.status === "REJECTED" && ticket.reviewNote && (
        <div className="notecard">
          <div className="eh">Rejected</div>
          <p>{ticket.reviewNote}</p>
        </div>
      )}

      {ticket.status === "READY_FOR_REVIEW" && (
        <ReviewGate ticketId={ticket.id} instanceLabel={instanceLabel} onChanged={refetch} />
      )}

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

      <ArtifactTabs artifacts={ticket.artifacts} steps={ticket.steps} running={live} />
    </>
  );
}
