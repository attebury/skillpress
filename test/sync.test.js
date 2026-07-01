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

function sourcePath(fx, tool = "runlane", skill = "runlane-consumer") {
  return path.join(fx.cwd, "agent-skills", "src", tool, skill, "SKILL.md");
}

test("sync renders canonical skills into installable provider roots and updates manifest", () => {
  const fx = fixture();
  writeFile(sourcePath(fx), [
    "---",
    "name: runlane-consumer",
    "---",
    "",
    "# Runlane Consumer",
    "",
    "```bash",
    "runlane status --json",
    "runlane verify build --json",
    "```",
    ""
  ].join("\n"));

  const packet = syncPacket({ cwd: fx.cwd, homeDir: fx.homeDir, tool: "runlane", generatedAt: GENERATED_AT });

  assert.equal(packet.ok, true);
  assert.equal(packet.summary.write_count, 3);
  assert.deepEqual(packet.writes.map((entry) => entry.provider).sort(), ["agents", "codex", "cursor"]);
  for (const write of packet.writes) {
    assert.equal(write.written, true);
    assert.equal(fs.existsSync(write.installed_path), true);
    const content = fs.readFileSync(write.installed_path, "utf8");
    assert.match(content, /<!-- skillpress/);
    assert.match(content, new RegExp(`target: ${write.provider}`));
    assert.match(content, /source_path: agent-skills\/src\/runlane\/runlane-consumer\/SKILL.md/);
  }

  const manifest = JSON.parse(fs.readFileSync(path.join(fx.cwd, "skillpress.manifest.json"), "utf8"));
  assert.equal(manifest.entries.length, 3);
  assert.ok(manifest.entries.some((entry) => entry.provider === "codex" && entry.installed_path.startsWith("~/")));
  assert.ok(manifest.entries.some((entry) => entry.provider === "cursor" && entry.installed_path === ".cursor/skills/runlane-consumer/SKILL.md"));

  const status = statusPacket({ cwd: fx.cwd, homeDir: fx.homeDir });
  assert.equal(status.ok, true);
  assert.equal(status.status, "pass");
  assert.equal(status.summary.source_drift_count, 0);
  assert.equal(status.summary.conflict_count, 0);
});

test("sync dry-run reports writes without mutating roots or manifest", () => {
  const fx = fixture();
  writeFile(sourcePath(fx), "# Runlane Consumer\n");

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
  writeFile(canonicalPath, "# Runlane Consumer\n\nInitial guidance.\n");
  assert.equal(syncPacket({ cwd: fx.cwd, homeDir: fx.homeDir, provider: "codex", tool: "runlane", generatedAt: GENERATED_AT }).ok, true);

  writeFile(canonicalPath, "# Runlane Consumer\n\nChanged guidance.\n");

  const status = statusPacket({ cwd: fx.cwd, homeDir: fx.homeDir });
  assert.equal(status.ok, false);
  assert.ok(status.issues.some((entry) => entry.code === "manifest_source_hash_stale"));
  assert.ok(status.issues.some((entry) => entry.code === "installed_skill_drift"));
});

test("sync refuses canonical skills that violate policy before writing", () => {
  const fx = fixture();
  writeFile(sourcePath(fx, "remogram", "remogram-dogfood"), [
    "# Remogram Dogfood",
    "",
    "Dogfood lanes may set allow_missing_checks before merge."
  ].join("\n"));

  const packet = syncPacket({ cwd: fx.cwd, homeDir: fx.homeDir, provider: "codex", tool: "remogram", generatedAt: GENERATED_AT });

  assert.equal(packet.ok, false);
  assert.equal(packet.summary.write_count, 0);
  assert.ok(packet.issues.some((entry) => entry.code === "policy_missing_pending_check_waiver_forbidden"));
  assert.equal(fs.existsSync(path.join(fx.homeDir, ".codex", "skills", "remogram-dogfood", "SKILL.md")), false);
});
