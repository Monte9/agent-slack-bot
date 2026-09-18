/** Slack caps a section block's text at 3000 characters. */
const SLACK_LIMIT = 2900;

function tokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(n);
}

/** The small grey line under a reply: `1m 19s · 25 tool calls · 52k in / 1.1k out · ~$0.41 at API rates`. */
export function statsLine(s: { durationMs: number; toolCalls: number; inputTokens: number; outputTokens: number; costUsd: number }): string {
  const seconds = Math.round(s.durationMs / 1000);
  const time = seconds >= 60 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${seconds}s`;
  const calls = `${s.toolCalls} tool call${s.toolCalls === 1 ? "" : "s"}`;
  return `${time} · ${calls} · ${tokens(s.inputTokens)} in / ${tokens(s.outputTokens)} out · ~$${s.costUsd.toFixed(2)} at API rates`;
}

/** Words outside code fences. Code is not prose and should not count against the cap. */
export function wordCount(text: string): number {
  const prose = text.replace(/```[\s\S]*?```/g, " ");
  return prose.split(/\s+/).filter((w) => /\w/.test(w)).length;
}

/** Convert the markdown an agent writes into Slack mrkdwn. Code blocks pass through untouched. */
export function toMrkdwn(markdown: string): string {
  const parts = markdown.split(/(```[\s\S]*?```)/g);
  return parts
    .map((part, i) => {
      if (i % 2 === 1) return part;
      return part
        .replace(/^#{1,6}\s+(.+)$/gm, "*$1*")
        .replace(/\*\*(.+?)\*\*/g, "*$1*")
        .replace(/__(.+?)__/g, "_$1_")
        .replace(/~~(.+?)~~/g, "~$1~")
        .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, "<$2|$1>")
        .replace(/^(\s*)[-*]\s+/gm, "$1• ")
        .replace(/^(\s*)(\d+)\.\s+/gm, "$1$2. ");
    })
    .join("");
}

/** Split on paragraph boundaries so no chunk exceeds Slack's comfortable message size. */
export function chunk(text: string, limit = SLACK_LIMIT): string[] {
  if (text.length <= limit) return [text];
  const chunks: string[] = [];
  let current = "";
  for (const paragraph of text.split(/\n\n/)) {
    const candidate = current ? `${current}\n\n${paragraph}` : paragraph;
    if (candidate.length > limit && current) {
      chunks.push(current);
      current = paragraph;
    } else {
      current = candidate;
    }
    while (current.length > limit) {
      chunks.push(current.slice(0, limit));
      current = current.slice(limit);
    }
  }
  if (current) chunks.push(current);
  return chunks;
}
