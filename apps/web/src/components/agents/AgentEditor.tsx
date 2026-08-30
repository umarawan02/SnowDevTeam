"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MODEL_CHOICES } from "@/lib/agents/models";
import { PersonaAvatar } from "@/components/PersonaAvatar";
import type { PersonaJson } from "@/lib/types";

const SWATCHES = ["#6366f1", "#0ea5e9", "#14b8a6", "#f59e0b", "#ec4899", "#8b5cf6", "#ef4444", "#22c55e"];

export function AgentEditor({ persona, defaultModelLabel }: { persona: PersonaJson; defaultModelLabel: string }) {
  const router = useRouter();
  const [f, setF] = useState({
    name: persona.name,
    title: persona.title,
    tagline: persona.tagline,
    bio: persona.bio,
    voice: persona.voice,
    accent: persona.accent,
    model: persona.model ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((s) => ({ ...s, [k]: v }));

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/agents/${persona.role.toLowerCase()}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(f),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error ?? `save failed (${res.status})`);
      }
      router.push("/agents");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <div className="glass panel">
      <div className="top" style={{ display: "flex", alignItems: "center", gap: 13, marginBottom: 18 }}>
        <PersonaAvatar name={f.name || persona.name} accent={f.accent} seed={persona.avatarSeed} size={48} square />
        <div>
          <div style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: "1.05rem" }}>
            {f.name || "Unnamed"}
          </div>
          <div style={{ fontSize: 11.5, color: "var(--accent-ink)", fontWeight: 600 }}>{persona.title}</div>
        </div>
      </div>

      <div className="editform">
        <div className="row2">
          <div className="field">
            <label htmlFor="ag-name">Name</label>
            <input id="ag-name" value={f.name} maxLength={60} onChange={(e) => set("name", e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="ag-title">Title</label>
            <input id="ag-title" value={f.title} maxLength={60} onChange={(e) => set("title", e.target.value)} />
          </div>
        </div>

        <div className="field">
          <label htmlFor="ag-tag">Tagline</label>
          <input id="ag-tag" value={f.tagline} maxLength={160} onChange={(e) => set("tagline", e.target.value)} />
        </div>

        <div className="field">
          <label htmlFor="ag-bio">Bio</label>
          <textarea id="ag-bio" value={f.bio} maxLength={1000} onChange={(e) => set("bio", e.target.value)} style={{ minHeight: 90 }} />
        </div>

        <div className="field">
          <label htmlFor="ag-voice">Voice in the pipeline</label>
          <textarea
            id="ag-voice"
            value={f.voice}
            maxLength={600}
            onChange={(e) => set("voice", e.target.value)}
            style={{ minHeight: 76 }}
          />
          <span style={{ fontSize: 11.5, color: "var(--ink-faint)" }}>
            Prepended to this agent&rsquo;s system prompt on every run. Keep it about approach and
            temperament — it must not contradict the build instructions.
          </span>
        </div>

        <div className="row2">
          <div className="field">
            <label>Accent</label>
            <div className="swatchrow">
              {[...new Set([persona.accent, ...SWATCHES])].map((c) => (
                <button
                  key={c}
                  type="button"
                  className="swatch"
                  aria-pressed={f.accent.toLowerCase() === c.toLowerCase()}
                  style={{ background: c }}
                  aria-label={`accent ${c}`}
                  onClick={() => set("accent", c)}
                />
              ))}
            </div>
          </div>
          <div className="field">
            <label htmlFor="ag-model">Model</label>
            <select
              id="ag-model"
              value={f.model}
              onChange={(e) => set("model", e.target.value)}
              style={{
                font: "inherit",
                fontSize: 14,
                color: "var(--ink)",
                background: "var(--bg)",
                border: "1px solid var(--border-strong)",
                borderRadius: 8,
                padding: "9px 11px",
              }}
            >
              {MODEL_CHOICES.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.value === "" ? `Default (${defaultModelLabel})` : m.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div style={{ display: "flex", gap: 10 }}>
          <button className="btn" type="button" disabled={busy} onClick={save}>
            {busy ? "Saving…" : "Save profile"}
          </button>
          <button className="btn ghost" type="button" disabled={busy} onClick={() => router.push("/agents")}>
            Cancel
          </button>
        </div>
        {error && <p className="formerr">{error}</p>}
      </div>
    </div>
  );
}
