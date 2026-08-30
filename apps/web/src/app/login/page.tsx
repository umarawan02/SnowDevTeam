import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { LoginForm } from "@/components/auth/LoginForm";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const user = await getCurrentUser();
  if (user) redirect("/");
  const { next } = await searchParams;
  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : undefined;

  return (
    <div className="auth">
      <aside className="auth-brand">
        <div className="auth-glow" aria-hidden />
        <div className="auth-brand-inner">
          <span className="chip accent">Human-approved AI workflow</span>
          <h1>
            Turn every request into a <span className="hl">reviewed</span> deploy.
          </h1>
          <p>
            Five AI agents draft the ServiceNow build. You review the evidence, approve what
            ships, and stay in control of every change to the instance.
          </p>

          <div className="auth-card" aria-hidden>
            <div className="ac-head">
              <span>Latest run · Company t-shirt request</span>
              <span className="ac-badge">Ready for review</span>
            </div>
            <div className="ac-row">
              <div>
                <div className="ac-k">Catalog item</div>
                <div className="ac-v">Company T-Shirt Request · 5 fields</div>
              </div>
              <span className="ac-approve">Approve</span>
            </div>
            <div className="ac-row">
              <div>
                <div className="ac-k">Fulfillment flow</div>
                <div className="ac-v">Manager approval → Facilities task</div>
              </div>
              <span className="ac-approve">Approve</span>
            </div>
          </div>
        </div>
      </aside>

      <main className="auth-panel">
        <div className="auth-form-wrap">
          <p className="auth-eyebrow">Welcome back</p>
          <h2 className="auth-title">Sign in to your workspace.</h2>
          <p className="auth-sub">
            Review AI-suggested ServiceNow changes without losing context — or control.
          </p>
          <LoginForm next={safeNext} />
          <p className="auth-fineprint">
            Your ServiceNow instance never changes without an explicit approval here.
          </p>
        </div>
      </main>
    </div>
  );
}
