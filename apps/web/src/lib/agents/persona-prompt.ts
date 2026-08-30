import type { AgentRole } from "@/lib/constants";
import { SYSTEM_PROMPTS } from "@/lib/agents/prompts";
import { getPersona } from "@/lib/agents/personas";

export interface ResolvedAgent {
  systemPrompt: string;
  /** Persona model override, or undefined to use config.ANTHROPIC_MODEL. */
  model?: string;
  personaName: string;
}

/**
 * Compose the runtime system prompt for a pipeline stage: the persona's
 * name + voice note, then the role's full prompt from the .md files.
 *
 * The persona preamble is deliberately short and about *approach*, never
 * build correctness — the .md prompt bodies remain the source of truth and
 * are appended verbatim.
 */
export async function resolveAgent(role: AgentRole): Promise<ResolvedAgent> {
  const p = await getPersona(role);
  const voice = p.voice?.trim();
  const preamble =
    `You are ${p.name}, ${p.title} on an AI ServiceNow delivery team.` +
    (voice ? ` ${voice}` : "");

  return {
    systemPrompt: `${preamble}\n\n---\n\n${SYSTEM_PROMPTS[role]}`,
    model: p.model ?? undefined,
    personaName: p.name,
  };
}
