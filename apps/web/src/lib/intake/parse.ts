/**
 * Pulls the machine-readable `<intake-ready>{…}</intake-ready>` block out of an
 * assistant message. Never throws — a malformed block just yields `ready: null`.
 */

export interface IntakeReady {
  title: string;
  description: string;
  priority: "LOW" | "MEDIUM" | "HIGH";
  category?: string;
  approvals: string[];
  targetUsers?: string;
  /** "global" (default) or "scoped" — where the pipeline builds it. */
  targetScope: "global" | "scoped";
}

const BLOCK_RE = /<intake-ready>\s*([\s\S]*?)\s*<\/intake-ready>/i;
const DANGLING_RE = /<intake-ready>[\s\S]*$/i; // an unterminated block mid-stream

export function extractReadyBlock(text: string): { visible: string; ready: IntakeReady | null } {
  const m = text.match(BLOCK_RE);
  const visible = text
    .replace(BLOCK_RE, "")
    .replace(DANGLING_RE, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!m) return { visible, ready: null };

  let ready: IntakeReady | null = null;
  try {
    const raw = JSON.parse(m[1]) as Record<string, unknown>;
    const title = String(raw.title ?? "").trim();
    const description = String(raw.description ?? "").trim();
    if (title && description) {
      const priority = ["LOW", "MEDIUM", "HIGH"].includes(String(raw.priority))
        ? (raw.priority as IntakeReady["priority"])
        : "MEDIUM";
      ready = {
        title: title.slice(0, 200),
        description: description.slice(0, 8000),
        priority,
        category: raw.category ? String(raw.category).slice(0, 80) : undefined,
        approvals: Array.isArray(raw.approvals)
          ? raw.approvals.map((a) => String(a).slice(0, 60)).slice(0, 8)
          : [],
        targetUsers: raw.targetUsers ? String(raw.targetUsers).slice(0, 200) : undefined,
        targetScope: String(raw.targetScope) === "scoped" ? "scoped" : "global",
      };
    }
  } catch {
    /* malformed — leave ready null */
  }
  return { visible, ready };
}
