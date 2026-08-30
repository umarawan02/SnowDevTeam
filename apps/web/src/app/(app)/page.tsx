import Link from "next/link";
import { getDashboardMetrics } from "@/lib/metrics";
import { getPersonas } from "@/lib/agents/personas";
import { relativeTime, msLabel, usdLabel } from "@/lib/ui";
import { AreaChart } from "@/components/charts/AreaChart";
import { BarList } from "@/components/charts/BarList";
import { Donut } from "@/components/charts/Donut";
import { PersonaAvatar } from "@/components/PersonaAvatar";
import { IconArrow } from "@/components/app/icons";

export const dynamic = "force-dynamic";

const VIZ = ["var(--viz-1)", "var(--viz-2)", "var(--viz-3)", "var(--viz-4)", "var(--viz-5)"];

export default async function DashboardPage() {
  const [m, personas] = await Promise.all([getDashboardMetrics(), getPersonas()]);

  const kpis = [
    { k: "Requests", v: m.totals.requests, sub: "all time" },
    { k: "In flight", v: m.totals.running, sub: "running or deploying", cls: m.totals.running ? "hot" : "" },
    { k: "Awaiting review", v: m.totals.awaitingReview, sub: "needs a human", cls: m.totals.awaitingReview ? "hot" : "" },
    { k: "Deployed", v: m.totals.deployed, sub: "live in ServiceNow" },
    { k: "Avg run", v: msLabel(m.avgRunMs), sub: "first agent → QA", isText: true },
    { k: "AI spend", v: m.costTracked ? usdLabel(m.totalCostUsd) : "—", sub: m.costTracked ? "all runs" : "tracked from next run", isText: true },
  ];

  const timingByRole = new Map<string, (typeof m.stageTiming)[number]>(
    m.stageTiming.map((s) => [s.role, s]),
  );

  return (
    <div className="page dash">
      <div className="pagehead">
        <div className="grow">
          <h1 className="h1">Delivery overview</h1>
          <p className="lede">
            Feature requests move through a five-agent pipeline. Nothing reaches the instance
            until a human approves it at the review gate.
          </p>
        </div>
      </div>

      <div className="dash-kpis">
        {kpis.map((c) => (
          <div className={`glass stat ${c.cls ?? ""}`} key={c.k}>
            <div className="k">{c.k}</div>
            <div className="v">{c.v}</div>
            <div className="sub">{c.sub}</div>
          </div>
        ))}
      </div>

      <div className="dash-grid">
        <div style={{ display: "grid", gap: 18 }}>
          <section className="glass panel">
            <header>
              <h3>Throughput</h3>
              <span className="hint">requests / day · 14d</span>
            </header>
            <AreaChart data={m.throughput} />
          </section>

          <section className="glass panel">
            <header>
              <h3>Stage timing</h3>
              <span className="hint">avg wall-clock per agent</span>
            </header>
            <BarList
              items={m.stageTiming.map((s) => ({
                label: s.label,
                value: s.avgMs,
                display: s.runs ? msLabel(s.avgMs) : "no runs",
              }))}
            />
          </section>

          <section className="glass panel">
            <header>
              <h3>Pipeline funnel</h3>
              <span className="hint">stages completed across all runs</span>
            </header>
            <BarList
              variant="violet"
              items={m.funnel.map((f) => ({
                label: f.label,
                value: f.reached,
                max: m.funnel[0]?.reached || 1,
                display: String(f.reached),
              }))}
            />
          </section>
        </div>

        <div style={{ display: "grid", gap: 18 }}>
          <section className="glass panel">
            <header>
              <h3>Needs your review</h3>
              <span className="hint">{m.reviewQueue.length}</span>
            </header>
            <div className="reviewq">
              {m.reviewQueue.length === 0 && <div className="none">Nothing waiting. 🎉</div>}
              {m.reviewQueue.map((t) => (
                <Link href={`/tickets/${t.id}`} key={t.id}>
                  <span className="t">{t.title}</span>
                  <span className="go">Review <IconArrow style={{ width: 13, height: 13, verticalAlign: "-2px" }} /></span>
                </Link>
              ))}
            </div>
          </section>

          {m.costTracked && (
            <section className="glass panel">
              <header>
                <h3>Spend by agent</h3>
                <span className="hint">{usdLabel(m.totalCostUsd)}</span>
              </header>
              <Donut
                segments={m.costByRole
                  .filter((c) => c.costUsd > 0)
                  .map((c, i) => ({ label: c.label, value: c.costUsd, color: VIZ[i % VIZ.length] }))}
                format={usdLabel}
              />
            </section>
          )}

          <section className="glass panel">
            <header>
              <h3>Recent activity</h3>
            </header>
            <div className="feed">
              {m.activity.length === 0 && <div className="none" style={{ fontSize: 13, color: "var(--ink-faint)" }}>No runs yet.</div>}
              {m.activity.map((e) => (
                <div className="ev" key={e.id}>
                  <span className={`fdot ${e.tone}`} />
                  <span className="fx">{e.text}</span>
                  <span className="ft">{relativeTime(e.at)}</span>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>

      <section className="glass panel">
        <header>
          <h3>Your delivery team</h3>
          <Link href="/agents" className="hint" style={{ color: "var(--accent-ink)" }}>
            Manage agents →
          </Link>
        </header>
        <div className="roster">
          {personas.map((p) => {
            const t = timingByRole.get(p.role);
            return (
              <Link href="/agents" className="r" key={p.id}>
                <PersonaAvatar name={p.name} accent={p.accent} seed={p.avatarSeed} size={34} />
                <span className="meta">
                  <span className="nm">{p.name}</span>
                  <span className="rl">{p.title}</span>
                </span>
                <span className="st">
                  {t?.runs ?? 0} run{(t?.runs ?? 0) === 1 ? "" : "s"}
                  <br />
                  {t?.runs ? msLabel(t.avgMs) : "—"}
                </span>
              </Link>
            );
          })}
        </div>
      </section>
    </div>
  );
}
