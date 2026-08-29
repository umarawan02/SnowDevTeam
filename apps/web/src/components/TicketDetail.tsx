"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { TICKET_STATUS_META, ROLE_META, isTerminal } from "@/lib/ui";
import { parseQaVerdict } from "@/lib/pipeline/parse";
import type { TicketDetailJson } from "@/lib/types";
import { PipelineStrip } from "@/components/PipelineStrip";
import { ArtifactTabs } from "@/components/ArtifactTabs";

const POLL_MS = 3000;

export function TicketDetail({ initial }: { initial: TicketDetailJson }) {
  const [ticket, setTicket] = useState<TicketDetailJson>(initial);

  useEffect(() => {
    if (isTerminal(ticket.status)) return;
    let alive = true;
    const tick = async () => {
      try {
        const res = await fetch(`/api/tickets/${ticket.id}`, { cache: "no-store" });
        if (!res.ok) return;
        const { ticket: fresh } = (await res.json()) as { ticket: TicketDetailJson };
        if (alive) setTicket(fresh);
      } catch {
        /* transient network error — keep polling */
      }
    };
    const h = setInterval(tick, POLL_MS);
    return () => {
      alive = false;
      clearInterval(h);
    };
  }, [ticket.id, ticket.status]);

  const running = !isTerminal(ticket.status);
  const meta = TICKET_STATUS_META[ticket.status];
  const failedStep = ticket.steps.find((s) => s.status === "FAILED");
  const qaArtifact = ticket.artifacts.find((a) => a.type === "QA_REPORT");
  const verdict = qaArtifact ? parseQaVerdict(qaArtifact.content) : null;

  return (
    <>
      <p className="crumb">
        <Link href="/">← All requests</Link>
      </p>

      <header className="dtl-head">
        <div className="row1">
          <h1>{ticket.title}</h1>
          <span className={`pill ${meta.tone}${running ? " pulsing" : ""}`}>
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

      <ArtifactTabs artifacts={ticket.artifacts} steps={ticket.steps} running={running} />
    </>
  );
}
