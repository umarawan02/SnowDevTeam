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

const GROUNDING = read("grounding.md");

const ROLE_PROMPT_FILE: Record<AgentRole, string> = {
  BA: "business-analyst.md",
  ARCHITECT: "architect.md",
  SENIOR_DEV: "senior-developer.md",
  DEVELOPER: "developer.md",
  QA: "qa.md",
};

// The Architect / Senior Dev / Developer get the curated now-sdk grounding
// prepended; they also have the live `explain`/`query` tools for specifics.
const ROLES_WITH_GROUNDING: ReadonlySet<AgentRole> = new Set(["ARCHITECT", "SENIOR_DEV", "DEVELOPER"]);

export const SYSTEM_PROMPTS: Record<AgentRole, string> = Object.fromEntries(
  (Object.keys(ROLE_PROMPT_FILE) as AgentRole[]).map((role) => {
    const rolePrompt = read(ROLE_PROMPT_FILE[role]);
    const full = ROLES_WITH_GROUNDING.has(role)
      ? `${rolePrompt}\n\n---\n\n# Appendix: ${GROUNDING}`
      : rolePrompt;
    return [role, full];
  }),
) as Record<AgentRole, string>;
