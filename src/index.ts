import { createClaudeAdapter } from "./agent/claude.js";
import { loadConfig } from "./config.js";
import { acquireLock } from "./core/lock.js";
import { startSlack } from "./core/slack.js";
import { TurnRunner } from "./core/turn.js";

const config = loadConfig();
try {
  acquireLock(config.stateDir);
} catch (error) {
  console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
const adapter = createClaudeAdapter({ model: config.model });
const runner = new TurnRunner(config, adapter, "mclaude");

console.log(`Project ${config.project}`);
console.log(`Workspace ${runner.workspace}, ${runner.sharedMemory.length} shared memory files`);

await startSlack(config, runner, adapter.name);
