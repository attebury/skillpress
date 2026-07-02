import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const cli = path.join(repoRoot, "bin", "skillpress.js");

test("top-level help prints usage and exits cleanly", () => {
  const result = spawnSync(process.execPath, [cli, "--help"], {
    cwd: repoRoot,
    encoding: "utf8"
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /skillpress boundary --json/);
  assert.match(result.stdout, /--source-layout auto\|tool-scoped\|agent-skills\|claude-skills/);
  assert.equal(result.stderr, "");
});

test("status and doctor JSON commands run against an isolated empty workspace", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "skillpress-cli-"));
  const cwd = path.join(root, "repo");
  const homeDir = path.join(root, "home");
  fs.mkdirSync(cwd, { recursive: true });
  fs.mkdirSync(homeDir, { recursive: true });
  const env = { ...process.env, HOME: homeDir };

  const status = spawnSync(process.execPath, [cli, "status", "--json"], {
    cwd,
    env,
    encoding: "utf8"
  });
  assert.equal(status.status, 0, status.stderr);
  assert.equal(JSON.parse(status.stdout).type, "skillpress_status");

  const doctor = spawnSync(process.execPath, [cli, "doctor", "--json"], {
    cwd,
    env,
    encoding: "utf8"
  });
  assert.equal(doctor.status, 0, doctor.stderr);
  assert.equal(JSON.parse(doctor.stdout).type, "skillpress_doctor");
});

test("sync JSON command installs a canonical skill into an isolated provider root", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "skillpress-cli-sync-"));
  const cwd = path.join(root, "repo");
  const homeDir = path.join(root, "home");
  fs.mkdirSync(path.join(cwd, "agent-skills", "src", "runlane", "runlane-consumer"), { recursive: true });
  fs.mkdirSync(homeDir, { recursive: true });
  fs.writeFileSync(path.join(cwd, "agent-skills", "src", "runlane", "runlane-consumer", "SKILL.md"), [
    "---",
    "name: runlane-consumer",
    "description: Use Runlane facts.",
    "---",
    "",
    "# Runlane Consumer",
    ""
  ].join("\n"));
  const env = { ...process.env, HOME: homeDir };

  const sync = spawnSync(process.execPath, [cli, "sync", "--json", "--provider", "codex", "--tool", "runlane"], {
    cwd,
    env,
    encoding: "utf8"
  });

  assert.equal(sync.status, 0, sync.stderr || sync.stdout);
  const packet = JSON.parse(sync.stdout);
  assert.equal(packet.type, "skillpress_sync");
  assert.equal(packet.summary.write_count, 1);
  assert.equal(fs.existsSync(path.join(homeDir, ".codex", "skills", "runlane-consumer", "SKILL.md")), true);
  assert.equal(fs.existsSync(path.join(cwd, "skillpress.manifest.json")), true);
});

test("CLI accepts source layout, policy, config, and cursor provider options", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "skillpress-cli-config-"));
  const cwd = path.join(root, "repo");
  const homeDir = path.join(root, "home");
  fs.mkdirSync(path.join(cwd, "skills", "alpha"), { recursive: true });
  fs.mkdirSync(homeDir, { recursive: true });
  fs.writeFileSync(path.join(cwd, "skills", "alpha", "SKILL.md"), [
    "---",
    "name: alpha",
    "description: Alpha skill.",
    "---",
    "",
    "# Alpha",
    ""
  ].join("\n"));
  fs.writeFileSync(path.join(cwd, "skillpress.config.json"), JSON.stringify({
    source_roots: [{ path: "skills", layout: "agent-skills" }],
    policy_packs: ["generic"],
    providers: ["cursor"]
  }));
  const env = { ...process.env, HOME: homeDir };

  const sync = spawnSync(process.execPath, [
    cli,
    "sync",
    "--json",
    "--config",
    "skillpress.config.json",
    "--source-layout",
    "agent-skills",
    "--policy",
    "generic",
    "--provider",
    "cursor"
  ], {
    cwd,
    env,
    encoding: "utf8"
  });

  assert.equal(sync.status, 0, sync.stderr || sync.stdout);
  assert.equal(fs.existsSync(path.join(cwd, ".cursor", "rules", "skillpress", "alpha.mdc")), true);
});

