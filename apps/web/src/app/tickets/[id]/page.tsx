import Link from "next/link";
import { notFound } from "next/navigation";
import { config } from "@/lib/config";
import { getTicketWithSteps } from "@/lib/tickets";
import { TicketDetail } from "@/components/TicketDetail";
import type { TicketDetailJson } from "@/lib/types";

export const dynamic = "force-dynamic";

function instanceLabel(): string {
  const url = config.SN_INSTANCE_URL;
  if (!url) return "the PDI";
  try {
    return new URL(url).hostname.split(".")[0];
  } catch {
    return url;
  }
}

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
    <main className="shell">
      <header className="topbar">
        <span className="brand">
          <Link href="/">SnowDevTeam</Link>
        </span>
        <span className="tag">AI ServiceNow delivery</span>
      </header>
      <TicketDetail initial={initial} instanceLabel={instanceLabel()} />
    </main>
  );
}
