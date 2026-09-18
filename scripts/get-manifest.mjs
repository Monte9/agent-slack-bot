// Slack CLI "get-manifest" hook: the committed manifest.json with manifest.local.json
// (gitignored, per-instance display info) merged over it, so a reinstall never
// overwrites what the owner set on the settings page.
import { existsSync, readFileSync } from "node:fs";
import { getProtocol } from "@slack/cli-hooks/src/protocols.js";

function merge(base, override) {
  if (Array.isArray(base) || Array.isArray(override) || typeof base !== "object" || typeof override !== "object") {
    return override;
  }
  const out = { ...base };
  for (const [key, value] of Object.entries(override)) {
    out[key] = key in out && value !== null ? merge(out[key], value) : value;
  }
  return out;
}

const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
const local = existsSync("manifest.local.json") ? JSON.parse(readFileSync("manifest.local.json", "utf8")) : {};
// The CLI wraps hook output in message boundaries; the stock protocol helper handles both modes.
getProtocol(process.argv.slice(1)).respond(JSON.stringify(merge(manifest, local)));
