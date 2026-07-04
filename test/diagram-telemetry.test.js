import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildDiagramTelemetryEvents, validateDiagramEvent } from "../src/diagram/packet.js";

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const cli = path.join(repoRoot, "bin", "skillpress.js");

function fixture(prefix = "skillpress-diagram-") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
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

function skillMarkdown(name = "runlane-consumer") {
  return [
    "---",
    `name: ${name}`,
    "description: Use Runlane facts.",
    "---",
    "",
    `# ${name}`,
    ""
  ].join("\n");
}

function writeFakeDiagram(binDir, behavior = "success") {
  const script = [
    "#!/usr/bin/env node",
    "const fs = require('node:fs');",
    "const path = require('node:path');",
    "const args = process.argv.slice(2);",
    "const file = args[args.indexOf('--file') + 1];",
    "const packet = JSON.parse(fs.readFileSync(file, 'utf8'));",
    "if (packet.authority !== 'telemetry_only') process.exit(2);",
    "if (packet.producer !== 'skillpress') process.exit(3);",
    behavior === "malformed"
      ? "process.stdout.write('not-json');"
      : behavior === "failed"
        ? "process.stdout.write(JSON.stringify({ ok: false, type: 'diagram.error.v1', error_code: 'store_readonly' })); process.exit(1);"
        : "process.stdout.write(JSON.stringify({ ok: true, type: 'diagram.event_record.v1', event_id: 'evt_1234567890abcdef12345678', fingerprint: 'fp_' + 'a'.repeat(64), duplicate: false, appended: true, storage_root: path.join(process.cwd(), '.diagram') }));"
  ].join("\n");
  const filePath = path.join(binDir, "diagram");
  fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(filePath, script);
  fs.chmodSync(filePath, 0o755);
}

function envWithFakeDiagram(fx, binDir) {
  return {
    ...process.env,
    HOME: fx.homeDir,
    PATH: `${binDir}${path.delimiter}${process.env.PATH}`
  };
}

test("diagram telemetry builds bounded deterministic events from Skillpress diagnostics", () => {
  const packet = {
    ok: true,
    type: "skillpress_sync",
    schema_version: 1,
    status: "synced",
    filters: { tool: "runlane", provider: "cursor" },
    issues: [
      {
        code: "provider_auxiliary_files_omitted",
        severity: "warning",
        message: "Rule-render providers cannot consume auxiliary Agent Skills files directly",
        provider: "cursor",
        skill: "runlane-consumer",
        path: "/Users/operator/.cursor/rules/skillpress/runlane-consumer.mdc"
      }
    ]
  };

  const first = buildDiagramTelemetryEvents(packet, {
    cwd: repoRoot,
    command: "skillpress sync --json",
    createdAt: "2026-07-04T00:00:00.000Z"
  })[0];
  const second = buildDiagramTelemetryEvents(packet, {
    cwd: repoRoot,
    command: "skillpress sync --json",
    createdAt: "2026-07-04T00:01:00.000Z"
  })[0];

  assert.equal(first.type, "diagram.diagnostic_event.v1");
  assert.equal(first.producer, "skillpress");
  assert.equal(first.authority, "telemetry_only");
  assert.equal(first.classification, "provider_failure");
  assert.equal(first.impact, "advisory");
  assert.equal(first.scope.tool, "runlane");
  assert.equal(first.scope.provider, "cursor");
  assert.doesNotMatch(JSON.stringify(first), /\/Users\/operator|runlane-consumer\.mdc/);
  assert.equal(first.actual, second.actual);
  assert.deepEqual(first.evidence, second.evidence);
});

test("diagram telemetry validation rejects authority claims and shell command refs", () => {
  const [event] = buildDiagramTelemetryEvents({
    ok: false,
    type: "skillpress_doctor",
    schema_version: 1,
    status: "fail",
    findings: [{ severity: "error", code: "installed_skill_missing", message: "Missing", provider: "codex", skill: "alpha", path: null }],
    filters: { tool: "runlane", provider: null }
  }, {
    cwd: repoRoot,
    command: "skillpress doctor --json",
    createdAt: "2026-07-04T00:00:00.000Z"
  });

  assert.throws(() => validateDiagramEvent({ ...event, merge_readiness: "ready" }), /authority/);
  assert.throws(() => validateDiagramEvent({
    ...event,
    scope: { ...event.scope, command: "skillpress doctor --json && echo unsafe" }
  }), /command/);
  assert.throws(() => validateDiagramEvent({
    ...event,
    evidence: { logs: "raw output" }
  }), /unsafe/);
});

