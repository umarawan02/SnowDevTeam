import Link from "next/link";
import { AGENT_ROLES } from "@/lib/constants";
import { ticketStatusMeta, relativeTime } from "@/lib/ui";
import { PersonaAvatar } from "@/components/PersonaAvatar";
import type { TicketListItemJson, PersonaJson } from "@/lib/types";

export function StoryCard({
  ticket,
  personaByRole,
}: {
  ticket: TicketListItemJson;
  personaByRole: Record<string, PersonaJson>;
}) {
  const meta = ticketStatusMeta(ticket.status);
  const touched = AGENT_ROLES.filter((r) =>
    ticket.steps.some((s) => s.role === r && (s.status === "COMPLETE" || s.status === "RUNNING")),
  );

  return (
    <Link href={`/tickets/${ticket.id}`} className="card storycard">
      <div className="st-t">{ticket.title}</div>

      <div className="st-meta">
        {ticket.priority && (
          <span className="chip">
            <span className={`prio ${ticket.priority}`} />
            {ticket.priority[0] + ticket.priority.slice(1).toLowerCase()}
          </span>
        )}
        {ticket.requester && <span className="chip">{ticket.requester}</span>}
        {ticket.reworkRound > 0 && <span className="chip warn">rework ×{ticket.reworkRound}</span>}
        <span className={`chip ${meta.tone}`}>{meta.label}</span>
      </div>

      <div className="minipipe" aria-hidden>
        {AGENT_ROLES.map((role) => {
          const s = ticket.steps.find((x) => x.role === role);
          const cls =
            s?.status === "COMPLETE"
              ? "ok"
              : s?.status === "FAILED"
                ? "crit"
                : s?.status === "RUNNING"
                  ? "run"
                  : "";
          return <span key={role} className={`minidot ${cls}`} />;
        })}
      </div>

      <div className="st-foot">
        <span className="who">
          {touched.map((r) => {
            const p = personaByRole[r];
            return p ? (
              <PersonaAvatar key={r} name={p.name} accent={p.accent} seed={p.avatarSeed} size={20} />
            ) : null;
          })}
        </span>
        <span className="ago">{relativeTime(ticket.createdAt)}</span>
      </div>
    </Link>
  );
}
