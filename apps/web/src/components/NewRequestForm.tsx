"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function NewRequestForm() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/tickets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: title.trim(), description: description.trim() }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Request failed (${res.status})`);
      }
      const { id } = await res.json();
      router.push(`/tickets/${id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  }

  return (
    <form className="card newreq" onSubmit={submit}>
      <h2>New feature request</h2>
      <p className="hint">
        The five-agent pipeline runs synchronously — a full run takes ~15–25 minutes.
      </p>
      <div className="field">
        <label htmlFor="nr-title">Title</label>
        <input
          id="nr-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Laptop request with manager approval"
          maxLength={200}
          required
        />
      </div>
      <div className="field">
        <label htmlFor="nr-desc">Description</label>
        <textarea
          id="nr-desc"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Employees need to request a new laptop, with manager approval, that creates a fulfillment task for IT ops."
          maxLength={10000}
          required
        />
      </div>
      <button className="btn" type="submit" disabled={submitting || !title.trim() || !description.trim()}>
        {submitting ? "Starting…" : "Start pipeline"}
      </button>
      {error && <p className="formerr">{error}</p>}
    </form>
  );
}
