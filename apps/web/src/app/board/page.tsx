import { listTickets } from "@/lib/tickets";
import { getPersonas } from "@/lib/agents/personas";
import { BOARD_COLUMNS, columnForTicket, type BoardColumnId } from "@/lib/board";
import { StoryCard } from "@/components/board/StoryCard";
import type { TicketListItemJson, PersonaJson } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function BoardPage() {
  const [tickets, personas] = await Promise.all([listTickets(), getPersonas()]);

  const personaByRole = Object.fromEntries(
    personas.map((p) => [p.role, p as unknown as PersonaJson]),
  ) as Record<string, PersonaJson>;

  const buckets: Record<BoardColumnId, TicketListItemJson[]> = {
    INTAKE: [], ANALYSIS: [], BUILD: [], QA: [], REVIEW: [], DEPLOYING: [], DONE: [], BLOCKED: [],
  };
  for (const t of tickets as unknown as TicketListItemJson[]) {
    buckets[columnForTicket(t.status, t.steps)].push(t);
  }

  // Always show the pipeline spine; only show Deploying / Blocked when populated.
  const SPINE = new Set(["INTAKE", "ANALYSIS", "BUILD", "QA", "REVIEW", "DONE"]);
  const active = BOARD_COLUMNS.filter((c) => SPINE.has(c.id) || buckets[c.id].length > 0);

  return (
    <div className="page-wide">
      <div className="pagehead">
        <div className="grow">
          <h1 className="h1">Story board</h1>
          <p className="lede">
            Every request as it moves through the pipeline. Columns are driven by the
            run — the board updates itself.
          </p>
        </div>
      </div>

      {tickets.length === 0 ? (
        <div className="glass panel" style={{ textAlign: "center", padding: "44px 20px", color: "var(--ink-faint)" }}>
          No requests yet. Start one from <b style={{ color: "var(--ink-soft)" }}>Intake</b>.
        </div>
      ) : (
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
      )}
    </div>
  );
}
