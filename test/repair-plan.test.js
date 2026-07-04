import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { repairPlanPacket } from "../src/repair-plan.js";
import { syncPacket } from "../src/sync.js";

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const cli = path.join(repoRoot, "bin", "skillpress.js");

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "skillpress-repair-plan-"));
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

function writeToolSkill(fx, tool = "runlane", skill = "runlane-consumer") {
  writeFile(path.join(fx.cwd, "agent-skills", "src", tool, skill, "SKILL.md"), [
    "---",
    `name: ${skill}`,
    `description: Use ${tool}.`,
    "---",
    "",
    `# ${skill}`,
    ""
  ].join("\n"));
}

function ensureCodex(fx) {
  fs.mkdirSync(path.join(fx.homeDir, ".codex"), { recursive: true });
}

function action(packet, name) {
  return packet.actions.find((entry) => entry.action === name);
}

test("repair plan reports duplicate content conflicts without marking cleanup executable", () => {
  const fx = fixture();
  writeFile(path.join(fx.homeDir, ".codex", "skills", "alpha", "SKILL.md"), "# Alpha\n");
  writeFile(path.join(fx.homeDir, ".agents", "skills", "alpha", "SKILL.md"), "# Alpha drift\n");

  const packet = repairPlanPacket({ cwd: fx.cwd, homeDir: fx.homeDir });

  assert.equal(packet.ok, true);
  assert.equal(packet.type, "skillpress_repair_plan");
  assert.equal(packet.status, "planned");
  const duplicate = action(packet, "resolve_duplicate_conflict");
  assert.equal(duplicate.skill, "alpha");
  assert.equal(duplicate.safe_to_execute, false);
  assert.equal(duplicate.requires_operator_review, true);
  assert.ok(packet.blocked_actions.some((entry) => entry.action === "resolve_duplicate_conflict"));
});

test("repair plan composes with tool scoping and ignores unrelated drift", () => {
  const fx = fixture();
  ensureCodex(fx);
  writeToolSkill(fx);
  assert.equal(syncPacket({ cwd: fx.cwd, homeDir: fx.homeDir, provider: "codex", tool: "runlane" }).ok, true);
  writeFile(path.join(fx.homeDir, ".codex", "skills", "remogram-consumer", "SKILL.md"), "# Remogram\n");
  writeFile(path.join(fx.homeDir, ".agents", "skills", "remogram-consumer", "SKILL.md"), "# Remogram drift\n");

  const scoped = repairPlanPacket({ cwd: fx.cwd, homeDir: fx.homeDir, tool: "runlane" });
  const global = repairPlanPacket({ cwd: fx.cwd, homeDir: fx.homeDir });

  assert.equal(scoped.status, "clean");
  assert.equal(scoped.actions.length, 0);
  assert.equal(global.status, "planned");
  assert.ok(global.actions.some((entry) => entry.action === "resolve_duplicate_conflict"));
});

test("repair plan recommends sync for managed missing installs", () => {
  const fx = fixture();
  ensureCodex(fx);
  writeToolSkill(fx);
  assert.equal(syncPacket({ cwd: fx.cwd, homeDir: fx.homeDir, provider: "codex", tool: "runlane" }).ok, true);
  fs.unlinkSync(path.join(fx.homeDir, ".codex", "skills", "runlane-consumer", "SKILL.md"));

  const packet = repairPlanPacket({ cwd: fx.cwd, homeDir: fx.homeDir, tool: "runlane" });
  const sync = action(packet, "sync_managed_install");

  assert.equal(packet.status, "planned");
  assert.equal(sync.provider, "codex");
  assert.equal(sync.skill, "runlane-consumer");
  assert.equal(sync.suggested_command, "skillpress sync --json --tool runlane --provider codex");
  assert.equal(sync.safe_to_execute, false);
});

test("repair plan reports unmanaged installs for manual inspection", () => {
  const fx = fixture();
  ensureCodex(fx);
  writeToolSkill(fx);
  assert.equal(syncPacket({ cwd: fx.cwd, homeDir: fx.homeDir, provider: "codex", tool: "runlane" }).ok, true);
  writeFile(path.join(fx.homeDir, ".codex", "skills", "unmanaged", "SKILL.md"), "# Unmanaged\n");

  const packet = repairPlanPacket({ cwd: fx.cwd, homeDir: fx.homeDir });
  const unmanaged = action(packet, "inspect_unmanaged_install");

  assert.equal(unmanaged.skill, "unmanaged");
  assert.equal(unmanaged.provider, "codex");
  assert.equal(unmanaged.safe_to_execute, false);
});

