import { notFound } from "next/navigation";
import { getTicketWithSteps } from "@/lib/tickets";
import { getPersonas } from "@/lib/agents/personas";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canReview, hasRole } from "@/lib/auth/rbac";
import { instanceLabel } from "@/lib/instance";
import { TicketDetail } from "@/components/TicketDetail";
import type { TicketDetailJson, PersonaJson } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function TicketPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [ticket, personas, user] = await Promise.all([
    getTicketWithSteps(id),
    getPersonas(),
    getCurrentUser(),
  ]);
  if (!ticket) notFound();

  const initial = JSON.parse(JSON.stringify(ticket)) as TicketDetailJson;
  const personaByRole = Object.fromEntries(
    personas.map((p) => [p.role, p as unknown as PersonaJson]),
  ) as Record<string, PersonaJson>;

  return (
    <TicketDetail
      initial={initial}
      instanceLabel={instanceLabel()}
      personas={personaByRole}
      canReview={canReview(user)}
      canAdmin={!!user && hasRole(user, "ADMIN")}
    />
  );
}
