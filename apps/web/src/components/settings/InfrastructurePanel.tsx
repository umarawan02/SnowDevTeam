"use client";

import { useState } from "react";
import { relativeTime } from "@/lib/ui";
import type { CustomerAdminJson, InstanceAdminJson } from "@/lib/types";

const ENVS = ["dev", "test", "prod"] as const;
const AUTH_MODES = ["oauth_cc", "basic"] as const;

type InstanceDraft = {
  customerId: string;
  name: string;
  url: string;
  env: string;
  authMode: string;
  credentialRef: string;
  readOnlyCredentialRef: string;
};

const emptyInstance = (customerId: string): InstanceDraft => ({
  customerId,
  name: "",
  url: "",
  env: "dev",
  authMode: "oauth_cc",
  credentialRef: "",
  readOnlyCredentialRef: "",
});

export function InfrastructurePanel({ initial }: { initial: CustomerAdminJson[] }) {
  const [customers, setCustomers] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newCustomer, setNewCustomer] = useState("");
  const [editing, setEditing] = useState<{ instance: InstanceAdminJson; customerId: string } | null>(null);
  const [adding, setAdding] = useState<string | null>(null); // customerId

  async function refresh() {
    const res = await fetch("/api/customers");
    if (res.ok) setCustomers((await res.json()).customers);
  }

  async function call(url: string, method: string, body: unknown) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `${method} ${url} failed (${res.status})`);
      await refresh();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="infra">
      {error && <p className="formerr" style={{ marginBottom: 12 }}>{error}</p>}

      <form
        className="glass panel infra-newcust"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!newCustomer.trim()) return;
          if (await call("/api/customers", "POST", { name: newCustomer.trim() })) setNewCustomer("");
        }}
      >
        <label htmlFor="nc">New customer</label>
        <input id="nc" value={newCustomer} onChange={(e) => setNewCustomer(e.target.value)} placeholder="Acme Corp" maxLength={120} />
        <button className="btn sm" type="submit" disabled={busy || !newCustomer.trim()}>Add</button>
      </form>

      {customers.map((c) => (
        <section key={c.id} className="glass panel infra-cust">
          <header className="infra-custhead">
            <div>
              <h3>{c.name}</h3>
              <span className="hint">
                <code>{c.slug}</code> · {c._count.tickets} ticket{c._count.tickets === 1 ? "" : "s"} · created {relativeTime(c.createdAt)}
              </span>
            </div>
            <label className="infra-flag">
              <input
                type="checkbox"
                checked={c.allowFluentFlows}
                disabled={busy}
                onChange={(e) => call(`/api/customers/${c.id}`, "PATCH", { allowFluentFlows: e.target.checked })}
              />
              allow Fluent flows
            </label>
          </header>

          <div className="infra-sub">
            <div className="infra-subhead">
              <h4>Instances</h4>
              <button className="btn sm ghost" type="button" onClick={() => setAdding(c.id)} disabled={busy}>New instance</button>
            </div>
            {c.instances.length === 0 && <p className="hint">No instances yet.</p>}
            {c.instances.map((i) => (
              <div key={i.id} className="infra-inst">
                <div className="infra-instmain">
                  <span className={`envbadge ${i.env}`}>{i.env}</span>
                  <strong>{i.name}</strong>
                  <a href={i.url} target="_blank" rel="noreferrer" className="hint">{i.url}</a>
                </div>
                <div className="infra-instmeta">
                  <span>auth: {i.authMode}</span>
                  <span>cred: <code>{i.credentialRef}</code>{i.readOnlyCredentialRef ? <> · ro: <code>{i.readOnlyCredentialRef}</code></> : null}</span>
                  <span>
                    {i.releaseName
                      ? `release: ${i.releaseName}${i.releaseBuild ? ` (${i.releaseBuild})` : ""} · probed ${relativeTime(i.releaseDetectedAt!)}`
                      : "not probed yet — run `pnpm --filter web probe-instance <id>`"}
                  </span>
                </div>
                <button className="btn sm ghost" type="button" onClick={() => setEditing({ instance: i, customerId: c.id })} disabled={busy}>Edit</button>
              </div>
            ))}
          </div>

          <div className="infra-sub">
            <h4>Fluent projects</h4>
            {c.projects.length === 0 && <p className="hint">None — native-tier tickets don&rsquo;t need one.</p>}
            {c.projects.map((p) => (
              <div key={p.id} className="infra-proj">
                <strong>{p.name}</strong>
                <span className="hint">scope <code>{p.scope}</code> · {p.kind} · branch <code>{p.defaultBranch}</code></span>
              </div>
            ))}
            {c.projects.length > 0 && <p className="hint">Provisioned by <code>scripts/</code>, not editable here.</p>}
          </div>
        </section>
      ))}

      {adding && (
        <InstanceDialog
          title="New instance"
          draft={emptyInstance(adding)}
          busy={busy}
          onClose={() => setAdding(null)}
          onSubmit={async (d) => {
            if (await call("/api/instances", "POST", d)) setAdding(null);
          }}
        />
      )}
      {editing && (
        <InstanceDialog
          title={`Edit ${editing.instance.name}`}
          draft={{
            customerId: editing.customerId,
            name: editing.instance.name,
            url: editing.instance.url,
            env: editing.instance.env,
            authMode: editing.instance.authMode,
            credentialRef: editing.instance.credentialRef,
            readOnlyCredentialRef: editing.instance.readOnlyCredentialRef ?? "",
          }}
          busy={busy}
          onClose={() => setEditing(null)}
          onSubmit={async (d) => {
            const { customerId: _c, ...patch } = d;
            void _c;
            if (await call(`/api/instances/${editing.instance.id}`, "PATCH", patch)) setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function InstanceDialog({
  title,
  draft,
  busy,
  onClose,
  onSubmit,
}: {
  title: string;
  draft: InstanceDraft;
  busy: boolean;
  onClose: () => void;
  onSubmit: (d: InstanceDraft) => void;
}) {
  const [d, setD] = useState(draft);
  const set = (k: keyof InstanceDraft, v: string) => setD((p) => ({ ...p, [k]: v }));

  return (
    <div className="modal-scrim" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <h3 className="h2" style={{ marginBottom: 14 }}>{title}</h3>
        <form
          className="editform"
          style={{ maxWidth: "none" }}
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit(d);
          }}
        >
          <div className="field">
            <label htmlFor="i-name">Name</label>
            <input id="i-name" value={d.name} onChange={(e) => set("name", e.target.value)} required autoFocus maxLength={80} />
          </div>
          <div className="field">
            <label htmlFor="i-url">Instance URL</label>
            <input id="i-url" type="url" value={d.url} onChange={(e) => set("url", e.target.value)} required placeholder="https://acme.service-now.com" />
          </div>
          <div className="field">
            <label htmlFor="i-env">Environment</label>
            <select id="i-env" value={d.env} onChange={(e) => set("env", e.target.value)}>
              {ENVS.map((x) => <option key={x} value={x}>{x}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="i-auth">Auth mode</label>
            <select id="i-auth" value={d.authMode} onChange={(e) => set("authMode", e.target.value)}>
              {AUTH_MODES.map((x) => <option key={x} value={x}>{x}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="i-cred">credentialRef (deploy)</label>
            <input id="i-cred" value={d.credentialRef} onChange={(e) => set("credentialRef", e.target.value)} required placeholder="acme-dev" maxLength={120} />
          </div>
          <div className="field">
            <label htmlFor="i-rocred">readOnlyCredentialRef</label>
            <input id="i-rocred" value={d.readOnlyCredentialRef} onChange={(e) => set("readOnlyCredentialRef", e.target.value)} placeholder="acme-dev-ro (optional)" maxLength={120} />
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button className="btn" type="submit" disabled={busy || !d.name || !d.url || !d.credentialRef}>
              {busy ? "Saving…" : "Save"}
            </button>
            <button className="btn ghost" type="button" onClick={onClose} disabled={busy}>Cancel</button>
          </div>
        </form>
      </div>
    </div>
  );
}
