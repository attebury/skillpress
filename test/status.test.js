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
  writeSkill(path.join(fx.homeDir, ".codex", "skills", "beta", "SKILL.md"), "```md\nunterminated\n");

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

test("status lints canonical sources before install", () => {
  const fx = fixture();
  writeSkill(path.join(fx.cwd, "agent-skills", "contracts", "remogram.commands.json"), JSON.stringify({
    schema: "skillpress.command-contract",
    version: 1,
    tool: "remogram",
    commands: ["pr view", "pr checks", "merge plan"]
  }));
  writeSkill(path.join(fx.cwd, "agent-skills", "src", "remogram", "remogram-consumer", "SKILL.md"), [
    "---",
    "name: remogram-consumer",
    "description: Use Remogram facts.",
    "---",
    "",
    "# Remogram Consumer",
    "",
    "```bash",
    "remogram cr view --number 1 --json",
    "```"
  ].join("\n"));

  const packet = statusPacket({
    cwd: fx.cwd,
    homeDir: fx.homeDir,
    policyPacks: ["generic", "atteway"]
  });

  assert.equal(packet.ok, false);
  assert.ok(packet.issues.some((entry) => entry.code === "policy_stale_remogram_cr_command"));
  assert.ok(packet.issues.some((entry) => entry.code === "command_contract_unknown"));
});

test("status detects installed auxiliary-file drift", async () => {
  const fx = fixture();
  writeSkill(path.join(fx.cwd, "agent-skills", "src", "runlane", "runlane-consumer", "SKILL.md"), [
    "---",
    "name: runlane-consumer",
    "description: Use Runlane facts.",
    "---",
    "",
    "# Runlane Consumer",
    ""
  ].join("\n"));
  writeSkill(path.join(fx.cwd, "agent-skills", "src", "runlane", "runlane-consumer", "scripts", "verify.js"), "console.log('expected');\n");
  const { syncPacket } = await import("../src/sync.js");
  assert.equal(syncPacket({ cwd: fx.cwd, homeDir: fx.homeDir, provider: "codex", tool: "runlane" }).ok, true);

  writeSkill(path.join(fx.homeDir, ".codex", "skills", "runlane-consumer", "scripts", "verify.js"), "console.log('drift');\n");

  const packet = statusPacket({ cwd: fx.cwd, homeDir: fx.homeDir });
  assert.equal(packet.ok, false);
  assert.ok(packet.issues.some((entry) => entry.code === "installed_skill_drift" && entry.path.endsWith("scripts/verify.js")));
});

test("status fails closed on canonical source roots outside the repository", () => {
  const fx = fixture();
  const packet = statusPacket({ cwd: fx.cwd, homeDir: fx.homeDir, sourceRoot: path.join(fx.root, "outside") });

  assert.equal(packet.ok, false);
  assert.ok(packet.issues.some((entry) => entry.code === "canonical_source_root_outside_repo"));
});
