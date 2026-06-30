import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MANIFEST_SCHEMA, MANIFEST_VERSION, validateManifest } from "../src/manifest.js";

const HASH_A = `sha256:${"a".repeat(64)}`;

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "skillpress-manifest-"));
  return {
    root,
    cwd: path.join(root, "repo"),
    homeDir: path.join(root, "home")
  };
}

test("manifest validation accepts explicit installed skill entries", () => {
  const fx = fixture();
  const installedPath = path.join(fx.homeDir, ".codex", "skills", "runlane-consumer", "SKILL.md");
  const manifest = validateManifest({
    schema: MANIFEST_SCHEMA,
    version: MANIFEST_VERSION,
    entries: [{
      skill: "runlane-consumer",
      provider: "codex",
      source_path: "agent-skills/src/runlane/runlane-consumer/SKILL.md",
      source_hash: HASH_A,
      installed_path: installedPath,
      version: "0.1.0"
    }]
  }, fx);

  assert.equal(manifest.entries.length, 1);
  assert.equal(manifest.entries[0].skill, "runlane-consumer");
  assert.equal(manifest.entries[0].installed_path, installedPath);
});

test("manifest validation fails closed on unsafe source and target paths", () => {
  const fx = fixture();
  const validInstalledPath = path.join(fx.homeDir, ".codex", "skills", "runlane-consumer", "SKILL.md");
  const base = {
    schema: MANIFEST_SCHEMA,
    version: MANIFEST_VERSION,
    entries: [{
      skill: "runlane-consumer",
      provider: "codex",
      source_path: "../outside/SKILL.md",
      source_hash: HASH_A,
      installed_path: validInstalledPath
    }]
  };

  assert.throws(() => validateManifest(base, fx), /source_path/);
  assert.throws(() => validateManifest({
    ...base,
    entries: [{
      ...base.entries[0],
      source_path: "agent-skills/src/runlane/runlane-consumer/SKILL.md",
      installed_path: path.join(fx.homeDir, ".agents", "skills", "runlane-consumer", "SKILL.md")
    }]
  }, fx), /inside provider root/);
});
