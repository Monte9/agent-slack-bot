import assert from "node:assert/strict";
import { test } from "node:test";
import { decide, describePolicy, ruleMatches, type Policy } from "./gate.js";

const policy: Policy = {
  rules: [
    { match: "mcp__claude_ai_Gmail__*", allow: "nobody", reason: "personal mail" },
    { match: "Bash(git push --force*)", allow: "nobody" },
    { match: "Bash(git push*)", allow: "owner" },
    { match: "Edit(*/firebase/firestore.rules)", allow: "nobody" },
    { match: "mcp__claude_ai_Notion__notion-update-*", allow: "owner" },
  ],
};

test("a tool-name wildcard matches the whole connector", () => {
  assert.equal(ruleMatches(policy.rules[0]!, "mcp__claude_ai_Gmail__search_threads", {}), true);
  assert.equal(ruleMatches(policy.rules[0]!, "mcp__claude_ai_Notion__notion-search", {}), false);
});

test("a Tool(argument*) rule matches the command prefix", () => {
  assert.equal(ruleMatches(policy.rules[2]!, "Bash", { command: "git push origin main" }), true);
  assert.equal(ruleMatches(policy.rules[2]!, "Bash", { command: "git status" }), false);
});

test("Edit rules cover every file-editing tool", () => {
  assert.equal(ruleMatches(policy.rules[3]!, "Write", { file_path: "/repo/firebase/firestore.rules" }), true);
  assert.equal(ruleMatches(policy.rules[3]!, "Edit", { file_path: "/repo/firebase/firestore.rules" }), true);
  assert.equal(ruleMatches(policy.rules[3]!, "Edit", { file_path: "/repo/firebase/functions/index.ts" }), false);
});

test("first match wins, so the force-push rule beats the push rule", () => {
  const owner = decide(policy, "Bash", { command: "git push --force origin main" }, true);
  assert.equal(owner.decision.allow, false);
  assert.equal(owner.rule?.match, "Bash(git push --force*)");
});

test("owner-only rules allow the owner and refuse everyone else with a reason", () => {
  assert.equal(decide(policy, "Bash", { command: "git push origin main" }, true).decision.allow, true);
  const other = decide(policy, "Bash", { command: "git push origin main" }, false).decision;
  assert.equal(other.allow, false);
  assert.match(other.allow ? "" : other.reason, /Only the owner/);
});

test("nobody rules refuse the owner too", () => {
  const result = decide(policy, "mcp__claude_ai_Gmail__search_threads", {}, true).decision;
  assert.equal(result.allow, false);
  assert.match(result.allow ? "" : result.reason, /personal mail/);
});

test("unmatched tools are allowed for everyone", () => {
  assert.equal(decide(policy, "mcp__claude_ai_Mixpanel__Get-Report", {}, false).decision.allow, true);
});

test("the prose summary names both tiers", () => {
  const text = describePolicy(policy);
  assert.match(text, /Never available from Slack: mcp__claude_ai_Gmail__\*/);
  assert.match(text, /Owner only.*Bash\(git push\*\)/);
});
