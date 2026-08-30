"use client";

import { useEffect, useState } from "react";
import { BOARD_COLUMNS, columnForTicket, type BoardColumnId } from "@/lib/board";
import { StoryCard } from "@/components/board/StoryCard";
import type { TicketListItemJson, PersonaJson } from "@/lib/types";

const POLL_MS = 4000;
const SPINE = new Set<BoardColumnId>(["INTAKE", "ANALYSIS", "BUILD", "QA", "REVIEW", "DONE"]);

function bucketize(tickets: TicketListItemJson[]) {
  const b: Record<BoardColumnId, TicketListItemJson[]> = {
    INTAKE: [], ANALYSIS: [], BUILD: [], QA: [], REVIEW: [], DEPLOYING: [], DONE: [], BLOCKED: [],
  };
  for (const t of tickets) b[columnForTicket(t.status, t.steps)].push(t);
  return b;
}

export function BoardLive({
  initialTickets,
  personaByRole,
}: {
  initialTickets: TicketListItemJson[];
  personaByRole: Record<string, PersonaJson>;
}) {
  const [tickets, setTickets] = useState(initialTickets);

  useEffect(() => {
    let stop = false;
    const anyLive = tickets.some(
      (t) => !["DEPLOYED", "REJECTED", "FAILED", "READY_FOR_REVIEW"].includes(t.status),
    );
    if (!anyLive) return;
    const h = setInterval(async () => {
      try {
        const res = await fetch("/api/tickets", { cache: "no-store" });
        if (!res.ok || stop) return;
        const { tickets: fresh } = (await res.json()) as { tickets: TicketListItemJson[] };
        setTickets(fresh);
      } catch {
        /* transient */
      }
    }, POLL_MS);
    return () => {
      stop = true;
      clearInterval(h);
    };
  }, [tickets]);

  const buckets = bucketize(tickets);
  const active = BOARD_COLUMNS.filter((c) => SPINE.has(c.id) || buckets[c.id].length > 0);

  if (tickets.length === 0) {
    return (
      <div className="glass panel" style={{ textAlign: "center", padding: "44px 20px", color: "var(--ink-faint)" }}>
        No requests yet. Start one from <b style={{ color: "var(--ink-soft)" }}>Intake</b>.
      </div>
    );
  }

  return (
    <div className="board">
      {active.map((col) => {
        const items = buckets[col.id];
        if (items.length === 0) {
          return (
            <div className="bcol collapsed" key={col.id} title={`${col.label} — empty`}>
              <span className="vlabel">{col.label}</span>
              <span className="ct">0</span>
            </div>
          );
        }
        return (
          <div className="bcol" key={col.id}>
            <div className="ch">
              <span className="nm">{col.label}</span>
              <span className="ct">{items.length}</span>
              <span className="hint">{col.hint}</span>
            </div>
            <div className="drop">
              {items.map((t) => (
                <StoryCard key={t.id} ticket={t} personaByRole={personaByRole} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
