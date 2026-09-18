import { createClaudeAdapter } from "./agent/claude.js";
import { loadConfig } from "./config.js";
import { startSlack } from "./core/slack.js";
import { TurnRunner } from "./core/turn.js";

const config = loadConfig();
const adapter = createClaudeAdapter({ model: config.model });
const runner = new TurnRunner(config, adapter, "mclaude");

console.log(`Project ${config.project}`);
console.log(`Workspace ${runner.workspace}, ${runner.sharedMemory.length} shared memory files`);

await startSlack(config, runner, adapter.name);
