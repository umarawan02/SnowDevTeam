import type { AgentRole, ArtifactType, StepStatus, TicketStatus } from "@/lib/constants";

// JSON-serialized shapes as returned by the API routes (dates are ISO strings).

export interface StepJson {
  id: string;
  role: AgentRole;
  order: number;
  status: StepStatus;
  output: string | null;
  error: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

export interface ArtifactJson {
  id: string;
  type: ArtifactType;
  content: string;
  createdAt: string;
}

export interface TicketJson {
  id: string;
  title: string;
  description: string;
  status: TicketStatus;
  reviewNote: string | null;
  reworkRound: number;
  reworkReason: string | null;
  requester: string | null;
  priority: string | null;
  category: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TicketDetailJson extends TicketJson {
  steps: StepJson[];
  artifacts: ArtifactJson[];
}

export interface TicketListItemJson {
  id: string;
  title: string;
  status: TicketStatus;
  priority: string | null;
  requester: string | null;
  category: string | null;
  reworkRound: number;
  createdAt: string;
  updatedAt: string;
  steps: { role: AgentRole; status: StepStatus; order: number }[];
}

export interface IntakeMessageJson {
  id: string;
  role: "user" | "assistant";
  content: string;
  ready: {
    title: string;
    description: string;
    priority: "LOW" | "MEDIUM" | "HIGH";
    category?: string;
    approvals: string[];
    targetUsers?: string;
  } | null;
  createdAt: string;
}

export interface IntakeConversationJson {
  id: string;
  title: string;
  status: string; // GATHERING | BUILDING
  ticketId: string | null;
  messages: IntakeMessageJson[];
}

export interface ConversationSummaryJson {
  id: string;
  title: string;
  status: string;
  ticketId: string | null;
}

export interface SessionUserJson {
  id: string;
  email: string;
  name: string | null;
  role: string;
  image: string | null;
}

export interface AdminUserJson {
  id: string;
  email: string;
  name: string | null;
  role: string;
  active: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  _count: { createdTickets: number; reviewedTickets: number };
}

export interface PersonaJson {
  id: string;
  role: AgentRole;
  name: string;
  title: string;
  tagline: string;
  bio: string;
  voice: string;
  accent: string;
  avatarSeed: string;
  model: string | null;
}
