/**
 * The runtime-agnostic contract. Core owns Slack, the session file, memory scoping,
 * the policy gate and the audit log. An adapter owns one agent runtime.
 */

export type GateDecision = { allow: true } | { allow: false; reason: string };

export type Gate = (request: { toolName: string; input: Record<string, unknown> }) => GateDecision;

export type AgentEvent =
  | { type: "init"; sessionId: string; model: string; credential: string }
  | { type: "text"; text: string }
  | { type: "tool"; name: string; summary: string }
  | { type: "phase"; name: "thinking" | "revising" }
  | { type: "stderr"; text: string };

export interface RunRequest {
  prompt: string;
  /** The generated workspace. Memory and the transcript key off this path. */
  cwd: string;
  /** Directories the agent may also read and edit, normally the project repo. */
  additionalDirectories: string[];
  /** Resume this session; omit to start a new one. */
  sessionId?: string;
  systemPromptAppend: string;
  gate: Gate;
  onEvent: (event: AgentEvent) => void;
}

export interface RunStats {
  durationMs: number;
  /** Cost at API list prices. On a subscription it is a proxy for usage, not a charge. */
  costUsd: number;
  toolCalls: number;
  /** Summed over every API request in the run, so it grows with tool calls as well as with context. */
  inputTokens: number;
  outputTokens: number;
  /** Input tokens of the last API request: the context the session carries into its next turn. */
  contextTokens: number;
}

export interface RunResult {
  sessionId: string;
  text: string;
  isError: boolean;
  /** True when the requested session could not be resumed and a fresh one was started. */
  rotated: boolean;
  stats: RunStats;
}

export function addStats(a: RunStats, b: RunStats): RunStats {
  return {
    durationMs: a.durationMs + b.durationMs,
    costUsd: a.costUsd + b.costUsd,
    toolCalls: a.toolCalls + b.toolCalls,
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    // The later run resumed the same session, so its context is the current one; not a sum.
    contextTokens: b.contextTokens || a.contextTokens,
  };
}

export interface AgentAdapter {
  name: string;
  capabilities: {
    /** "per-tool" runtimes call the gate for every tool. "runtime" ones can only be sandboxed as a whole. */
    toolGating: "per-tool" | "runtime";
  };
  run(request: RunRequest): Promise<RunResult>;
}
