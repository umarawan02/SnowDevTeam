"use client";

import { useState } from "react";
import type { NativeDeploymentJson } from "@/lib/types";

/**
 * Release-gate stepper for a native deployment (NATIVE_ENGINE_BRIEF §5.4).
 * DEV → TEST → PROD with Promote / Roll back. Minimal — the full review surface
 * is Phase 7. Shown only when the ticket has a NativeDeployment.
 */

const STAGES = ["DEV", "TEST", "PROD"] as const;
type Stage = (typeof STAGES)[number];

const STATE_STAGE: Record<string, Stage> = {
  APPLIED: "DEV",
  PROMOTING: "DEV",
  IN_TEST: "TEST",
  IN_PROD: "PROD",
  ROLLED_BACK: "DEV",
};

export function ReleaseGate({
  ticketId,
  deployment,
  releaseGate,
  changeRequestRef,
  canReview,
  canAdmin,
  onChanged,
}: {
  ticketId: string;
  deployment: NativeDeploymentJson;
  releaseGate: string | null;
  changeRequestRef: string | null;
  canReview: boolean;
  canAdmin: boolean;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const current: Stage = (releaseGate as Stage) ?? STATE_STAGE[deployment.state] ?? "DEV";
  const currentIdx = STAGES.indexOf(current);

  async function promote(toGate: "TEST" | "PROD") {
    setBusy(toGate);
    setError(null);
    try {
      const res = await fetch(`/api/tickets/${ticketId}/promote`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ toGate }),
      });
      const b = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(b.error ?? `promote failed (${res.status})`);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function rollback(env: string) {
    if (!confirm(`Roll back the update set on ${env}? This backs out every change in it.`)) return;
    setBusy(`rollback-${env}`);
    setError(null);
    try {
      const res = await fetch(`/api/tickets/${ticketId}/rollback`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ env }),
      });
      const b = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(b.error ?? `rollback failed (${res.status})`);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const prodBlocked = !changeRequestRef;

  return (
    <section className="glass panel release-gate">
      <header>
        <h3>Release</h3>
        <span className="hint">
          update set <code>{deployment.updateSetName}</code> · scope <code>{deployment.scope}</code> · {deployment.state}
        </span>
      </header>

      <ol className="rg-steps">
        {STAGES.map((s, i) => (
          <li key={s} className={i < currentIdx ? "done" : i === currentIdx ? "at" : "todo"}>
            <span className="rg-dot" />
            {s}
          </li>
        ))}
      </ol>

      {deployment.appliedChanges?.length > 0 && (
        <p className="hint">{deployment.appliedChanges.length} record(s) applied.</p>
      )}

      <div className="rg-actions">
        {canReview && currentIdx === 0 && (
          <button className="btn" type="button" disabled={busy !== null} onClick={() => promote("TEST")}>
            {busy === "TEST" ? "Promoting…" : "Promote to Test"}
          </button>
        )}
        {canAdmin && currentIdx === 1 && (
          <button
            className="btn"
            type="button"
            disabled={busy !== null || prodBlocked}
            title={prodBlocked ? "Set a change-request reference on the ticket first" : undefined}
            onClick={() => promote("PROD")}
          >
            {busy === "PROD" ? "Promoting…" : "Promote to Prod"}
          </button>
        )}
        {canAdmin && (
          <button className="btn ghost" type="button" disabled={busy !== null} onClick={() => rollback(STAGES[currentIdx].toLowerCase())}>
            {busy?.startsWith("rollback") ? "Rolling back…" : `Roll back ${STAGES[currentIdx]}`}
          </button>
        )}
      </div>

      {prodBlocked && currentIdx === 1 && (
        <p className="hint warn">Prod promotion needs a change-request reference on the ticket.</p>
      )}
      {error && <p className="gate-err">{error}</p>}
    </section>
  );
}
