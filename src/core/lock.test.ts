import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { acquireLock } from "./lock.js";

function stateDirWithPid(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "slack-agent-lock-"));
  writeFileSync(join(dir, "bot.pid"), content);
  return dir;
}

test("a pid file that names a dead, foreign or unreadable process is taken over", () => {
  for (const content of ["1\n", "nonsense", ""]) {
    const dir = stateDirWithPid(content);
    acquireLock(dir);
    assert.equal(readFileSync(join(dir, "bot.pid"), "utf8").trim(), String(process.pid));
  }
});

test("a pid file that names a running bot refuses", async () => {
  // A live process whose command line looks like the bot's.
  const other = spawn(process.execPath, ["-e", "setTimeout(() => {}, 30_000)", "src/index.ts"]);
  try {
    await new Promise((resolve) => other.once("spawn", resolve));
    const dir = stateDirWithPid(`${other.pid}\n`);
    assert.throws(() => acquireLock(dir), new RegExp(`already running \\(pid ${other.pid}\\)`));
  } finally {
    other.kill();
  }
});
