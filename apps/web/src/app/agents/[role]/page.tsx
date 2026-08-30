import Link from "next/link";
import { notFound } from "next/navigation";
import { config } from "@/lib/config";
import { getPersona, isAgentRole } from "@/lib/agents/personas";
import { AgentEditor } from "@/components/agents/AgentEditor";
import type { PersonaJson } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function AgentEditPage({ params }: { params: Promise<{ role: string }> }) {
  const { role } = await params;
  const upper = role.toUpperCase();
  if (!isAgentRole(upper)) notFound();

  const persona = await getPersona(upper);
  const json = JSON.parse(JSON.stringify(persona)) as PersonaJson;

  return (
    <div className="page">
      <p className="crumb">
        <Link href="/agents">← All agents</Link>
      </p>
      <div className="pagehead">
        <div className="grow">
          <h1 className="h1">Edit {persona.title}</h1>
          <p className="lede">Changes take effect on the next pipeline run.</p>
        </div>
      </div>
      <AgentEditor persona={json} defaultModelLabel={config.ANTHROPIC_MODEL} />
    </div>
  );
}
