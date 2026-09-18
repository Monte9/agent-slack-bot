import { App, LogLevel } from "@slack/bolt";
import type { AgentEvent } from "../agent/types.js";
import type { Config } from "../config.js";
import { chunk, toMrkdwn } from "./format.js";
import { statusText } from "./status.js";
import type { TurnRunner } from "./turn.js";

const PROGRESS_INTERVAL_MS = 3000;
const CLOCK_FRAMES = ["🕐", "🕑", "🕒", "🕓", "🕔", "🕕", "🕖", "🕗", "🕘", "🕙", "🕚", "🕛"];

interface MentionEvent {
  user?: string;
  bot_id?: string;
  text: string;
  channel: string;
  ts: string;
  thread_ts?: string;
}

function basename(path: string): string {
  return path.split("/").filter(Boolean).pop() ?? path;
}

/** One short, human line for the placeholder, from a tool call. */
export function describeActivity(event: Extract<AgentEvent, { type: "tool" }>): string {
  const { name, summary } = event;
  const mcp = /^mcp__(?:claude_ai_)?([^_]+)__(.+)$/.exec(name);
  if (mcp) {
    const [, server, tool] = mcp;
    return `${server}: ${(tool ?? "").replace(/[-_]+/g, " ").toLowerCase()}`;
  }
  switch (name) {
    case "ToolSearch":
      return "loading tools";
    case "Bash":
      return `running \`${summary}\``;
    case "Read":
      return `reading ${basename(summary)}`;
    case "Edit":
    case "Write":
    case "MultiEdit":
    case "NotebookEdit":
      return `editing ${basename(summary)}`;
    case "Grep":
    case "Glob":
      return `searching for ${summary}`;
    case "WebFetch":
    case "WebSearch":
      return "browsing";
    case "Agent":
      return "delegating to a subagent";
    case "Skill":
      return `using the ${summary} skill`;
    default:
      return name.toLowerCase();
  }
}

export async function startSlack(config: Config, runner: TurnRunner, adapterName: string): Promise<void> {
  const app = new App({
    token: config.slack.botToken,
    appToken: config.slack.appToken,
    socketMode: true,
    logLevel: LogLevel.INFO,
  });

  const auth = await app.client.auth.test();
  const botUserId = auth.user_id ?? "";
  const botName = auth.user ?? "bot";
  const mentionPattern = new RegExp(`<@${botUserId}>`, "g");

  app.event("app_mention", async ({ event, client }) => {
    const mention = event as MentionEvent;
    if (mention.bot_id || !mention.user) return;
    const threadTs = mention.thread_ts ?? mention.ts;
    const reply = (text: string) =>
      client.chat.postMessage({ channel: mention.channel, thread_ts: threadTs, text });
    // Reactions need reactions:write; an app installed without it still works, just without the marker.
    const react = async (name: string, remove = false) => {
      try {
        const args = { channel: mention.channel, timestamp: mention.ts, name };
        await (remove ? client.reactions.remove(args) : client.reactions.add(args));
      } catch {
        // ignore: missing scope, or the reaction already in that state
      }
    };

    if (!config.allowlist.includes(mention.user)) {
      await reply(`Sorry <@${mention.user}>, you are not on my allowlist. Ask <@${config.owner}> to add you.`);
      return;
    }

    const text = mention.text.replace(mentionPattern, "").trim();
    const command = text.toLowerCase();

    if (command === "status") {
      await reply(statusText(runner, adapterName));
      return;
    }
    if (command === "new") {
      if (mention.user !== config.owner) {
        await reply("Only the owner can start a new session.");
        return;
      }
      runner.rotate();
      await reply("Started fresh. The next mention opens a new session with the current shared memory.");
      return;
    }
    if (!text) {
      await reply("Mention me with a question or a task. `status` and `new` are the only commands.");
      return;
    }

    const depth = runner.depth;
    const startedAt = Date.now();
    console.log(`[mention] ${mention.user} in ${mention.channel} thread ${threadTs} (queue ${depth}): ${text.slice(0, 120)}`);
    await react("eyes");

    let activity = depth > 0 ? `queued behind ${depth}, finishing the last one first` : "starting";
    let frame = 0;
    const spinner = () => config.workingEmoji ?? CLOCK_FRAMES[frame++ % CLOCK_FRAMES.length];
    const placeholder = await reply(`${spinner()} ${activity}`);
    const placeholderTs = placeholder.ts ?? "";
    const update = (body: string) => client.chat.update({ channel: mention.channel, ts: placeholderTs, text: body });

    let lastShown = "";
    const ticker = setInterval(() => {
      const body = `${spinner()} ${activity}`;
      if (body === lastShown && config.workingEmoji) return;
      lastShown = body;
      void update(body).catch(() => undefined);
    }, PROGRESS_INTERVAL_MS);

    try {
      const outcome = await runner.run({
        requester: mention.user,
        origin: `Slack #${mention.channel} thread ${threadTs}`,
        text,
        onEvent: (agentEvent) => {
          if (agentEvent.type === "tool") activity = describeActivity(agentEvent);
          if (agentEvent.type === "init") activity = "thinking";
        },
      });
      clearInterval(ticker);

      const parts = chunk(toMrkdwn(outcome.text || "(no reply)"));
      const prefix = outcome.rotated ? "_The previous session could not be resumed, so this is a fresh one._\n\n" : "";
      await update(`${prefix}${parts[0] ?? ""}`);
      for (const part of parts.slice(1)) await reply(part);
      await react("eyes", true);
      await react(outcome.isError ? "x" : "white_check_mark");
      console.log(
        `[turn ${outcome.session.turns}] ${Math.round((Date.now() - startedAt) / 1000)}s, ${outcome.text.length} chars in ${parts.length} message(s)` +
          `${outcome.condensed ? ", condensed" : ""}${outcome.isError ? ", error" : ""}${outcome.rotated ? ", fresh session" : ""}, session ${outcome.sessionId}`,
      );
    } catch (error) {
      clearInterval(ticker);
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[turn failed] ${message}`);
      await update(`Something went wrong: \`${message.slice(0, 500)}\``);
      await react("eyes", true);
      await react("x");
    }
  });

  await app.start();
  console.log(`@${botName} connected over Socket Mode. Owner ${config.owner}, allowlist ${config.allowlist.length}.`);
}
