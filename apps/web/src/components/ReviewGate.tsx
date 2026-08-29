"use client";

import { useState } from "react";

type Mode = "idle" | "confirm-approve" | "reject";

export function ReviewGate({
  ticketId,
  instanceLabel,
  onChanged,
}: {
  ticketId: string;
  instanceLabel: string;
  onChanged: () => void;
}) {
  const [mode, setMode] = useState<Mode>("idle");
  const [note, setNote] = useState("");
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

  return (
    <div className="gate">
      <div className="gate-head">
        <strong>Review gate</strong>
        <span>Approving builds the generated code and deploys it to {instanceLabel}.</span>
      </div>

      {mode === "idle" && (
        <div className="gate-actions">
          <button className="btn" type="button" disabled={busy} onClick={() => setMode("confirm-approve")}>
            Approve &amp; deploy
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