test("CLI rejects unsupported source layout option", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "skillpress-cli-layout-"));
  const cwd = path.join(root, "repo");
  const homeDir = path.join(root, "home");
  fs.mkdirSync(cwd, { recursive: true });
  fs.mkdirSync(homeDir, { recursive: true });
  const env = { ...process.env, HOME: homeDir };

  const doctor = spawnSync(process.execPath, [
    cli,
    "doctor",
    "--json",
    "--source-layout",
    "private-layout"
  ], {
    cwd,
    env,
    encoding: "utf8"
  });

  assert.equal(doctor.status, 1, doctor.stderr || doctor.stdout);
  const packet = JSON.parse(doctor.stdout);
  assert.equal(packet.ok, false);
  assert.ok(packet.findings.some((entry) => entry.code === "config_invalid_source_layout"));
});

test("config rejects unsupported source layout", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "skillpress-cli-config-layout-"));
  const cwd = path.join(root, "repo");
  const homeDir = path.join(root, "home");
  fs.mkdirSync(path.join(cwd, "agent-skills", "src", "runlane", "runlane-consumer"), { recursive: true });
  fs.mkdirSync(homeDir, { recursive: true });
  fs.writeFileSync(path.join(cwd, "agent-skills", "src", "runlane", "runlane-consumer", "SKILL.md"), [
    "---",
    "name: runlane-consumer",
    "description: Use Runlane facts.",
    "---",
    "",
    "# Runlane Consumer",
    ""
  ].join("\n"));
  fs.writeFileSync(path.join(cwd, "skillpress.config.json"), JSON.stringify({
    source_roots: [{ path: "agent-skills/src", layout: "private-layout" }],
    policy_packs: ["generic"],
    providers: ["codex"]
  }));
  const env = { ...process.env, HOME: homeDir };

  const sync = spawnSync(process.execPath, [
    cli,
    "sync",
    "--json",
    "--config",
    "skillpress.config.json",
    "--provider",
    "codex"
  ], {
    cwd,
    env,
    encoding: "utf8"
  });

  assert.equal(sync.status, 1, sync.stderr || sync.stdout);
  const packet = JSON.parse(sync.stdout);
  assert.equal(packet.ok, false);
  assert.ok(packet.issues.some((entry) => entry.code === "config_invalid_source_layout"));
});

test("Runlane and Remogram examples dry-run sync and doctor", () => {
  const cases = [
    { directory: "runlane", tool: "runlane" },
    { directory: "remogram", tool: "remogram" }
  ];

  for (const example of cases) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `skillpress-example-${example.directory}-`));
    const homeDir = path.join(root, "home");
    fs.mkdirSync(homeDir, { recursive: true });
    const env = { ...process.env, HOME: homeDir };
    const cwd = path.join(repoRoot, "examples", example.directory);

    const sync = spawnSync(process.execPath, [
      cli,
      "sync",
      "--json",
      "--config",
      "skillpress.config.json",
      "--provider",
      "codex",
      "--tool",
      example.tool,
      "--dry-run"
    ], {
      cwd,
      env,
      encoding: "utf8"
    });

    assert.equal(sync.status, 0, sync.stderr || sync.stdout);
    const syncPacket = JSON.parse(sync.stdout);
    assert.equal(syncPacket.ok, true);
    assert.equal(syncPacket.source_roots[0].layout, "tool-scoped");
    assert.equal(syncPacket.summary.source_count, 1);

    const doctor = spawnSync(process.execPath, [
      cli,
      "doctor",
      "--json",
      "--config",
      "skillpress.config.json",
      "--tool",
      example.tool
    ], {
      cwd,
      env,
      encoding: "utf8"
    });

    assert.equal(doctor.status, 0, doctor.stderr || doctor.stdout);
    assert.equal(JSON.parse(doctor.stdout).ok, true);
  }
});
