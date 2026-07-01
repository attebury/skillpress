import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { syncPacket } from "../src/sync.js";
import { statusPacket } from "../src/status.js";

const GENERATED_AT = "2026-07-01T00:00:00.000Z";

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "skillpress-sync-"));
  const cwd = path.join(root, "repo");
  const homeDir = path.join(root, "home");
  fs.mkdirSync(cwd, { recursive: true });
  fs.mkdirSync(homeDir, { recursive: true });
  return { root, cwd, homeDir };
}

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function skillMarkdown(name = "runlane-consumer", description = "Use Runlane facts.") {
  return [
    "---",
    `name: ${name}`,
    `description: ${description}`,
    "---",
    "",
    `# ${name}`,
    "",
    "```bash",
    "runlane status --json",
    "runlane verify build --json",
    "```",
    ""
  ].join("\n");
}

function sourcePath(fx, tool = "runlane", skill = "runlane-consumer") {
  return path.join(fx.cwd, "agent-skills", "src", tool, skill, "SKILL.md");
}

test("sync renders canonical skills into installable provider roots and updates manifest", () => {
  const fx = fixture();
  writeFile(sourcePath(fx), skillMarkdown());

  const packet = syncPacket({ cwd: fx.cwd, homeDir: fx.homeDir, tool: "runlane", generatedAt: GENERATED_AT });

  assert.equal(packet.ok, true);
  assert.equal(packet.summary.write_count, 4);
  assert.deepEqual(packet.writes.map((entry) => entry.provider).sort(), ["agents", "claude-code", "codex", "cursor"]);
  for (const write of packet.writes) {
    assert.equal(write.written, true);
    assert.equal(fs.existsSync(write.installed_path), true);
    const content = fs.readFileSync(write.installed_path, "utf8");
    assert.match(content, /<!-- skillpress/);
    assert.match(content, new RegExp(`target: ${write.provider}`));
    assert.match(content, /source_path: agent-skills\/src\/runlane\/runlane-consumer\/SKILL.md/);
    assert.match(content, /source_tree_hash: sha256:/);
  }

  const manifest = JSON.parse(fs.readFileSync(path.join(fx.cwd, "skillpress.manifest.json"), "utf8"));
  assert.equal(manifest.version, 2);
  assert.equal(manifest.entries.length, 4);
  assert.ok(manifest.entries.some((entry) => entry.provider === "codex" && entry.installed_path.startsWith("~/")));
  assert.ok(manifest.entries.some((entry) => entry.provider === "claude-code" && entry.installed_path.startsWith("~/")));
  assert.ok(manifest.entries.some((entry) => entry.provider === "cursor" && entry.installed_path === ".cursor/rules/skillpress/runlane-consumer.mdc"));
  assert.ok(manifest.entries.every((entry) => entry.source_tree_hash?.startsWith("sha256:")));

  const status = statusPacket({ cwd: fx.cwd, homeDir: fx.homeDir });
  assert.equal(status.ok, true);
  assert.equal(status.status, "pass");
  assert.equal(status.summary.source_drift_count, 0);
  assert.equal(status.summary.conflict_count, 0);
});

test("sync dry-run reports writes without mutating roots or manifest", () => {
  const fx = fixture();
  writeFile(sourcePath(fx), skillMarkdown());

  const packet = syncPacket({
    cwd: fx.cwd,
    homeDir: fx.homeDir,
    provider: "codex",
    tool: "runlane",
    dryRun: true,
    generatedAt: GENERATED_AT
  });

  assert.equal(packet.ok, true);
  assert.equal(packet.dry_run, true);
  assert.equal(packet.writes.length, 1);
  assert.equal(packet.writes[0].written, false);
  assert.equal(fs.existsSync(packet.writes[0].installed_path), false);
  assert.equal(fs.existsSync(path.join(fx.cwd, "skillpress.manifest.json")), false);
});

