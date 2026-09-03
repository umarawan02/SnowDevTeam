"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Markdown } from "@/components/Markdown";
import { StarterOrb } from "./StarterOrb";
import { IconArrow, IconPlus } from "@/components/app/icons";
import type { IntakeConversationJson, IntakeMessageJson } from "@/lib/types";

const STARTERS = [
  "Employees need to request a monitor, with manager approval, fulfilled by IT Ops.",
  "Staff need to request access to a SaaS tool — manager approval, then the owning team grants it.",
  "New hires need a welcome kit ordered — HR raises it, manager approves, Facilities fulfils.",
  "Employees need to book a desk move handled by Facilities at their office location.",
];

type Msg = IntakeMessageJson & { streaming?: boolean };

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

export function IntakeChat({
  conversation,
  userName,
}: {
  conversation: IntakeConversationJson;
  userName: string;
}) {
  const router = useRouter();
  const [messages, setMessages] = useState<Msg[]>(conversation.messages);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [building, setBuilding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const building_status = conversation.status === "BUILDING";

  const lastReady = [...messages].reverse().find((m) => m.ready)?.ready ?? null;
  const canBuild = !building_status && messages.some((m) => m.role === "assistant");

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  async function send(text: string) {
    const content = text.trim();
    if (!content || sending || building_status) return;
    setError(null);
    setSending(true);
    setInput("");

    const userMsg: Msg = { id: `u-${Date.now()}`, role: "user", content, ready: null, createdAt: new Date().toISOString() };
    const aiMsg: Msg = { id: `a-${Date.now()}`, role: "assistant", content: "", ready: null, createdAt: new Date().toISOString(), streaming: true };
    setMessages((m) => [...m, userMsg, aiMsg]);

    try {
      const res = await fetch(`/api/intake/${conversation.id}/message`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content }),
      });
      if (!res.ok || !res.body) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error ?? `Request failed (${res.status})`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let raw = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        raw += decoder.decode(value, { stream: true });
        const { visible, ready } = clientStrip(raw);
        setMessages((m) =>
          m.map((x) => (x.id === aiMsg.id ? { ...x, content: visible, ready } : x)),
        );
      }
      setMessages((m) => m.map((x) => (x.id === aiMsg.id ? { ...x, streaming: false } : x)));
    } catch (e) {
      setMessages((m) =>
        m.map((x) => (x.id === aiMsg.id ? { ...x, content: "_(the assistant hit an error — please try again)_", streaming: false } : x)),
      );
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  }

  async function startBuild() {
    if (building || building_status) return;
    setBuilding(true);
    setError(null);
    try {
      const res = await fetch(`/api/intake/${conversation.id}/build`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `Failed (${res.status})`);
      router.push(`/tickets/${data.ticketId}`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBuilding(false);
    }
  }

  const empty = messages.length === 0;

  return (
    <div className="chat">
      {!empty && (
        <header className="chat-head">
          <div className="chat-title">{conversation.title}</div>
          {canBuild && (
            <button className="btn sm chat-build" type="button" disabled={building} onClick={startBuild}>
              {building ? "Starting…" : "Start development"}
              <IconArrow />
            </button>
          )}
        </header>
      )}

      {building_status && (
        <div className="chat-banner">
          Development has started for this request.
          {conversation.ticketId && (
            <Link href={`/tickets/${conversation.ticketId}`}>Open the run →</Link>
          )}
        </div>
      )}

      <div className="chat-scroll" ref={scrollRef}>
        {empty ? (
          <div className="chat-empty">
            <StarterOrb />
            <h1>
              {greeting()}, {firstName(userName)}
            </h1>
            <p>Tell me what you need built in ServiceNow and I&rsquo;ll turn it into a request.</p>
            <div className="starter-grid">
              {STARTERS.map((s) => (
                <button key={s} type="button" className="starter-chip" onClick={() => send(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="chat-list">
            {messages.map((m) => (
              <div key={m.id} className={`msg ${m.role}`}>
                {m.role === "assistant" && (
                  <span className="msg-orb">
                    <StarterOrb size={26} />
                  </span>
                )}
                <div className="msg-body">
                  {m.role === "assistant" ? (
                    m.content ? (
                      <Markdown source={m.content} />
                    ) : (
                      <span className="msg-typing">
                        <i /><i /><i />
                      </span>
                    )
                  ) : (
                    <p>{m.content}</p>
                  )}
                  {m.ready && !building_status && (
                    <ReadyCard ready={m.ready} onBuild={startBuild} building={building} />
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="composer-wrap">
        <form
          className="composer"
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
        >
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(input);
              }
            }}
            placeholder={building_status ? "This conversation has moved to development" : "Describe what you need…"}
            rows={1}
            disabled={building_status}
          />
          <div className="composer-row">
            <button type="button" className="composer-ic" tabIndex={-1} aria-hidden>
              <IconPlus />
            </button>
            <span className="composer-src">ServiceNow intake</span>
            <span style={{ flex: 1 }} />
            <button
              type="submit"
              className="composer-send"
              disabled={!input.trim() || sending || building_status}
              aria-label="Send"
            >
              <IconArrow />
            </button>
          </div>
        </form>
        {error && <p className="formerr" style={{ textAlign: "center", marginTop: 8 }}>{error}</p>}
        {!lastReady && !empty && !building_status && (
          <p className="composer-hint">A human still reviews everything before it ships.</p>
        )}
      </div>
    </div>
  );
}

function ReadyCard({
  ready,
  onBuild,
  building,
}: {
  ready: NonNullable<IntakeMessageJson["ready"]>;
  onBuild: () => void;
  building: boolean;
}) {
  return (
    <div className="ready-card">
      <div className="ready-head">
        <span className="ready-dot" />
        Ready to build
      </div>
      <div className="ready-title">{ready.title}</div>
      <dl className="ready-meta">
        <div><dt>Priority</dt><dd>{cap(ready.priority)}</dd></div>
        {ready.category && <div><dt>Category</dt><dd>{ready.category}</dd></div>}
        <div><dt>Approvals</dt><dd>{ready.approvals.length ? ready.approvals.join(", ") : "None"}</dd></div>
        {ready.targetUsers && <div><dt>Requestable by</dt><dd>{ready.targetUsers}</dd></div>}
        <div><dt>Scope</dt><dd>{ready.targetScope === "scoped" ? "Scoped app" : "Global"}</dd></div>
      </dl>
      <button className="btn ready-go" type="button" disabled={building} onClick={onBuild}>
        {building ? "Starting the pipeline…" : "Start development"}
        <IconArrow />
      </button>
    </div>
  );
}

function firstName(s: string) {
  return s.split(/[\s@.]+/)[0] || s;
}
function cap(s: string) {
  return s.charAt(0) + s.slice(1).toLowerCase();
}

// Client-side mirror of extractReadyBlock (kept tiny to avoid importing server code).
function clientStrip(text: string): { visible: string; ready: IntakeMessageJson["ready"] } {
  const full = /<intake-ready>\s*([\s\S]*?)\s*<\/intake-ready>/i.exec(text);
  const visible = text
    .replace(/<intake-ready>\s*[\s\S]*?\s*<\/intake-ready>/i, "")
    .replace(/<intake-ready>[\s\S]*$/i, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!full) return { visible, ready: null };
  try {
    const raw = JSON.parse(full[1]);
    if (raw.title && raw.description) {
      return {
        visible,
        ready: {
          title: String(raw.title),
          description: String(raw.description),
          priority: ["LOW", "MEDIUM", "HIGH"].includes(raw.priority) ? raw.priority : "MEDIUM",
          category: raw.category ? String(raw.category) : undefined,
          approvals: Array.isArray(raw.approvals) ? raw.approvals.map(String) : [],
          targetUsers: raw.targetUsers ? String(raw.targetUsers) : undefined,
          targetScope: raw.targetScope === "scoped" ? "scoped" : "global",
        },
      };
    }
  } catch {
    /* partial JSON mid-stream */
  }
  return { visible, ready: null };
}
