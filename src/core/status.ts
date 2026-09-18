import type { TurnRunner } from "./turn.js";

function ago(date: Date | string): string {
  const ms = Date.now() - new Date(date).getTime();
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function statusText(runner: TurnRunner, adapterName: string): string {
  const session = runner.session;
  const lines = [
    `*adapter* ${adapterName}`,
    `*up since* ${runner.startedAt.toISOString()} (${ago(runner.startedAt)})`,
    `*queue* ${runner.depth} in flight or waiting`,
    `*shared memory* ${runner.sharedMemory.length} files`,
    `*workspace* \`${runner.workspace}\``,
  ];
  if (session) {
    lines.push(
      `*session* \`${session.sessionId}\``,
      `*model* ${session.model || "unknown"}`,
      `*turns* ${session.turns}, first ${ago(session.createdAt)}, last ${ago(session.lastTurnAt)}`,
      `*resume on desktop* \`claude --resume ${session.sessionId}\` from the workspace, after stopping the bot`,
    );
  } else {
    lines.push("*session* none yet; the next mention starts one");
  }
  return lines.join("\n");
}
