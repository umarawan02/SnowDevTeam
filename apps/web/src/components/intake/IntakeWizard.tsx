"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { IconArrow } from "@/components/app/icons";

const QUICK_STARTS: { label: string; category: string; seed: string }[] = [
  {
    label: "Hardware request",
    category: "Hardware",
    seed: "Employees need to request a [device] with manager approval. Once approved, create a fulfillment task for IT Ops to procure and hand it over.",
  },
  {
    label: "Access request",
    category: "Software / Access",
    seed: "Employees need to request access to [system]. Requires manager approval, then a fulfillment task for the owning team to grant access.",
  },
  {
    label: "Onboarding task",
    category: "Onboarding",
    seed: "When a new hire starts, HR needs to request [item/setup]. Manager approves, then a task is created for the responsible team.",
  },
  {
    label: "Facilities request",
    category: "Facilities",
    seed: "Employees need to request [item] from Facilities. Manager approval, then a fulfillment task for the Facilities team at the requester's office location.",
  },
];

const PRIORITIES = ["LOW", "MEDIUM", "HIGH"] as const;
const APPROVALS = ["Manager", "Security", "Finance"];
const CATEGORIES = ["Hardware", "Software / Access", "Onboarding", "Facilities", "Other"];

export function IntakeWizard() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [need, setNeed] = useState("");
  const [title, setTitle] = useState("");
  const [titleTouched, setTitleTouched] = useState(false);
  const [requester, setRequester] = useState("");
  const [priority, setPriority] = useState<(typeof PRIORITIES)[number]>("MEDIUM");
  const [category, setCategory] = useState("");
  const [approvals, setApprovals] = useState<string[]>(["Manager"]);
  const [targetUsers, setTargetUsers] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const suggestedTitle = useMemo(() => {
    const first = need.trim().split(/[.\n]/)[0].trim();
    return first.length > 6 ? first.slice(0, 90) : "";
  }, [need]);
  const effectiveTitle = titleTouched ? title : title || suggestedTitle;

  function toggleApproval(a: string) {
    setApprovals((s) => (s.includes(a) ? s.filter((x) => x !== a) : [...s, a]));
  }

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/tickets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: effectiveTitle.trim(),
          description: need.trim(),
          requester: requester.trim() || undefined,
          priority,
          category: category || undefined,
          approvals: approvals.length ? approvals : undefined,
          targetUsers: targetUsers.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error ?? `Request failed (${res.status})`);
      }
      const { id } = await res.json();
      router.push(`/tickets/${id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSubmitting(false);
    }
  }

  const canNext = step === 0 ? need.trim().length > 12 : step === 1 ? effectiveTitle.trim().length > 3 : true;

  return (
    <div className="wiz glass panel">
      <ol className="wiz-steps">
        {["What you need", "Details", "Review"].map((s, i) => (
          <li key={s} className={i === step ? "on" : i < step ? "done" : ""}>
            <span className="n">{i < step ? "✓" : i + 1}</span>
            {s}
          </li>
        ))}
      </ol>

      {step === 0 && (
        <div className="wiz-body">
          <div className="field">
            <label htmlFor="w-need">Describe the request in plain language</label>
            <textarea
              id="w-need"
              value={need}
              onChange={(e) => setNeed(e.target.value)}
              placeholder="Employees need to request…"
              maxLength={10000}
              style={{ minHeight: 130 }}
              autoFocus
            />
          </div>
          <div className="wiz-quick">
            <span className="ql">Start from a template:</span>
            {QUICK_STARTS.map((q) => (
              <button
                key={q.label}
                type="button"
                className="chip"
                onClick={() => {
                  setNeed(q.seed);
                  setCategory(q.category);
                }}
              >
                {q.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {step === 1 && (
        <div className="wiz-body">
          <div className="field">
            <label htmlFor="w-title">Title</label>
            <input
              id="w-title"
              value={titleTouched ? title : title || suggestedTitle}
              onChange={(e) => {
                setTitleTouched(true);
                setTitle(e.target.value);
              }}
              maxLength={200}
            />
          </div>
          <div className="row2">
            <div className="field">
              <label htmlFor="w-req">Requester</label>
              <input
                id="w-req"
                value={requester}
                onChange={(e) => setRequester(e.target.value)}
                placeholder="Your name or team"
                maxLength={120}
              />
            </div>
            <div className="field">
              <label htmlFor="w-cat">Category</label>
              <select id="w-cat" value={category} onChange={(e) => setCategory(e.target.value)} className="wiz-select">
                <option value="">Not sure</option>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="field">
            <label>Priority</label>
            <div className="seg">
              {PRIORITIES.map((p) => (
                <button
                  key={p}
                  type="button"
                  className={priority === p ? "on" : ""}
                  onClick={() => setPriority(p)}
                >
                  {p[0] + p.slice(1).toLowerCase()}
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <label>Approvals expected</label>
            <div className="wiz-quick">
              {APPROVALS.map((a) => (
                <button
                  key={a}
                  type="button"
                  className={`chip${approvals.includes(a) ? " accent" : ""}`}
                  aria-pressed={approvals.includes(a)}
                  onClick={() => toggleApproval(a)}
                >
                  {a}
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <label htmlFor="w-users">Who can request this?</label>
            <input
              id="w-users"
              value={targetUsers}
              onChange={(e) => setTargetUsers(e.target.value)}
              placeholder="e.g. all employees, US staff only"
              maxLength={200}
            />
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="wiz-body">
          <div className="wiz-review">
            <Row k="Title" v={effectiveTitle} />
            <Row k="Request" v={need} pre />
            <Row k="Requester" v={requester || "—"} />
            <Row k="Priority" v={priority[0] + priority.slice(1).toLowerCase()} />
            <Row k="Category" v={category || "Not specified"} />
            <Row k="Approvals" v={approvals.join(", ") || "None"} />
            <Row k="Requestable by" v={targetUsers || "Not specified"} />
          </div>
          <p className="wiz-note">
            Submitting starts the five-agent pipeline — about 15–25 minutes and roughly
            $0.30–1.00. Nothing deploys until you approve it at the review gate.
          </p>
          {error && <p className="formerr">{error}</p>}
        </div>
      )}

      <div className="wiz-nav">
        {step > 0 && (
          <button className="btn ghost" type="button" onClick={() => setStep(step - 1)} disabled={submitting}>
            Back
          </button>
        )}
        <span style={{ flex: 1 }} />
        {step < 2 ? (
          <button className="btn" type="button" onClick={() => setStep(step + 1)} disabled={!canNext}>
            Continue <IconArrow />
          </button>
        ) : (
          <button className="btn" type="button" onClick={submit} disabled={submitting}>
            {submitting ? "Starting…" : "Start the pipeline"}
          </button>
        )}
      </div>
    </div>
  );
}

function Row({ k, v, pre }: { k: string; v: string; pre?: boolean }) {
  return (
    <div className="wiz-row">
      <span className="rk">{k}</span>
      <span className={`rv${pre ? " pre" : ""}`}>{v}</span>
    </div>
  );
}
