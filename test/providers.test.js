import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { providerTargets, installedSkillPath } from "../src/providers.js";

test("provider targets model known roots for installable providers", () => {
  const cwd = path.join(path.sep, "tmp", "repo");
  const homeDir = path.join(path.sep, "tmp", "home");
  const targets = providerTargets({ cwd, homeDir });

  assert.equal(targets.find((entry) => entry.id === "codex").root, path.join(homeDir, ".codex", "skills"));
  assert.equal(targets.find((entry) => entry.id === "agents").root, path.join(homeDir, ".agents", "skills"));
  assert.equal(targets.find((entry) => entry.id === "cursor").root, path.join(cwd, ".cursor", "rules", "skillpress"));
  assert.equal(targets.find((entry) => entry.id === "cursor").kind, "cursor-rule");
  assert.equal(targets.find((entry) => entry.id === "claude-code").root, path.join(homeDir, ".claude", "skills"));
  assert.equal(targets.find((entry) => entry.id === "claude-code").installable, true);
  assert.equal(targets.find((entry) => entry.id === "claude-code").layout_known, true);
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
