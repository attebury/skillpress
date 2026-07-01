import test from "node:test";
import assert from "node:assert/strict";
import {
  lintCommandContracts,
  lintMarkdownFences,
  lintPolicyRules,
  parseGeneratedHeader
} from "../src/skill-lint.js";

test("markdown fence lint catches unclosed fences", () => {
  assert.deepEqual(lintMarkdownFences("```js\nconsole.log(1);\n```\n"), []);
  const findings = lintMarkdownFences("```js\nconsole.log(1);\n");
  assert.equal(findings.length, 1);
  assert.equal(findings[0].code, "markdown_fence_unbalanced");
});

test("generated header parser reads key value fields", () => {
  const header = parseGeneratedHeader([
    "<!-- skillpress",
    "source_path: agent-skills/src/runlane/runlane-consumer/SKILL.md",
    "source_hash: sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "target: codex",
    "-->",
    "# Runlane"
  ].join("\n"));

  assert.equal(header.present, true);
  assert.equal(header.fields.target, "codex");
  assert.equal(header.errors.length, 0);
});

test("policy lint catches known dangerous skill drift", () => {
  const findings = lintPolicyRules([
    "# Remogram Dogfood",
    "Set allow_pending_checks when local checks are unavailable.",
    "Run npm link from the lane worktree.",
    "Use topogram work prep . --base origin/main.",
    "Call remogram cr view before merge.",
    "Use a fallback path."
  ].join("\n"), {
    skill: "remogram-dogfood",
    tool: "remogram",
    path: "/tmp/remogram-dogfood/SKILL.md"
  });
  const codes = new Set(findings.map((entry) => entry.code));

  assert.ok(codes.has("policy_missing_pending_check_waiver_forbidden"));
  assert.ok(codes.has("policy_lane_npm_link_forbidden"));
  assert.ok(codes.has("policy_hardcoded_origin_main"));
  assert.ok(codes.has("policy_stale_remogram_cr_command"));
  assert.ok(codes.has("policy_unjustified_compatibility_language"));
});

test("command contract lint accepts positional args and rejects stale Remogram commands", () => {
  const findings = lintCommandContracts([
    "runlane verify build --json",
    "runlane can merge --lane gate --json",
    "remogram pr view --number 1 --json",
    "remogram cr view --number 1 --json"
  ].join("\n"), {
    runlane: ["verify", "can merge"],
    remogram: ["pr view", "merge plan"],
    topogram: []
  });

  assert.equal(findings.length, 1);
  assert.equal(findings[0].code, "command_contract_unknown");
  assert.equal(findings[0].command, "remogram cr view");
});