test("status fails when canonical source changes after sync", () => {
  const fx = fixture();
  const canonicalPath = sourcePath(fx);
  writeFile(canonicalPath, skillMarkdown("runlane-consumer", "Initial guidance."));
  assert.equal(syncPacket({ cwd: fx.cwd, homeDir: fx.homeDir, provider: "codex", tool: "runlane", generatedAt: GENERATED_AT }).ok, true);

  writeFile(canonicalPath, skillMarkdown("runlane-consumer", "Changed guidance."));

  const status = statusPacket({ cwd: fx.cwd, homeDir: fx.homeDir });
  assert.equal(status.ok, false);
  assert.ok(status.issues.some((entry) => entry.code === "manifest_source_hash_stale"));
  assert.ok(status.issues.some((entry) => entry.code === "manifest_source_tree_hash_stale"));
  assert.ok(status.issues.some((entry) => entry.code === "installed_skill_drift"));
});

test("sync refuses canonical skills that violate policy before writing", () => {
  const fx = fixture();
  writeFile(sourcePath(fx, "remogram", "remogram-dogfood"), [
    "---",
    "name: remogram-dogfood",
    "description: Remogram dogfood overlay.",
    "---",
    "",
    "# Remogram Dogfood",
    "",
    "Dogfood lanes may set allow_missing_checks before merge."
  ].join("\n"));

  const packet = syncPacket({
    cwd: fx.cwd,
    homeDir: fx.homeDir,
    provider: "codex",
    tool: "remogram",
    policyPacks: ["generic", "atteway"],
    generatedAt: GENERATED_AT
  });

  assert.equal(packet.ok, false);
  assert.equal(packet.summary.write_count, 0);
  assert.ok(packet.issues.some((entry) => entry.code === "policy_missing_pending_check_waiver_forbidden"));
  assert.equal(fs.existsSync(path.join(fx.homeDir, ".codex", "skills", "remogram-dogfood", "SKILL.md")), false);
});

test("sync copies full skill directories for skill-directory providers", () => {
  const fx = fixture();
  writeFile(sourcePath(fx), skillMarkdown());
  writeFile(path.join(fx.cwd, "agent-skills", "src", "runlane", "runlane-consumer", "scripts", "verify.js"), "console.log('ok');\n");

  const packet = syncPacket({ cwd: fx.cwd, homeDir: fx.homeDir, provider: "claude-code", tool: "runlane", generatedAt: GENERATED_AT });

  assert.equal(packet.ok, true);
  assert.equal(fs.existsSync(path.join(fx.homeDir, ".claude", "skills", "runlane-consumer", "SKILL.md")), true);
  assert.equal(fs.existsSync(path.join(fx.homeDir, ".claude", "skills", "runlane-consumer", "scripts", "verify.js")), true);
  const manifest = JSON.parse(fs.readFileSync(path.join(fx.cwd, "skillpress.manifest.json"), "utf8"));
  assert.deepEqual(manifest.entries[0].files.sort(), ["SKILL.md", "scripts/verify.js"]);
});

test("cursor sync renders an mdc rule and warns about auxiliary files", () => {
  const fx = fixture();
  writeFile(sourcePath(fx), skillMarkdown());
  writeFile(path.join(fx.cwd, "agent-skills", "src", "runlane", "runlane-consumer", "references", "notes.md"), "# Notes\n");

  const packet = syncPacket({ cwd: fx.cwd, homeDir: fx.homeDir, provider: "cursor", tool: "runlane", generatedAt: GENERATED_AT });

  assert.equal(packet.ok, true);
  const cursorRule = path.join(fx.cwd, ".cursor", "rules", "skillpress", "runlane-consumer.mdc");
  assert.equal(fs.existsSync(cursorRule), true);
  const content = fs.readFileSync(cursorRule, "utf8");
  assert.match(content, /^---\ndescription: "Use Runlane facts\."\nalwaysApply: false\n---/);
  assert.ok(packet.issues.some((entry) => entry.code === "cursor_auxiliary_files_ignored"));
});
