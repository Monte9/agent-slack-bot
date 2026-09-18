const SLACK_LIMIT = 3800;

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