test("sync opt-in telemetry records a Diagram event without changing Skillpress status", () => {
  const fx = fixture();
  const binDir = path.join(fx.root, "bin");
  writeFakeDiagram(binDir);
  writeFile(path.join(fx.cwd, "agent-skills", "src", "runlane", "runlane-consumer", "SKILL.md"), skillMarkdown());
  writeFile(path.join(fx.cwd, "agent-skills", "src", "runlane", "runlane-consumer", "references", "extra.md"), "extra\n");

  const result = spawnSync(process.execPath, [
    cli,
    "sync",
    "--json",
    "--provider",
    "cursor",
    "--tool",
    "runlane",
    "--diagram-telemetry"
  ], {
    cwd: fx.cwd,
    env: envWithFakeDiagram(fx, binDir),
    encoding: "utf8"
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const packet = JSON.parse(result.stdout);
  assert.equal(packet.ok, true);
  assert.equal(packet.status, "synced");
  assert.equal(packet.diagram_telemetry.requested, true);
  assert.equal(packet.diagram_telemetry.event_count, 1);
  assert.equal(packet.diagram_telemetry.emitted_count, 1);
  assert.equal(packet.diagram_telemetry.records[0].classification, "provider_failure");
});

test("doctor opt-in telemetry cannot turn failed doctor into pass", () => {
  const fx = fixture();
  const binDir = path.join(fx.root, "bin");
  writeFakeDiagram(binDir);
  fs.mkdirSync(path.join(fx.homeDir, ".codex", "skills", "remogram-consumer"), { recursive: true });
  fs.mkdirSync(path.join(fx.homeDir, ".agents", "skills", "remogram-consumer"), { recursive: true });
  writeFile(path.join(fx.homeDir, ".codex", "skills", "remogram-consumer", "SKILL.md"), "# Remogram\n");
  writeFile(path.join(fx.homeDir, ".agents", "skills", "remogram-consumer", "SKILL.md"), "# Remogram drift\n");

  const result = spawnSync(process.execPath, [
    cli,
    "doctor",
    "--json",
    "--diagram-telemetry"
  ], {
    cwd: fx.cwd,
    env: envWithFakeDiagram(fx, binDir),
    encoding: "utf8"
  });

  assert.equal(result.status, 1, result.stderr || result.stdout);
  const packet = JSON.parse(result.stdout);
  assert.equal(packet.ok, false);
  assert.equal(packet.status, "fail");
  assert.equal(packet.diagram_telemetry.emitted_count, 1);
  assert.ok(packet.findings.some((entry) => entry.code === "duplicate_skill_content_conflict"));
});

test("missing or failed Diagram CLI is advisory only when telemetry is requested", () => {
  const fx = fixture();
  writeFile(path.join(fx.cwd, "agent-skills", "src", "runlane", "runlane-consumer", "SKILL.md"), skillMarkdown());
  writeFile(path.join(fx.cwd, "agent-skills", "src", "runlane", "runlane-consumer", "references", "extra.md"), "extra\n");

  const missing = spawnSync(process.execPath, [
    cli,
    "sync",
    "--json",
    "--provider",
    "cursor",
    "--tool",
    "runlane",
    "--diagram-telemetry"
  ], {
    cwd: fx.cwd,
    env: { ...process.env, HOME: fx.homeDir, PATH: path.join(fx.root, "missing-bin") },
    encoding: "utf8"
  });

  assert.equal(missing.status, 0, missing.stderr || missing.stdout);
  const missingPacket = JSON.parse(missing.stdout);
  assert.equal(missingPacket.ok, true);
  assert.equal(missingPacket.diagram_telemetry.emitted_count, 0);
  assert.equal(missingPacket.diagram_telemetry.advisories[0].code, "diagram_cli_unavailable");

  const binDir = path.join(fx.root, "bin-failed");
  writeFakeDiagram(binDir, "failed");
  const failed = spawnSync(process.execPath, [
    cli,
    "sync",
    "--json",
    "--provider",
    "cursor",
    "--tool",
    "runlane",
    "--diagram-telemetry",
    "--dry-run"
  ], {
    cwd: fx.cwd,
    env: envWithFakeDiagram(fx, binDir),
    encoding: "utf8"
  });

  assert.equal(failed.status, 0, failed.stderr || failed.stdout);
  const failedPacket = JSON.parse(failed.stdout);
  assert.equal(failedPacket.ok, true);
  assert.equal(failedPacket.diagram_telemetry.advisories[0].code, "diagram_record_failed");
});

test("config can opt into telemetry without shell hook fields", () => {
  const fx = fixture();
  const binDir = path.join(fx.root, "bin");
  writeFakeDiagram(binDir);
  writeFile(path.join(fx.cwd, "skillpress.config.json"), JSON.stringify({
    source_roots: [{ path: "agent-skills/src", layout: "tool-scoped" }],
    providers: ["cursor"],
    diagram: { telemetry: true }
  }));
  writeFile(path.join(fx.cwd, "agent-skills", "src", "runlane", "runlane-consumer", "SKILL.md"), skillMarkdown());
  writeFile(path.join(fx.cwd, "agent-skills", "src", "runlane", "runlane-consumer", "references", "extra.md"), "extra\n");

  const result = spawnSync(process.execPath, [
    cli,
    "sync",
    "--json",
    "--config",
    "skillpress.config.json",
    "--tool",
    "runlane"
  ], {
    cwd: fx.cwd,
    env: envWithFakeDiagram(fx, binDir),
    encoding: "utf8"
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const packet = JSON.parse(result.stdout);
  assert.equal(packet.config.diagram.telemetry, true);
  assert.equal(packet.diagram_telemetry.emitted_count, 1);

  writeFile(path.join(fx.cwd, "skillpress.config.json"), JSON.stringify({
    diagram: { command: "diagram event record" }
  }));
  const invalid = spawnSync(process.execPath, [
    cli,
    "doctor",
    "--json",
    "--config",
    "skillpress.config.json"
  ], {
    cwd: fx.cwd,
    env: envWithFakeDiagram(fx, binDir),
    encoding: "utf8"
  });
  assert.equal(invalid.status, 1, invalid.stderr || invalid.stdout);
  assert.ok(JSON.parse(invalid.stdout).findings.some((entry) => entry.code === "config_invalid_diagram_field"));
});