test("repair plan identifies identical duplicates as future prune candidates only", () => {
  const fx = fixture();
  writeFile(path.join(fx.homeDir, ".codex", "skills", "alpha", "SKILL.md"), "# Alpha\n");
  writeFile(path.join(fx.homeDir, ".agents", "skills", "alpha", "SKILL.md"), "# Alpha\n");

  const packet = repairPlanPacket({ cwd: fx.cwd, homeDir: fx.homeDir });
  const prune = action(packet, "prune_duplicate_identical");

  assert.equal(packet.ok, true);
  assert.equal(packet.status, "planned");
  assert.equal(prune.skill, "alpha");
  assert.equal(prune.safe_to_execute, false);
  assert.equal(packet.blocked_actions.length, 0);
});

test("repair plan maps missing canonical source roots to source config repair", () => {
  const fx = fixture();
  writeFile(path.join(fx.homeDir, ".codex", "skills", "alpha", "SKILL.md"), "# Alpha\n");

  const packet = repairPlanPacket({ cwd: fx.cwd, homeDir: fx.homeDir });
  const sourceConfig = action(packet, "fix_source_config");

  assert.equal(packet.ok, true);
  assert.equal(sourceConfig.reason_codes.includes("canonical_source_root_missing"), true);
  assert.equal(sourceConfig.safe_to_execute, false);
});

test("repair plan is clean for an empty isolated workspace", () => {
  const fx = fixture();

  const packet = repairPlanPacket({ cwd: fx.cwd, homeDir: fx.homeDir });

  assert.equal(packet.ok, true);
  assert.equal(packet.status, "clean");
  assert.equal(packet.actions.length, 0);
  assert.equal(packet.blocked_actions.length, 0);
});

test("repair plan blocks symlinked installed provider-cache entries", () => {
  const fx = fixture();
  const target = path.join(fx.root, "outside-skill");
  fs.mkdirSync(target, { recursive: true });
  writeFile(path.join(target, "SKILL.md"), "# Linked\n");
  fs.mkdirSync(path.join(fx.homeDir, ".codex", "skills"), { recursive: true });
  fs.symlinkSync(target, path.join(fx.homeDir, ".codex", "skills", "linked"), "dir");

  const packet = repairPlanPacket({ cwd: fx.cwd, homeDir: fx.homeDir });
  const manual = action(packet, "manual_review");

  assert.equal(packet.status, "planned");
  assert.equal(manual.skill, "linked");
  assert.equal(manual.reason_codes.includes("installed_skill_symlink"), true);
  assert.ok(packet.blocked_actions.some((entry) => entry.reason_codes.includes("installed_skill_symlink")));
});

test("repair plan fails closed when source roots escape the repository", () => {
  const fx = fixture();

  const packet = repairPlanPacket({ cwd: fx.cwd, homeDir: fx.homeDir, sourceRoot: path.join(fx.root, "outside") });

  assert.equal(packet.ok, false);
  assert.equal(packet.status, "blocked");
  assert.ok(packet.blocked_actions.some((entry) => entry.reason_codes.includes("canonical_source_root_outside_repo")));
});

test("repair-plan CLI is read-only for provider roots", () => {
  const fx = fixture();
  const codexSkill = path.join(fx.homeDir, ".codex", "skills", "alpha", "SKILL.md");
  const agentsSkill = path.join(fx.homeDir, ".agents", "skills", "alpha", "SKILL.md");
  writeFile(codexSkill, "# Alpha\n");
  writeFile(agentsSkill, "# Alpha drift\n");
  const before = {
    codex: fs.readFileSync(codexSkill, "utf8"),
    agents: fs.readFileSync(agentsSkill, "utf8")
  };

  const result = spawnSync(process.execPath, [cli, "repair-plan", "--json"], {
    cwd: fx.cwd,
    env: { ...process.env, HOME: fx.homeDir },
    encoding: "utf8"
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const packet = JSON.parse(result.stdout);
  assert.equal(packet.type, "skillpress_repair_plan");
  assert.equal(fs.readFileSync(codexSkill, "utf8"), before.codex);
  assert.equal(fs.readFileSync(agentsSkill, "utf8"), before.agents);
  assert.equal(fs.existsSync(path.join(fx.cwd, "skillpress.manifest.json")), false);
});
