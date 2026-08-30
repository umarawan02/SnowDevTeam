import Link from "next/link";
import { getPersonas } from "@/lib/agents/personas";
import { getDashboardMetrics } from "@/lib/metrics";
import { msLabel } from "@/lib/ui";
import { PersonaAvatar } from "@/components/PersonaAvatar";

export const dynamic = "force-dynamic";

export default async function AgentsPage() {
  const [personas, m] = await Promise.all([getPersonas(), getDashboardMetrics()]);
  const timing = new Map<string, (typeof m.stageTiming)[number]>(
    m.stageTiming.map((s) => [s.role, s]),
  );

  return (
    <div className="page">
      <div className="pagehead">
        <div className="grow">
          <h1 className="h1">The delivery team</h1>
          <p className="lede">
            Five AI specialists, one per pipeline stage. Rename them and rewrite their
            profiles — a persona&rsquo;s name and approach are threaded into its prompt on
            every run.
          </p>
        </div>
      </div>

      <div className="agentgrid">
        {personas.map((p) => {
          const t = timing.get(p.role);
          return (
            <article className="glass agentcard" key={p.id}>
              <div className="top">
                <PersonaAvatar name={p.name} accent={p.accent} seed={p.avatarSeed} size={48} square />
                <div className="id">
                  <div className="nm">{p.name}</div>
                  <div className="rl">{p.title}</div>
                </div>
              </div>
              <p className="tag">&ldquo;{p.tagline}&rdquo;</p>
              <p className="bio">{p.bio}</p>
              <div className="voice">
                <b>Voice in the pipeline</b>
                {p.voice}
              </div>
              <div className="statsrow">
                <span>
                  <b>{t?.runs ?? 0}</b>
                  runs
                </span>
                <span>
                  <b>{t?.runs ? msLabel(t.avgMs) : "—"}</b>
                  avg time
                </span>
                <span>
                  <b>{p.model ? p.model.replace("claude-", "") : "default"}</b>
                  model
                </span>
              </div>
              <div className="foot">
                <Link href={`/agents/${p.role.toLowerCase()}`} className="btn ghost sm">
                  Edit profile
                </Link>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
