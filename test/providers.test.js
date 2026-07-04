import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { providerTargets, installedSkillPath, resolveProviderSelection } from "../src/providers.js";

test("provider targets model known roots for installable providers", () => {
  const cwd = path.join(path.sep, "tmp", "repo");
  const homeDir = path.join(path.sep, "tmp", "home");
  const targets = providerTargets({ cwd, homeDir });

  assert.equal(targets.find((entry) => entry.id === "codex").root, path.join(homeDir, ".codex", "skills"));
  assert.equal(targets.find((entry) => entry.id === "agents").root, path.join(homeDir, ".agents", "skills"));
  assert.equal(targets.find((entry) => entry.id === "cursor").root, path.join(cwd, ".cursor", "rules", "skillpress"));
  assert.equal(targets.find((entry) => entry.id === "cursor").kind, "rule-directory");
  assert.equal(targets.find((entry) => entry.id === "claude-code").root, path.join(homeDir, ".claude", "skills"));
  assert.equal(targets.find((entry) => entry.id === "claude-code").installable, true);
  assert.equal(targets.find((entry) => entry.id === "claude-code").layout_known, true);
  assert.equal(targets.find((entry) => entry.id === "zed").root, path.join(homeDir, ".agents", "skills"));
  assert.equal(targets.find((entry) => entry.id === "github-copilot").root, path.join(homeDir, ".copilot", "skills"));
  assert.equal(targets.find((entry) => entry.id === "cline").root, path.join(homeDir, ".cline", "skills"));
  assert.equal(targets.find((entry) => entry.id === "roo").root, path.join(homeDir, ".roo", "skills"));
  assert.equal(targets.find((entry) => entry.id === "continue").root, path.join(cwd, ".continue", "rules"));
  assert.equal(targets.find((entry) => entry.id === "devin").root, path.join(cwd, ".devin", "rules"));
  assert.equal(targets.find((entry) => entry.id === "github-copilot-instructions").root, path.join(cwd, ".github", "instructions", "skillpress"));
  assert.equal(targets.find((entry) => entry.id === "agents-md").root, cwd);
});

test("installed skill paths require safe skill ids", () => {
  const codex = providerTargets({
    cwd: path.join(path.sep, "tmp", "repo"),
    homeDir: path.join(path.sep, "tmp", "home")
  }).find((entry) => entry.id === "codex");

  assert.equal(
    installedSkillPath(codex, "remogram-consumer"),
    path.join(path.sep, "tmp", "home", ".codex", "skills", "remogram-consumer", "SKILL.md")
  );
  assert.throws(() => installedSkillPath(codex, "../remogram-consumer"), /safe path segment/);
});

test("provider selection warns for missing optional providers and fails explicit missing providers", () => {
  const cwd = path.join(path.sep, "tmp", "repo");
  const homeDir = path.join(path.sep, "tmp", "home");
  const defaults = resolveProviderSelection({ cwd, homeDir, command: "sync" });

  assert.ok(defaults.issues.some((entry) => entry.code === "provider_unavailable" && entry.severity === "warning" && entry.provider === "codex"));
  assert.ok(defaults.providers.some((entry) => entry.id === "agents" && entry.syncable));
  assert.ok(defaults.providers.some((entry) => entry.id === "cursor" && entry.syncable));

  const explicit = resolveProviderSelection({ cwd, homeDir, provider: "codex", command: "sync" });
  assert.ok(explicit.issues.some((entry) => entry.code === "provider_unavailable" && entry.severity === "error"));
});
