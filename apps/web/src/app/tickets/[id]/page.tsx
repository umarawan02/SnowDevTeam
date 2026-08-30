import { notFound } from "next/navigation";
import { getTicketWithSteps } from "@/lib/tickets";
import { instanceLabel } from "@/lib/instance";
import { TicketDetail } from "@/components/TicketDetail";
import type { TicketDetailJson } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function TicketPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ticket = await getTicketWithSteps(id);
  if (!ticket) notFound();

  const initial = JSON.parse(JSON.stringify(ticket)) as TicketDetailJson;

  return (
    <div className="shell">
      <TicketDetail initial={initial} instanceLabel={instanceLabel()} />
    </div>
  );
}
