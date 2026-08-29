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
  createdAt: string;
  updatedAt: string;
  steps: { role: AgentRole; status: StepStatus; order: number }[];
}
