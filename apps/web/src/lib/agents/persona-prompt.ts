import type { AgentRole } from "@/lib/constants";
import { systemPromptFor } from "@/lib/agents/prompts";
import { ROLE_CONFIG } from "@/lib/agents/roles";
import { getPersona } from "@/lib/agents/personas";

export interface ResolvedAgent {
  systemPrompt: string;
  /**
   * Effective model: a persona override wins, else the role's default tier
   * (roles.ts), else undefined → config.ANTHROPIC_MODEL.
   */
  model?: string;
  personaName: string;
}

export interface ResolveOpts {
  /** Native-tier ticket → the native prompt set (NATIVE_ENGINE_BRIEF §7.3). */
  native?: boolean;
  /** The `{{PROJECT_CONTEXT}}` block (project-context.ts) — prepended verbatim. */
  projectContext?: string;
}

/**
 * Compose the runtime system prompt for a pipeline stage: the persona's
 * name + voice note, the per-ticket Project context block, then the role's
 * full prompt (native or Fluent variant) from the .md files.
 *
 * The persona preamble is deliberately short and about *approach*, never
 * build correctness — the .md prompt bodies remain the source of truth.
 */
export async function resolveAgent(role: AgentRole, opts: ResolveOpts = {}): Promise<ResolvedAgent> {
  const p = await getPersona(role);
  const voice = p.voice?.trim();
  const preamble =
    `You are ${p.name}, ${p.title} on an AI ServiceNow delivery team.` +
    (voice ? ` ${voice}` : "");

  const parts = [preamble];
  if (opts.projectContext?.trim()) parts.push(opts.projectContext.trim());
  parts.push(systemPromptFor(role, { native: !!opts.native }));

  return {
    systemPrompt: parts.join("\n\n---\n\n"),
    model: p.model ?? ROLE_CONFIG[role].model ?? undefined,
    personaName: p.name,
  };
}
