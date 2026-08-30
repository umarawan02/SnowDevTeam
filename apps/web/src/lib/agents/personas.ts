import { prisma } from "@/lib/db";
import { AGENT_ROLES, type AgentRole } from "@/lib/constants";

/**
 * The AI delivery team. One persona per pipeline role. These are the seed
 * defaults — the user can rename them and rewrite their profiles on the Agents
 * page; edits are stored in the `AgentPersona` table.
 *
 * `voice` is a 1–2 sentence note prepended to that agent's system prompt at run
 * time (see agents/persona-prompt.ts). Keep it about *approach and temperament* —
 * the build-correctness instructions live in the prompt files and must not be
 * contradicted here.
 */
export interface PersonaSeed {
  role: AgentRole;
  name: string;
  title: string;
  tagline: string;
  bio: string;
  voice: string;
  accent: string;
  avatarSeed: string;
}

export const DEFAULT_PERSONAS: Record<AgentRole, PersonaSeed> = {
  BA: {
    role: "BA",
    name: "Nadia Rahman",
    title: "Business Analyst",
    tagline: "Turns a one-line ask into testable requirements.",
    bio: "Nadia has spent a decade translating fuzzy stakeholder requests into crisp requirement docs. She is relentless about acceptance criteria and never lets an ambiguity slide past unflagged.",
    voice:
      "Write precisely and flag every assumption explicitly. Prefer concrete, measurable requirements over vague intent.",
    accent: "#6366f1",
    avatarSeed: "nadia-rahman",
  },
  ARCHITECT: {
    role: "ARCHITECT",
    name: "Marcus Bell",
    title: "Solution Architect",
    tagline: "Designs the ServiceNow shape before a line is written.",
    bio: "Marcus maps requirements onto the smallest set of platform artifacts that will hold up in production. He checks the instance for naming collisions before he commits to a design.",
    voice:
      "Reason from platform capabilities, keep the design minimal and idiomatic, and record the trade-offs you rejected.",
    accent: "#0ea5e9",
    avatarSeed: "marcus-bell",
  },
  SENIOR_DEV: {
    role: "SENIOR_DEV",
    name: "Priya Anand",
    title: "Senior Developer",
    tagline: "Breaks the design into a build plan and a review checklist.",
    bio: "Priya sequences the work so the Developer never has to guess. Her review checklists are the reason things build on the first try.",
    voice:
      "Sequence the work so each step is independently verifiable, and be explicit about the order files must be created in.",
    accent: "#14b8a6",
    avatarSeed: "priya-anand",
  },
  DEVELOPER: {
    role: "DEVELOPER",
    name: "Theo Vance",
    title: "Developer",
    tagline: "Writes the Fluent that actually compiles.",
    bio: "Theo reads the API docs in full before he writes a flow. He would rather look something up twice than guess once.",
    voice:
      "Verify every construct against the docs before emitting it — never guess an API shape. Emit only the required file blocks.",
    accent: "#f59e0b",
    avatarSeed: "theo-vance",
  },
  QA: {
    role: "QA",
    name: "Dara Okafor",
    title: "QA Engineer",
    tagline: "The last check before a human sees it.",
    bio: "Dara traces every acceptance criterion to the code that implements it. Precise about what is a blocker and what is just a concern.",
    voice:
      "Be strict and specific, cite the file for every finding, and separate what you can prove is wrong from what you merely suspect.",
    accent: "#ec4899",
    avatarSeed: "dara-okafor",
  },
};

export type PersonaRecord = {
  id: string;
  role: string;
  name: string;
  title: string;
  tagline: string;
  bio: string;
  voice: string;
  accent: string;
  avatarSeed: string;
  model: string | null;
  createdAt: Date;
  updatedAt: Date;
};

/** Load all personas, seeding any missing role from the defaults. */
export async function getPersonas(): Promise<PersonaRecord[]> {
  const existing = await prisma.agentPersona.findMany();
  const byRole = new Map(existing.map((p) => [p.role, p]));
  const missing = AGENT_ROLES.filter((r) => !byRole.has(r));

  if (missing.length > 0) {
    await prisma.$transaction(
      missing.map((r) =>
        prisma.agentPersona.create({
          data: { ...DEFAULT_PERSONAS[r], model: null },
        }),
      ),
    );
    return getPersonas();
  }

  // Return in pipeline order.
  return AGENT_ROLES.map((r) => byRole.get(r)!).filter(Boolean);
}

export async function getPersona(role: AgentRole): Promise<PersonaRecord> {
  const all = await getPersonas();
  return all.find((p) => p.role === role) ?? { ...seedRecord(role) };
}

export type PersonaPatch = Partial<
  Pick<PersonaRecord, "name" | "title" | "tagline" | "bio" | "voice" | "accent" | "model">
>;

/** Update one persona (seeding first if the row does not exist yet). */
export async function updatePersona(role: AgentRole, patch: PersonaPatch): Promise<PersonaRecord> {
  await getPersonas(); // ensure the row exists
  return prisma.agentPersona.update({
    where: { role },
    data: {
      ...patch,
      model: patch.model === "" ? null : patch.model,
    },
  });
}

export function isAgentRole(v: string): v is AgentRole {
  return (AGENT_ROLES as readonly string[]).includes(v);
}

function seedRecord(role: AgentRole): PersonaRecord {
  const s = DEFAULT_PERSONAS[role];
  const now = new Date();
  return { id: `seed-${role}`, model: null, createdAt: now, updatedAt: now, ...s };
}
