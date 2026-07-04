import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MANIFEST_SCHEMA, MANIFEST_VERSION, resolveManifestLocation, validateManifest } from "../src/manifest.js";

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

test("manifest location defaults to XDG-style local state outside git", () => {
  const fx = fixture();
  fs.mkdirSync(fx.cwd, { recursive: true });
  fs.mkdirSync(fx.homeDir, { recursive: true });

  const location = resolveManifestLocation({ cwd: fx.cwd, homeDir: fx.homeDir });

  assert.equal(location.mode, "xdg-state");
  assert.equal(location.explicit, false);
  assert.equal(location.path.startsWith(path.join(fx.homeDir, ".local", "state", "skillpress")), true);
  assert.equal(location.legacy_default_path, path.join(fx.cwd, "skillpress.manifest.json"));
});

test("manifest location preserves explicit manifest paths", () => {
  const fx = fixture();
  fs.mkdirSync(fx.cwd, { recursive: true });
  fs.mkdirSync(fx.homeDir, { recursive: true });

  const location = resolveManifestLocation({
    cwd: fx.cwd,
    homeDir: fx.homeDir,
    manifestPath: "skillpress.manifest.json"
  });

  assert.equal(location.mode, "explicit");
  assert.equal(location.explicit, true);
  assert.equal(location.source, "cli");
  assert.equal(location.path, path.join(fx.cwd, "skillpress.manifest.json"));
});

test("manifest location fails closed on unsafe explicit paths", () => {
  const fx = fixture();
  fs.mkdirSync(fx.cwd, { recursive: true });
  fs.mkdirSync(fx.homeDir, { recursive: true });

  assert.throws(() => resolveManifestLocation({
    cwd: fx.cwd,
    homeDir: fx.homeDir,
    manifestPath: "../skillpress.manifest.json"
  }), /parent segments/);
});

test("manifest location fails closed when an existing parent symlink escapes the repo", () => {
  const fx = fixture();
  fs.mkdirSync(fx.cwd, { recursive: true });
  fs.mkdirSync(fx.homeDir, { recursive: true });
  const outside = path.join(fx.root, "outside");
  fs.mkdirSync(outside);
  fs.symlinkSync(outside, path.join(fx.cwd, ".skillpress"));

  assert.throws(() => resolveManifestLocation({
    cwd: fx.cwd,
    homeDir: fx.homeDir,
    configManifestPath: ".skillpress/install-manifest.local.json"
  }), /escape/);
});

test("manifest validation reads v1 entries without requiring v2 tree fields", () => {
  const fx = fixture();
  const installedPath = path.join(fx.homeDir, ".codex", "skills", "runlane-consumer", "SKILL.md");
  const manifest = validateManifest({
    schema: MANIFEST_SCHEMA,
    version: 1,
    entries: [{
      skill: "runlane-consumer",
      provider: "codex",
      source_path: "agent-skills/src/runlane/runlane-consumer/SKILL.md",
      source_hash: HASH_A,
      installed_path: installedPath
    }]
  }, fx);

  assert.equal(manifest.version, 1);
  assert.equal(manifest.entries[0].source_hash, HASH_A);
  assert.equal(manifest.entries[0].skill_md_hash, null);
  assert.equal(manifest.entries[0].source_tree_hash, null);
});

test("manifest validation treats legacy source_layout as metadata", () => {
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
      source_layout: "legacy-private",
      installed_path: installedPath
    }]
  }, fx);

  assert.equal(manifest.entries[0].source_layout, "legacy-private");
});

test("manifest validation accepts null optional string metadata", () => {
  const fx = fixture();
  const installedPath = path.join(fx.homeDir, ".codex", "skills", "runlane-consumer", "SKILL.md");
  const manifest = validateManifest({
    schema: MANIFEST_SCHEMA,
    version: MANIFEST_VERSION,
    entries: [{
      skill: "runlane-consumer",
      provider: "codex",
      source_path: "agent-skills/src/runlane/runlane-consumer/SKILL.md",
      source_repo: null,
      source_hash: HASH_A,
      version: null,
      target: null,
      installed_path: installedPath
    }]
  }, fx);

  assert.equal(manifest.entries[0].source_repo, null);
  assert.equal(manifest.entries[0].version, null);
  assert.equal(manifest.entries[0].target, "codex");
});

test("manifest validation keeps optional string fields fail-closed", () => {
  const fx = fixture();
  const installedPath = path.join(fx.homeDir, ".codex", "skills", "runlane-consumer", "SKILL.md");
  const base = {
    schema: MANIFEST_SCHEMA,
    version: MANIFEST_VERSION,
    entries: [{
      skill: "runlane-consumer",
      provider: "codex",
      source_path: "agent-skills/src/runlane/runlane-consumer/SKILL.md",
      source_hash: HASH_A,
      installed_path: installedPath
    }]
  };

  assert.throws(() => validateManifest({
    ...base,
    entries: [{
      ...base.entries[0],
      source_path: null,
      source_repo: null
    }]
  }, fx), /source_path or source_repo/);
  assert.throws(() => validateManifest({
    ...base,
    entries: [{
      ...base.entries[0],
      source_repo: ""
    }]
  }, fx), /source_repo/);
  assert.throws(() => validateManifest({
    ...base,
    entries: [{
      ...base.entries[0],
      source_repo: "../repo"
    }]
  }, fx), /source_repo/);
  assert.throws(() => validateManifest({
    ...base,
    entries: [{
      ...base.entries[0],
      version: "bad version"
    }]
  }, fx), /version/);
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
