import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { statusPacket } from "../src/status.js";
import { MANIFEST_SCHEMA, MANIFEST_VERSION } from "../src/manifest.js";

const HASH_A = `sha256:${"a".repeat(64)}`;
const HASH_B = `sha256:${"b".repeat(64)}`;

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "skillpress-status-"));
  const cwd = path.join(root, "repo");
  const homeDir = path.join(root, "home");
  fs.mkdirSync(cwd, { recursive: true });
  fs.mkdirSync(homeDir, { recursive: true });
  return { root, cwd, homeDir };
}

function writeSkill(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

test("status reports duplicate skill names and content conflicts across roots", () => {
  const fx = fixture();
  writeSkill(path.join(fx.homeDir, ".codex", "skills", "alpha", "SKILL.md"), "# Alpha\n");
  writeSkill(path.join(fx.homeDir, ".agents", "skills", "alpha", "SKILL.md"), "# Alpha drift\n");

  const packet = statusPacket({ cwd: fx.cwd, homeDir: fx.homeDir });
  assert.equal(packet.ok, false);
  assert.ok(packet.issues.some((entry) => entry.code === "duplicate_skill_name"));
  assert.ok(packet.issues.some((entry) => entry.code === "duplicate_skill_content_conflict"));
});

test("status reports malformed markdown fences without requiring a manifest", () => {
  const fx = fixture();
  writeSkill(path.join(fx.cwd, ".cursor", "skills", "beta", "SKILL.md"), "```md\nunterminated\n");

  const packet = statusPacket({ cwd: fx.cwd, homeDir: fx.homeDir });
  assert.equal(packet.ok, false);
  assert.equal(packet.summary.malformed_markdown_count, 1);
  assert.ok(packet.issues.some((entry) => entry.code === "markdown_fence_unbalanced"));
});

test("status reports missing installed skills and generated header problems from manifest", () => {
  const fx = fixture();
  const managedPath = path.join(fx.homeDir, ".codex", "skills", "managed", "SKILL.md");
  const missingPath = path.join(fx.homeDir, ".codex", "skills", "missing", "SKILL.md");
  const noHeaderPath = path.join(fx.homeDir, ".codex", "skills", "no-header", "SKILL.md");
  writeSkill(managedPath, [
    "<!-- skillpress",
    "source_hash: sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    "target: codex",
    "-->",
    "# Managed"
  ].join("\n"));
  writeSkill(noHeaderPath, "# No Header\n");
  const manifestPath = path.join(fx.cwd, "skillpress.manifest.json");
  fs.writeFileSync(manifestPath, JSON.stringify({
    schema: MANIFEST_SCHEMA,
    version: MANIFEST_VERSION,
    entries: [
      {
        skill: "managed",
        provider: "codex",
        source_path: "agent-skills/src/managed/SKILL.md",
        source_hash: HASH_A,
        installed_path: managedPath
      },
      {
        skill: "missing",
        provider: "codex",
        source_path: "agent-skills/src/missing/SKILL.md",
        source_hash: HASH_B,
        installed_path: missingPath
      },
      {
        skill: "no-header",
        provider: "codex",
        source_path: "agent-skills/src/no-header/SKILL.md",
        source_hash: HASH_A,
        installed_path: noHeaderPath
      }
    ]
  }));

  const packet = statusPacket({ cwd: fx.cwd, homeDir: fx.homeDir, manifestPath });
  assert.equal(packet.ok, false);
  assert.ok(packet.issues.some((entry) => entry.code === "installed_skill_missing"));
  assert.ok(packet.issues.some((entry) => entry.code === "generated_header_missing"));
  assert.ok(packet.issues.some((entry) => entry.code === "generated_header_stale"));
});
