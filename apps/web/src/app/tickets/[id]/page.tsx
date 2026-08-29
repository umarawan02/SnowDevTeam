import Link from "next/link";
import { notFound } from "next/navigation";
import { getTicketWithSteps } from "@/lib/tickets";
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

  // Prisma Date -> ISO string for the client component.
  const initial = JSON.parse(JSON.stringify(ticket)) as TicketDetailJson;

  return (
    <main className="shell">
      <header className="topbar">
        <span className="brand">
          <Link href="/">SnowDevTeam</Link>
        </span>
        <span className="tag">AI ServiceNow delivery</span>
      </header>
      <TicketDetail initial={initial} />
    </main>
  );
}
