import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentRole } from "@/lib/constants";

// Prompt sources are plain Markdown files in this directory so they're easy to
// read and iterate on. They're loaded once at module init (server-side only).
const PROMPT_DIR = (() => {
  const candidates = [
    path.join(process.cwd(), "src", "lib", "agents", "prompts"),
    (() => {
      try {
        return path.dirname(fileURLToPath(import.meta.url));
      } catch {
        return "";
      }
    })(),
  ].filter(Boolean);
  const found = candidates.find((d) => fs.existsSync(path.join(d, "grounding.md")));
  if (!found) {
    throw new Error(`Could not locate agent prompt files. Looked in:\n${candidates.join("\n")}`);
  }
  return found;
})();

function read(name: string): string {
  return fs.readFileSync(path.join(PROMPT_DIR, name), "utf8").trim();
}

const GROUNDING_FLUENT = read("grounding.md");
const GROUNDING_NATIVE = read("grounding-native.md");

const ROLE_PROMPT_FILE: Record<AgentRole, string> = {
  BA: "business-analyst.md",
  ARCHITECT: "architect.md",
  SENIOR_DEV: "senior-developer.md",
  DEVELOPER: "developer.md",
  QA: "qa.md",
};

/** The Developer's native-tier prompt replaces developer.md entirely. */
const DEVELOPER_NATIVE = read("developer-native.md");

// Architect / Senior Dev / Developer get a grounding appendix; the flavour
// depends on the ticket's tier (native vs Fluent).
const ROLES_WITH_GROUNDING: ReadonlySet<AgentRole> = new Set(["ARCHITECT", "SENIOR_DEV", "DEVELOPER"]);

function compose(role: AgentRole, native: boolean): string {
  const rolePrompt = role === "DEVELOPER" && native ? DEVELOPER_NATIVE : read(ROLE_PROMPT_FILE[role]);
  if (!ROLES_WITH_GROUNDING.has(role)) return rolePrompt;
  const grounding = native ? GROUNDING_NATIVE : GROUNDING_FLUENT;
  return `${rolePrompt}\n\n---\n\n# Appendix: ${grounding}`;
}

const FLUENT_PROMPTS = Object.fromEntries(
  (Object.keys(ROLE_PROMPT_FILE) as AgentRole[]).map((r) => [r, compose(r, false)]),
) as Record<AgentRole, string>;

const NATIVE_PROMPTS = Object.fromEntries(
  (Object.keys(ROLE_PROMPT_FILE) as AgentRole[]).map((r) => [r, compose(r, true)]),
) as Record<AgentRole, string>;

/** The Fluent-tier prompt set (kept as the default export name for callers). */
export const SYSTEM_PROMPTS: Record<AgentRole, string> = FLUENT_PROMPTS;

/** Tier-aware prompt lookup (NATIVE_ENGINE_BRIEF §7.3). */
export function systemPromptFor(role: AgentRole, opts: { native: boolean }): string {
  return opts.native ? NATIVE_PROMPTS[role] : FLUENT_PROMPTS[role];
}
