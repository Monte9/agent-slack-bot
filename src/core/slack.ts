import { App, LogLevel } from "@slack/bolt";
import type { Config } from "../config.js";
import { chunk, toMrkdwn } from "./format.js";
import { statusText } from "./status.js";
import type { TurnRunner } from "./turn.js";

const PROGRESS_INTERVAL_MS = 4000;

interface MentionEvent {
  user?: string;
  bot_id?: string;
  text: string;
  channel: string;
  ts: string;
  thread_ts?: string;
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
    const placeholder = await reply(depth > 0 ? `Queued behind ${depth}; finishing the last one first.` : "Working on it.");
    const placeholderTs = placeholder.ts ?? "";
    const update = (body: string) => client.chat.update({ channel: mention.channel, ts: placeholderTs, text: body });

    let lastProgress = Date.now();
    let lastTool = "";
    try {
      const outcome = await runner.run({
        requester: mention.user,
        origin: `Slack #${mention.channel} thread ${threadTs}`,
        text,
        onEvent: (agentEvent) => {
          if (agentEvent.type === "tool") lastTool = `${agentEvent.name}: ${agentEvent.summary}`;
          if (agentEvent.type === "init") lastTool = "starting";
          if (Date.now() - lastProgress > PROGRESS_INTERVAL_MS && lastTool) {
            lastProgress = Date.now();
            void update(`Working on it. ${lastTool}`).catch(() => undefined);
          }
        },
      });

      const parts = chunk(toMrkdwn(outcome.text || "(no reply)"));
      const prefix = outcome.rotated ? "_The previous session could not be resumed, so this is a fresh one._\n\n" : "";
      await update(`${prefix}${parts[0] ?? ""}`);
      for (const part of parts.slice(1)) await reply(part);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await update(`Something went wrong: \`${message.slice(0, 500)}\``);
    }
  });

  await app.start();
  console.log(`@${botName} connected over Socket Mode. Owner ${config.owner}, allowlist ${config.allowlist.length}.`);
}
