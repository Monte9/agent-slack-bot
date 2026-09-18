import { query, type Options } from "@anthropic-ai/claude-agent-sdk";
import type { AgentAdapter, RunRequest, RunResult, RunStats } from "./types.js";

const RESUME_FAILED = /no conversation found|session.*not found|could not resume/i;

function summarizeInput(name: string, input: Record<string, unknown>): string {
  const candidate = input.command ?? input.file_path ?? input.pattern ?? input.query ?? input.url ?? input.prompt;
  const text = typeof candidate === "string" ? candidate : "";
  return text.length > 80 ? `${text.slice(0, 77)}...` : text || name;
}

export function createClaudeAdapter(options: { model: string | null }): AgentAdapter {
  async function runOnce(request: RunRequest, sessionId: string | undefined): Promise<RunResult> {
    const sdkOptions: Options = {
      cwd: request.cwd,
      additionalDirectories: request.additionalDirectories,
      settingSources: ["user", "project"],
      // Never inherit the owner's desktop permission mode; the gate is the only policy here.
      permissionMode: "default",
      systemPrompt: { type: "preset", preset: "claude_code", append: request.systemPromptAppend },
      // Runs on every tool call, before allow rules, so a denial cannot be bypassed by settings.
      hooks: {
        PreToolUse: [
          {
            hooks: [
              async (input) => {
                if (input.hook_event_name !== "PreToolUse") return {};
                const decision = request.gate({
                  toolName: input.tool_name,
                  input: (input.tool_input ?? {}) as Record<string, unknown>,
                });
                if (decision.allow) return {};
                return {
                  hookSpecificOutput: {
                    hookEventName: "PreToolUse",
                    permissionDecision: "deny",
                    permissionDecisionReason: decision.reason,
                  },
                };
              },
            ],
          },
        ],
      },
      // Runs only for calls that would otherwise prompt a human; the gate answers instead.
      canUseTool: async (toolName, input) => {
        const decision = request.gate({ toolName, input });
        return decision.allow
          ? { behavior: "allow", updatedInput: input }
          : { behavior: "deny", message: decision.reason };
      },
      stderr: (text) => request.onEvent({ type: "stderr", text }),
    };
    if (sessionId) sdkOptions.resume = sessionId;
    if (options.model) sdkOptions.model = options.model;

    let resolvedSessionId = sessionId ?? "";
    let collected = "";
    let finalText: string | undefined;
    let isError = false;
    const stats: RunStats = { durationMs: 0, costUsd: 0, toolCalls: 0, inputTokens: 0, outputTokens: 0 };

    for await (const message of query({ prompt: request.prompt, options: sdkOptions })) {
      if (message.type === "system" && message.subtype === "init") {
        resolvedSessionId = message.session_id;
        request.onEvent({
          type: "init",
          sessionId: message.session_id,
          model: message.model,
          credential: message.apiKeySource,
        });
      } else if (message.type === "assistant") {
        for (const block of message.message.content) {
          if (block.type === "text") {
            collected += block.text;
            request.onEvent({ type: "text", text: block.text });
          } else if (block.type === "tool_use") {
            stats.toolCalls += 1;
            const input = (block.input ?? {}) as Record<string, unknown>;
            request.onEvent({ type: "tool", name: block.name, summary: summarizeInput(block.name, input) });
          }
        }
      } else if (message.type === "result") {
        resolvedSessionId = message.session_id;
        stats.durationMs = message.duration_ms;
        stats.costUsd = message.total_cost_usd;
        stats.inputTokens =
          message.usage.input_tokens + (message.usage.cache_read_input_tokens ?? 0) + (message.usage.cache_creation_input_tokens ?? 0);
        stats.outputTokens = message.usage.output_tokens;
        if (message.subtype === "success") {
          finalText = message.result;
          isError = message.is_error;
        } else {
          isError = true;
          finalText = `The agent stopped early (${message.subtype}): ${message.errors.join("; ")}`;
        }
      }
    }

    return {
      sessionId: resolvedSessionId,
      text: finalText ?? collected,
      isError,
      rotated: false,
      stats,
    };
  }

  return {
    name: "claude",
    capabilities: { toolGating: "per-tool" },
    async run(request) {
      try {
        return await runOnce(request, request.sessionId);
      } catch (error) {
        const text = error instanceof Error ? error.message : String(error);
        if (request.sessionId && RESUME_FAILED.test(text)) {
          const fresh = await runOnce(request, undefined);
          return { ...fresh, rotated: true };
        }
        throw error;
      }
    },
  };
}
