"use client";

import { useState } from "react";

type Mode = "idle" | "confirm-approve" | "reject" | "rework";

const REWORK_STAGES = [
  { value: "ARCHITECT", label: "Architect — redo the design" },
  { value: "SENIOR_DEV", label: "Senior Developer — redo the build plan" },
  { value: "DEVELOPER", label: "Developer — redo the code" },
] as const;

export function ReviewGate({
  ticketId,
  instanceLabel,
  onChanged,
  reworkFrom,
  variant = "gate",
}: {
  ticketId: string;
  instanceLabel: string;
  onChanged: () => void;
  reworkFrom?: string | null;
  /** "gate" = approve / rework / reject; "buildfix" = just fix-and-rerun after a build failure. */
  variant?: "gate" | "buildfix";
}) {
  const [mode, setMode] = useState<Mode>(variant === "buildfix" ? "rework" : "idle");
  const [note, setNote] = useState("");
  const [stage, setStage] = useState<string>(
    reworkFrom && REWORK_STAGES.some((s) => s.value === reworkFrom) ? reworkFrom : "DEVELOPER",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function approve() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/tickets/${ticketId}/approve`, { method: "POST" });
      if (!res.ok && res.status !== 202) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error ?? `approve failed (${res.status})`);
      }
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  async function reject() {
    if (!note.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/tickets/${ticketId}/reject`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ note: note.trim() }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error ?? `reject failed (${res.status})`);
      }
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  async function rework() {
    if (!note.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/tickets/${ticketId}/rework`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fromRole: stage, note: note.trim() }),
      });
      if (!res.ok && res.status !== 202) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error ?? `rework failed (${res.status})`);
      }
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <div className="gate">
      <div className="gate-head">
        <strong>{variant === "buildfix" ? "Fix the build" : "Review gate"}</strong>
        <span>
          {variant === "buildfix"
            ? "The generated code failed to build. Send it back with guidance and the pipeline re-runs from there."
            : `Approving builds the generated code and deploys it to ${instanceLabel}.`}
        </span>
      </div>

      {mode === "idle" && (
        <div className="gate-actions">
          <button className="btn" type="button" disabled={busy} onClick={() => setMode("confirm-approve")}>
            Approve &amp; deploy
          </button>
          <button className="btn ghost" type="button" disabled={busy} onClick={() => setMode("rework")}>
            Send back for rework
          </button>
          <button className="btn ghost" type="button" disabled={busy} onClick={() => setMode("reject")}>
            Reject
          </button>
        </div>
      )}

      {mode === "confirm-approve" && (
        <div className="gate-actions">
          <span className="gate-q">Build and deploy to {instanceLabel}?</span>
          <button className="btn" type="button" disabled={busy} onClick={approve}>
            {busy ? "Starting…" : "Confirm deploy"}
          </button>
          <button className="btn ghost" type="button" disabled={busy} onClick={() => setMode("idle")}>
            Cancel
          </button>
        </div>
      )}

      {mode === "rework" && (
        <div className="gate-reject">
          <label htmlFor="rework-stage">Send back to</label>
          <select id="rework-stage" value={stage} onChange={(e) => setStage(e.target.value)}>
            {REWORK_STAGES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
          <label htmlFor="rework-note">What must change? (required)</label>
          <textarea
            id="rework-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Be specific — this is passed to the agent verbatim, alongside the QA report."
            maxLength={4000}
          />
          <span style={{ fontSize: 11.5, color: "var(--ink-faint)" }}>
            The pipeline re-runs from that stage with your note plus the QA report — a few
            minutes and roughly $1–3.
          </span>
          <div className="gate-actions">
            <button className="btn" type="button" disabled={busy || !note.trim()} onClick={rework}>
              {busy ? "Starting…" : variant === "buildfix" ? "Fix & re-run" : "Send back for rework"}
            </button>
            {variant !== "buildfix" && (
              <button className="btn ghost" type="button" disabled={busy} onClick={() => setMode("idle")}>
                Cancel
              </button>
            )}
          </div>
        </div>
      )}

      {mode === "reject" && (
        <div className="gate-reject">
          <label htmlFor="reject-note">Rejection note (required)</label>
          <textarea
            id="reject-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="What needs to change before this can be deployed?"
            maxLength={2000}
          />
          <div className="gate-actions">
            <button className="btn" type="button" disabled={busy || !note.trim()} onClick={reject}>
              {busy ? "Saving…" : "Confirm rejection"}
            </button>
            <button className="btn ghost" type="button" disabled={busy} onClick={() => setMode("idle")}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && <p className="formerr">{error}</p>}
    </div>
  );
}
