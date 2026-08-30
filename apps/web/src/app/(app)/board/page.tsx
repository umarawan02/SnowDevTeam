import { listTickets } from "@/lib/tickets";
import { getPersonas } from "@/lib/agents/personas";
import { BoardLive } from "@/components/board/BoardLive";
import type { TicketListItemJson, PersonaJson } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function BoardPage() {
  const [tickets, personas] = await Promise.all([listTickets(), getPersonas()]);

  const personaByRole = Object.fromEntries(
    personas.map((p) => [p.role, p as unknown as PersonaJson]),
  ) as Record<string, PersonaJson>;

  return (
    <div className="page-wide">
      <div className="pagehead">
        <div className="grow">
          <h1 className="h1">Story board</h1>
          <p className="lede">
            Every request as it moves through the pipeline. Columns are driven by the run —
            the board updates itself.
          </p>
        </div>
      </div>
      <BoardLive
        initialTickets={tickets as unknown as TicketListItemJson[]}
        personaByRole={personaByRole}
      />
    </div>
  );
}
