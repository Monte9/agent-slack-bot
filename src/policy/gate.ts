import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Gate, GateDecision } from "../agent/types.js";

const WRITE_TOOLS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);

export interface GateContext {
  requester: string;
  isOwner: boolean;
  /** Paths no session may write through, such as the real and scoped memory directories. */
  protectedPaths: string[];
  auditPath: string;
}

function audit(auditPath: string, entry: Record<string, unknown>): void {
  mkdirSync(dirname(auditPath), { recursive: true });
  appendFileSync(auditPath, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`);
}

function touchesProtected(toolName: string, input: Record<string, unknown>, protectedPaths: string[]): boolean {
  const target = WRITE_TOOLS.has(toolName)
    ? String(input.file_path ?? input.notebook_path ?? "")
    : toolName === "Bash"
      ? String(input.command ?? "")
      : "";
  return target !== "" && protectedPaths.some((p) => target.includes(p));
}

/**
 * The policy gate. Today it enforces one rule for everyone: nothing writes to a
 * memory directory, because the scoped memory is symlinked to the real one.
 * Per-requester privileges land here next.
 */
export function createGate(context: GateContext): Gate {
  return ({ toolName, input }) => {
    let decision: GateDecision = { allow: true };
    if (touchesProtected(toolName, input, context.protectedPaths)) {
      decision = { allow: false, reason: "Memory is read-only from Slack. Ask the owner to update it from a desktop session." };
    }
    if (!decision.allow) {
      audit(context.auditPath, {
        requester: context.requester,
        owner: context.isOwner,
        tool: toolName,
        decision: "deny",
        reason: decision.reason,
        input: JSON.stringify(input).slice(0, 300),
      });
    }
    return decision;
  };
}

export function auditPathFor(stateDir: string): string {
  return join(stateDir, "audit.jsonl");
}
