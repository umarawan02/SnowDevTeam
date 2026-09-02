import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { config } from "@/lib/config";
import { getPersona, isAgentRole } from "@/lib/agents/personas";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canEditAgents } from "@/lib/auth/rbac";
import { ROLE_CONFIG } from "@/lib/agents/roles";
import { modelLabel } from "@/lib/agents/models";
import { AgentEditor } from "@/components/agents/AgentEditor";
import type { PersonaJson } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function AgentEditPage({ params }: { params: Promise<{ role: string }> }) {
  if (!canEditAgents(await getCurrentUser())) redirect("/agents");

  const { role } = await params;
  const upper = role.toUpperCase();
  if (!isAgentRole(upper)) notFound();

  const persona = await getPersona(upper);
  const json = JSON.parse(JSON.stringify(persona)) as PersonaJson;
  const roleDefaultModel = ROLE_CONFIG[upper].model ?? config.ANTHROPIC_MODEL;

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
      <AgentEditor persona={json} defaultModelLabel={modelLabel(roleDefaultModel)} />
    </div>
  );
}
