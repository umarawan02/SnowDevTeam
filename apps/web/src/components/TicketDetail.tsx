"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ticketStatusMeta, roleMeta, isTerminal, relativeTime, scopeLabel, tierMeta } from "@/lib/ui";
import { parseQaVerdict, parseReworkFrom, extractTldr } from "@/lib/pipeline/parse";
import type { TicketDetailJson, PersonaJson } from "@/lib/types";
import { Markdown } from "@/components/Markdown";
import { PipelineFlow } from "@/components/ticket/PipelineFlow";
import { BuiltFlowDiagram } from "@/components/ticket/BuiltFlowDiagram";
import { ArtifactTabs } from "@/components/ArtifactTabs";
import { ReviewGate } from "@/components/ReviewGate";
import { ReleaseGate } from "@/components/ReleaseGate";

const POLL_MS = 3000;

export function TicketDetail({
  initial,
  instanceLabel,
  personas,
  canReview,
  canAdmin = false,
}: {
  initial: TicketDetailJson;
  instanceLabel: string;
  personas: Record<string, PersonaJson>;
  canReview: boolean;
  canAdmin?: boolean;
}) {
  const [ticket, setTicket] = useState<TicketDetailJson>(initial);
  const [resuming, setResuming] = useState(false);

  const refetch = useCallback(async () => {
    try {
      const res = await fetch(`/api/tickets/${initial.id}`, { cache: "no-store" });
      if (!res.ok) return;
      const { ticket: fresh } = (await res.json()) as { ticket: TicketDetailJson };
      setTicket(fresh);
    } catch {
      /* transient — ignore */
    }
  }, [initial.id]);

  const live = !isTerminal(ticket.status) || ticket.status === "DEPLOYING";
  useEffect(() => {
    if (!live) return;
    const h = setInterval(refetch, POLL_MS);
    return () => clearInterval(h);
  }, [live, refetch]);

  const meta = ticketStatusMeta(ticket.status);
  const failedStep = ticket.steps.find((s) => s.status === "FAILED");
  // Latest artifact per type — a rework loop can produce more than one.
  const latest = (type: string) => [...ticket.artifacts].reverse().find((a) => a.type === type);
  const qaArtifact = latest("QA_REPORT");
  const verdict = qaArtifact ? parseQaVerdict(qaArtifact.content) : null;
  const reworkFrom = qaArtifact ? parseReworkFrom(qaArtifact.content) : null;
  const codeArtifact = latest("CODE");
  const hasDeployLog = ticket.artifacts.some((a) => a.type === "DEPLOY_LOG");
  const buildLog = latest("BUILD_LOG");
  const buildFailed = ticket.status === "FAILED" && !!buildLog && /✗|failed/i.test(buildLog.content);
  const tier = tierMeta(ticket.executionTier);
  const isNative = !!ticket.executionTier?.startsWith("NATIVE");
  const hasPreviewProblems = ticket.artifacts.some((a) => a.type === "PREVIEW_PROBLEMS");
  const flowSpec = latest("DESIGN");
  const deliverySummary = latest("DELIVERY_SUMMARY");

  // Overview: the one-glance summary.
  const designTldr = extractTldr(latest("DESIGN")?.content ?? "");
  const buildsLine = summariseBuild(latest("CHANGE_PLAN")?.content, deliverySummary?.content);
  const overviewBullets = [
    buildsLine && `**Builds:** ${buildsLine}`,
    designTldr[0] && `**Design:** ${designTldr[0]}`,
    verdict && `**QA:** ${verdict === "READY_FOR_HUMAN_REVIEW" ? "ready for human review" : "needs rework"}`,
  ].filter(Boolean) as string[];
  const showOverview = overviewBullets.length > 1 && !failedStep;

  async function resumePipeline() {
    setResuming(true);
    try {
      const res = await fetch(`/api/tickets/${ticket.id}/rework`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fromRole: "DEVELOPER", note: "The flow has been built. Verify it is active in the right scope and captured in the update set, then continue." }),
      });
      if (res.ok) refetch();
    } finally {
      setResuming(false);
    }
  }

  return (
    <div className="page tdetail">
      <p className="crumb">
        <Link href="/board">← Story board</Link>
      </p>

      <header className="td-head">
        <div className="td-title">
          <h1>{ticket.title}</h1>
          <span className={`pill ${meta.tone}${live ? " pulsing" : ""}`}>
            <span className="pdot" />
            {meta.label}
          </span>
        </div>
        <div className="td-meta">
          {ticket.priority && <span className="chip">{cap(ticket.priority)} priority</span>}
          {ticket.requester && <span className="chip">Requested by {ticket.requester}</span>}
          {ticket.category && <span className="chip">{ticket.category}</span>}
          {tier ? (
            <span className={`chip ${tier.tone}`} title={ticket.tierRationale ?? undefined}>
              {tier.label}
              {ticket.routeScope && ticket.routeScope !== "global" ? ` · ${ticket.routeScope}` : ""}
            </span>
          ) : (
            <span className="chip" title={scopeLabel(ticket.targetScope).full}>
              {scopeLabel(ticket.targetScope).full}
            </span>
          )}
          {ticket.reworkRound > 0 && (
            <span className="chip warn">Rework round {ticket.reworkRound}</span>
          )}
          <span className="chip idle">Opened {relativeTime(ticket.createdAt)}</span>
        </div>
        <p className="td-req">&ldquo;{ticket.description}&rdquo;</p>
      </header>

      {showOverview && (
        <section className="glass panel td-overview">
          <h3>Overview</h3>
          <ul>
            {overviewBullets.map((b, i) => (
              <li key={i}>
                <Markdown source={b} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {deliverySummary && (ticket.status === "DEPLOYED" || !!ticket.nativeDeployment) && (
        <section className="glass panel td-delivered">
          <Markdown source={deliverySummary.content} />
        </section>
      )}

      <section className="glass panel td-pipeline">
        <header>
          <h3>Pipeline</h3>
          <span className="hint">BA → Architect → Senior Dev → Developer → QA</span>
        </header>
        <PipelineFlow steps={ticket.steps} personas={personas} />
      </section>

      {failedStep && (
        <div className="errcard">
          <div className="eh">{roleMeta(failedStep.role).label} stage failed</div>
          <pre>{failedStep.error ?? "No error message recorded."}</pre>
        </div>
      )}

      {ticket.status === "DEPLOYING" && (
        <div className="deploybanner idle">
          <span className="pdot" /> Building and deploying to {instanceLabel}…
        </div>
      )}
      {ticket.status === "DEPLOYED" && (
        <div className="deploybanner ok">✓ Deployed to {instanceLabel} — see the Deploy Verification tab.</div>
      )}

      {ticket.status === "AWAITING_FLOW" && (
        <div className="deploybanner idle" style={{ display: "block" }}>
          <strong>Waiting on a human to build a Flow Designer flow.</strong>
          <p style={{ margin: "6px 0 0" }}>
            The Architect routed this to the flow tier. Build the flow to the spec in the{" "}
            <b>Design (ADR)</b> tab, with this ticket&rsquo;s update set current, then resume.
          </p>
          {flowSpec && (
            <pre style={{ maxHeight: 220, overflow: "auto", marginTop: 8 }}>{flowSpec.content.slice(0, 4000)}</pre>
          )}
          {canAdmin && (
            <button className="btn sm" type="button" disabled={resuming} onClick={resumePipeline} style={{ marginTop: 8 }}>
              {resuming ? "Resuming…" : "Resume pipeline"}
            </button>
          )}
        </div>
      )}

      {hasPreviewProblems && (
        <div className="deploybanner crit">
          ⚠ Promotion is blocked by unresolved update-set preview problems — see the <b>Preview Problems</b> tab.
        </div>
      )}

      {ticket.nativeDeployment && (
        <ReleaseGate
          ticketId={ticket.id}
          deployment={ticket.nativeDeployment}
          releaseGate={ticket.releaseGate}
          changeRequestRef={ticket.changeRequestRef}
          canReview={canReview}
          canAdmin={canAdmin}
          onChanged={refetch}
        />
      )}
      {ticket.status === "FAILED" && hasDeployLog && (
        <div className="deploybanner crit">Deploy failed — see the Deploy Log tab.</div>
      )}
      {buildFailed && (
        <div className="deploybanner crit">
          The generated code will not compile — see the Build tab.
        </div>
      )}
      {ticket.status === "FAILED" && (hasDeployLog || buildFailed) && canReview && (
        <ReviewGate
          ticketId={ticket.id}
          instanceLabel={instanceLabel}
          onChanged={refetch}
          reworkFrom={reworkFrom ?? "DEVELOPER"}
          variant="buildfix"
        />
      )}
      {ticket.status === "REJECTED" && ticket.reviewNote && (
        <div className="notecard">
          <div className="eh">Rejected</div>
          <p>{ticket.reviewNote}</p>
        </div>
      )}

      {ticket.status === "READY_FOR_REVIEW" &&
        (canReview ? (
          <ReviewGate
            ticketId={ticket.id}
            instanceLabel={instanceLabel}
            onChanged={refetch}
            reworkFrom={reworkFrom}
          />
        ) : (
          <div className="gate gate-locked">
            <div className="gate-head">
              <strong>Waiting on a reviewer</strong>
              <span>
                This run is ready for review. Only reviewers and admins can approve or reject —
                ask an admin to grant you the Reviewer role.
              </span>
            </div>
          </div>
        ))}

      {verdict && (
        <div className={`verdict ${verdict === "READY_FOR_HUMAN_REVIEW" ? "ready" : "rework"}`}>
          <span className="vlbl">QA verdict</span>
          <span className="vval">
            {verdict === "READY_FOR_HUMAN_REVIEW" ? "Ready for human review" : "Needs rework"}
          </span>
        </div>
      )}
      {qaArtifact && !verdict && (
        <div className="verdict unknown">
          <span className="vlbl">QA verdict</span>
          <span className="vval">Could not parse — see the QA Report tab</span>
        </div>
      )}

      {codeArtifact && (
        <section className="glass panel td-built">
          <header>
            <h3>What gets built</h3>
            <span className="hint">catalog item + fulfillment flow</span>
          </header>
          <BuiltFlowDiagram code={codeArtifact.content} targetScope={ticket.targetScope} />
        </section>
      )}

      <ArtifactTabs
        artifacts={ticket.artifacts}
        steps={ticket.steps}
        running={live}
        primaryTab={
          isNative && ticket.status === "READY_FOR_REVIEW" && ticket.artifacts.some((a) => a.type === "CHANGE_PLAN_DIFF")
            ? "CHANGE_PLAN_DIFF"
            : undefined
        }
      />
    </div>
  );
}

function cap(s: string) {
  return s.charAt(0) + s.slice(1).toLowerCase();
}

const KIND_LABEL: Record<string, string> = {
  sc_cat_item: "catalog item",
  item_option_new: "variable",
  catalog_ui_policy: "UI policy",
  catalog_script_client: "client script",
  sys_script: "business rule",
  sys_script_include: "script include",
  sysevent_email_action: "notification",
  sys_security_acl: "ACL",
  contract_sla: "SLA",
  sys_atf_test: "ATF test",
  sys_atf_test_suite: "ATF suite",
};

/** "1 catalog item, 3 variables, 1 business rule, 3 notifications, ATF" — from the plan. */
function summariseBuild(changePlanJson: string | undefined, deliveryMd: string | undefined): string | null {
  if (deliveryMd) {
    const m = deliveryMd.match(/^#\s*Delivered\s*—\s*(\d+)\s*record/im);
    if (m) return `${m[1]} record${m[1] === "1" ? "" : "s"} — see the Delivered tab`;
  }
  if (!changePlanJson) return null;
  try {
    const plan = JSON.parse(changePlanJson) as { changes?: { table: string }[] };
    const counts = new Map<string, number>();
    for (const c of plan.changes ?? []) counts.set(c.table, (counts.get(c.table) ?? 0) + 1);
    const parts: string[] = [];
    for (const [table, n] of counts) {
      if (table.startsWith("sys_atf")) continue;
      const label = KIND_LABEL[table] ?? table;
      parts.push(n === 1 ? `1 ${label}` : `${n} ${label}${label.endsWith("y") ? "" : "s"}`);
    }
    if ([...counts.keys()].some((t) => t.startsWith("sys_atf"))) parts.push("ATF tests");
    return parts.join(", ") || null;
  } catch {
    return null;
  }
}
