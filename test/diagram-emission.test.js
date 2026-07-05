import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildDiagramEmitRequests, emitDiagramTelemetry } from "../src/diagram-emission.js";

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "skillpress-diagram-"));
  const cwd = path.join(root, "repo");
  fs.mkdirSync(cwd, { recursive: true });
  return { root, cwd };
}

function driftPacket() {
  return {
    ok: false,
    type: "skillpress_status",
    schema_version: 1,
    filters: {
      provider: "codex",
      tool: "runlane"
    },
    issues: [
      {
        code: "installed_skill_drift",
        severity: "error",
        skill: "runlane-consumer",
        provider: "codex",
        path: path.join("/", "Users", "attebury", ".codex", "skills", "runlane-consumer", "SKILL.md")
      },
      {
        code: "installed_skill_drift",
        severity: "error",
        skill: "runlane-core",
        provider: "codex",
        path: "/private/tmp/skillpress/SKILL.md"
      },
      {
        code: "markdown_fence_unbalanced",
        severity: "error",
        skill: "unrelated",
        provider: "codex"
      }
    ]
  };
}

function writeFakeDiagram(root) {
  const fake = path.join(root, "diagram");
  fs.writeFileSync(fake, [
    "#!/usr/bin/env node",
    "const fs = require('node:fs');",
    "fs.appendFileSync(process.env.DIAGRAM_CAPTURE, JSON.stringify(process.argv.slice(2)) + '\\n');",
    "if (process.env.DIAGRAM_EXIT) { process.exit(Number(process.env.DIAGRAM_EXIT)); }",
    "if (process.env.DIAGRAM_EMPTY) { process.exit(0); }",
    "if (process.env.DIAGRAM_MALFORMED) { process.stdout.write('{'); process.exit(0); }",
    "process.stdout.write(JSON.stringify({ ok: true, type: 'diagram.event_emit.v1', fingerprint: 'test-fingerprint' }) + '\\n');"
  ].join("\n"));
  fs.chmodSync(fake, 0o755);
  return fake;
}

test("buildDiagramEmitRequests groups drift diagnostics into bounded field argv", () => {
  const fx = fixture();
  const requests = buildDiagramEmitRequests({
    command: "status",
    packet: driftPacket(),
    cwd: fx.cwd
  });

  assert.equal(requests.length, 1);
  assert.equal(requests[0].code, "installed_skill_drift");
  assert.equal(requests[0].count, 2);
  assert.equal(requests[0].classification, "resource_failure");
  assert.equal(requests[0].impact, "blocking");
  assert.deepEqual(requests[0].argv.slice(0, 2), ["event", "emit"]);
  assert.ok(requests[0].argv.includes("--producer"));
  assert.ok(requests[0].argv.includes("skillpress"));
  assert.ok(requests[0].argv.includes("--expected"));
  assert.ok(requests[0].argv.includes("--actual"));
  assert.ok(requests[0].argv.includes("--evidence-snippet"));
  assert.ok(!requests[0].argv.join(" ").includes(path.join("/", "Users", "attebury")));
  assert.ok(!requests[0].argv.join(" ").includes(path.join("/", "private", "tmp")));
  assert.ok(!requests[0].argv.join(" ").includes("SKILL.md"));
});

test("emitDiagramTelemetry runs diagram event emit with scalar and repeated fields", () => {
  const fx = fixture();
  const capture = path.join(fx.root, "capture.jsonl");
  const fake = writeFakeDiagram(fx.root);
  const telemetry = emitDiagramTelemetry({
    command: "status",
    packet: driftPacket(),
    cwd: fx.cwd,
    env: { ...process.env, DIAGRAM_CAPTURE: capture },
    diagramCommand: fake
  });

  assert.equal(telemetry.ok, true);
  assert.equal(telemetry.emitted_count, 1);
  assert.equal(telemetry.skipped_count, 0);
  assert.equal(telemetry.events[0].code, "installed_skill_drift");

  const [argv] = fs.readFileSync(capture, "utf8").trim().split("\n").map((line) => JSON.parse(line));
  assert.deepEqual(argv.slice(0, 2), ["event", "emit"]);
  assert.ok(argv.includes("--scope"));
  assert.ok(argv.includes("command=skillpress status --json"));
  assert.ok(argv.includes("--json"));
});

test("emitDiagramTelemetry reports missing and failed diagram as advisory only", () => {
  const fx = fixture();
  const missing = emitDiagramTelemetry({
    command: "status",
    packet: driftPacket(),
    cwd: fx.cwd,
    diagramCommand: path.join(fx.root, "missing-diagram")
  });

  assert.equal(missing.ok, false);
  assert.equal(missing.emitted_count, 0);
  assert.equal(missing.advisories[0].code, "diagram_cli_unavailable");

  const capture = path.join(fx.root, "capture.jsonl");
  const fake = writeFakeDiagram(fx.root);
  const failed = emitDiagramTelemetry({
    command: "status",
    packet: driftPacket(),
    cwd: fx.cwd,
    env: { ...process.env, DIAGRAM_CAPTURE: capture, DIAGRAM_EXIT: "7" },
    diagramCommand: fake
  });

  assert.equal(failed.ok, false);
  assert.equal(failed.emitted_count, 0);
  assert.equal(failed.advisories[0].code, "diagram_emit_failed");
});

test("emitDiagramTelemetry treats malformed diagram JSON as advisory only", () => {
  const fx = fixture();
  const capture = path.join(fx.root, "capture.jsonl");
  const fake = writeFakeDiagram(fx.root);
  const telemetry = emitDiagramTelemetry({
    command: "status",
    packet: driftPacket(),
    cwd: fx.cwd,
    env: { ...process.env, DIAGRAM_CAPTURE: capture, DIAGRAM_MALFORMED: "1" },
    diagramCommand: fake
  });

  assert.equal(telemetry.ok, false);
  assert.equal(telemetry.emitted_count, 0);
  assert.equal(telemetry.advisories[0].code, "diagram_emit_malformed_json");
});

test("emitDiagramTelemetry treats empty diagram JSON as advisory only", () => {
  const fx = fixture();
  const capture = path.join(fx.root, "capture.jsonl");
  const fake = writeFakeDiagram(fx.root);
  const telemetry = emitDiagramTelemetry({
    command: "status",
    packet: driftPacket(),
    cwd: fx.cwd,
    env: { ...process.env, DIAGRAM_CAPTURE: capture, DIAGRAM_EMPTY: "1" },
    diagramCommand: fake
  });

  assert.equal(telemetry.ok, false);
  assert.equal(telemetry.emitted_count, 0);
  assert.equal(telemetry.advisories[0].code, "diagram_emit_malformed_json");
});
