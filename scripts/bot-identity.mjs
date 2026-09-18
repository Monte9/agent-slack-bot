// Prints the bot's Slack display name and avatar URL as JSON, for the launchd app bundle.
import { existsSync } from "node:fs";

if (existsSync(".env")) process.loadEnvFile(".env");
const token = process.env.SLACK_BOT_TOKEN;
if (!token) throw new Error("SLACK_BOT_TOKEN is not set");

const call = async (method) =>
  (await fetch(`https://slack.com/api/${method}`, { headers: { Authorization: `Bearer ${token}` } })).json();

const auth = await call("auth.test");
const info = await call(`users.info?user=${auth.user_id}`);
const profile = info.user?.profile ?? {};
process.stdout.write(
  JSON.stringify({
    name: profile.display_name || info.user?.real_name || auth.user,
    avatar: profile.image_1024 ?? profile.image_512 ?? profile.image_192 ?? null,
  }),
);
