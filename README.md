# agent-slack-bot

A Slack bot that gives a local coding agent, and its memory, a persistent handle in your workspace.

You mention the bot in any channel. It runs one long-lived agent session on your machine, in your
project, with the memory that project has accumulated. Every mention, in every thread, lands in
that same session, so the bot remembers what it was asked an hour ago and what it found out.

The agent runtime is an adapter. The first one is the [Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk/overview),
backed by your own `claude login`. The core does not care which runtime answers.

## How it works

- **Socket Mode, no public URL.** The bot runs where the memory lives, on your laptop, and holds a
  WebSocket to Slack. Nothing inbound.
- **One session.** A session id lives in `~/.agent-slack-bot/session.json`. Restarting the bot resumes
  it. `@bot new` starts over. `@bot status` prints the id so you can resume the same session from a
  terminal after stopping the bot.
- **Serial by design.** Mentions queue and run in order. The second person hears "queued behind 1".
- **Visible progress.** Your message gets 👀 when picked up and ✅ or ❌ when done. A placeholder reply
  shows what the agent is doing right now, with an emoji per activity (📖 reading, 💻 running, 📊 Mixpanel,
  ✂️ shortening), and becomes the answer when it finishes.
- **Shared-scope memory.** The session runs in a generated workspace whose memory directory holds
  symlinks to only the memory files matching `memoryShare` (by default `project_*` and `reference_*`).
  Files that don't match are never loaded, so no prompt can reveal them. Memory is read-only from Slack.
- **Allowlist and owner.** Only Slack users on the allowlist get answers. Privileged actions are the
  owner's alone. Every denial is one line in `~/.agent-slack-bot/audit.jsonl`.

## Setup

Requirements: Node 22+, pnpm, and a Claude Code login (`claude login`) on the machine that runs the bot.

1. **Create the Slack app** from [`manifest.json`](manifest.json). To give your instance its own name
   and description, copy `manifest.local.example.json` to `manifest.local.json` (gitignored); it is
   merged over the committed manifest. Either way works:
   - With the [Slack CLI](https://docs.slack.dev/tools/slack-cli): `slack login`, then
     `slack app install --environment deployed` from this directory. The CLI reads the merged manifest
     through `.slack/hooks.json` and records the app id in `.slack/apps.json` (gitignored). Rerun the
     install after changing scopes; the bot token keeps its value and gains the scope.
   - In the browser: at [api.slack.com/apps](https://api.slack.com/apps) choose *Create New App → From a
     manifest*, paste the file, and install the app to your workspace.
2. **Tokens.** Copy `.env.example` to `.env`. Fill `SLACK_BOT_TOKEN` (OAuth & Permissions → Bot User OAuth
   Token) and `SLACK_APP_TOKEN` (Basic Information → App-Level Tokens, scope `connections:write`).
   `slack app settings` opens the right page.
3. **Config.** Copy `config.example.json` to `config.json`. Set `project` to your repo, `owner` to your
   Slack user id, and `allowlist` to who may talk to the bot. Slack is instant messaging, so replies over
   `maxReplyWords` (default 80) are sent back to the agent once to be shortened.
4. **House style**, optional. Write `~/.agent-slack-bot/instructions.md` (or point `instructionsFile`
   elsewhere): link formats, URL patterns for your tools, anything about voice. It is appended to the
   agent's system prompt and re-read on every turn, so edits apply without a restart. The generic rules,
   such as "link what you cite", are in code; this file is for what is specific to your instance.
5. **Run.**

   ```bash
   pnpm install
   pnpm start
   ```

   Invite the bot to a channel and mention it.

### Local checks without Slack

```bash
pnpm scope                 # rebuild the workspace and list the memory it shares
pnpm ask "what do you remember about X"
pnpm status
```

`pnpm ask` drives the same session the bot uses, as the owner.

## Security

- Your tokens and `config.json` are gitignored. Nothing of yours is in this repo.
- The bot answers only Slack users on `allowlist`, and reads the sender id from the Slack event, never
  from the message text. "The owner said to" carries no weight.
- The session sees only the memory files matching `memoryShare`. Choose those patterns so that personal
  notes never match.
- Memory directories are write-protected for every requester. The scoped memory is symlinked to the real
  one, so a write through it would change the original.
- Bot-authored messages are ignored, so two bots cannot talk each other into anything.
- A session driven from Slack should not be opened in a terminal at the same time. Stop the bot first,
  then `claude --resume <id>`.

## Adapters

Core owns Slack, the queue, the session file, memory scoping and the gate. An adapter implements
[`AgentAdapter`](src/agent/types.ts): run a prompt in a directory, resume a session, stream events, and
consult the gate before each tool call. A runtime without a per-tool callback declares
`toolGating: "runtime"` and is sandboxed as a whole instead.

## License

MIT
