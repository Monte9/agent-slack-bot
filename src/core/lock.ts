import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * One bot per state directory. Two bots on one Slack app round-robin the mentions, so a change
 * "does not take" every other time and the turns the other copy answers never reach this log.
 * Whoever starts the second copy, launchd, `dev` or a shell, it exits here instead.
 */
export function acquireLock(stateDir: string): void {
  mkdirSync(stateDir, { recursive: true });
  const path = join(stateDir, "bot.pid");
  const holder = readPid(path);
  if (holder !== undefined && holder !== process.pid && isRunningBot(holder)) {
    throw new Error(`another slack-agent is already running (pid ${holder}); stop it first`);
  }
  writeFileSync(path, `${process.pid}\n`);
  process.on("exit", () => rmSync(path, { force: true }));
  process.once("SIGINT", () => process.exit(130));
  process.once("SIGTERM", () => process.exit(143));
}

function readPid(path: string): number | undefined {
  if (!existsSync(path)) return undefined;
  const pid = Number.parseInt(readFileSync(path, "utf8"), 10);
  return Number.isInteger(pid) && pid > 0 ? pid : undefined;
}

/** Checks the command line, not just liveness: after a reboot a stale pid can belong to anything. */
function isRunningBot(pid: number): boolean {
  try {
    return /\bsrc\/index\.ts\b/.test(execFileSync("ps", ["-o", "command=", "-p", String(pid)], { encoding: "utf8" }));
  } catch {
    return false;
  }
}
