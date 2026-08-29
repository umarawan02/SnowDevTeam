import Link from "next/link";
import { AGENT_ROLES } from "@/lib/constants";
import { listTickets } from "@/lib/tickets";
import { NewRequestForm } from "@/components/NewRequestForm";
import { ticketStatusMeta, isTerminal, relativeTime } from "@/lib/ui";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const tickets = await listTickets();

  return (
    <main className="shell">
      <header className="topbar">
        <span className="brand">
          <Link href="/">SnowDevTeam</Link>
        </span>
        <span className="tag">AI ServiceNow delivery</span>
      </header>

      <h1 className="page-h">Feature requests</h1>
      <p className="sub">
        Submit a request and a pipeline of agents — Business Analyst, Architect, Senior
        Developer, Developer, QA — works it through to reviewable ServiceNow artifacts.
        Nothing is deployed without an explicit human approval.
      </p>

      <NewRequestForm />

      <section className="card" style={{ padding: "18px 22px" }}>
        <div className="tlist">
          <div className="lh">Requests ({tickets.length})</div>
          {tickets.length === 0 && <p className="empty">No requests yet — submit one above.</p>}
          {tickets.map((t) => {
            const meta = ticketStatusMeta(t.status);
            const running = !isTerminal(t.status);
            return (
              <div className="trow" key={t.id}>
                <div className="tmain">
                  <div className="ttitle">
                    <Link href={`/tickets/${t.id}`}>{t.title}</Link>
                  </div>
                  <div className="tmeta">{relativeTime(t.createdAt)}</div>
                </div>
                <div className="minipipe" aria-hidden>
                  {AGENT_ROLES.map((role) => {
                    const s = t.steps.find((x) => x.role === role);
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
                <span className={`pill ${meta.tone}${running ? " pulsing" : ""}`}>
                  <span className="pdot" />
                  {meta.label}
                </span>
              </div>
            );
          })}
        </div>
      </section>
    </main>
  );
}
