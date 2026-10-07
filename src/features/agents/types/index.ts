import type {
  ResponseStyle,
  PromptGuardrails,
} from "@/features/inbox/services/prompt-builder";

export type AgentType = "setter" | "soporte" | "agendamiento";

export interface AgentConfig {
  /** Optional per-agent generation tuning. */
  temperature?: number;
  maxTokens?: number;
  /** Opt-in v1.5 features. */
  autoTag?: boolean;
  summarize?: boolean;
  /** Verbosity of replies; "balanced" when unset. */
  responseStyle?: ResponseStyle;
  /** Pause the AI when a human sends a manual message (default true). */
  sleepOnManualMessage?: boolean;
  /**
   * Search the workspace Knowledge Base on every turn (default true). Off:
   * the agent answers from its prompt only — fewer tokens per reply, and no
   * stale document can contradict the prompt. The documents are kept.
   */
  useKnowledgeBase?: boolean;
  /** config is open JSON; allow arbitrary extra keys. */
  [key: string]: unknown;
}

/** A configured agent (one row in the `agents` table). */
export interface Agent {
  id: string;
  workspaceId: string;
  type: AgentType;
  name: string;
  avatarKey: string;
  /** OpenRouter model id; null → fall back to the workspace integration model. */
  model: string | null;
  isActive: boolean;
  promptId: string | null;
  config: AgentConfig;
  createdAt: string;
  updatedAt: string;
}

/** Shape returned by the agents API to client components. */
export interface AgentDto {
  id: string;
  type: AgentType;
  name: string;
  avatarKey: string;
  model: string | null;
  isActive: boolean;
  promptId: string | null;
  /** Body of the agent's currently published prompt version. */
  promptBody: string;
  /** Rules/restrictions of the agent's published prompt version. */
  promptGuardrails: PromptGuardrails | null;
  config: AgentConfig;
}

/** Minimal shape used by the runtime to resolve model + prompt. */
export interface ActiveAgent {
  id: string;
  type: AgentType;
  name: string;
  avatarKey: string;
  model: string | null;
  promptId: string | null;
  config: AgentConfig;
}
