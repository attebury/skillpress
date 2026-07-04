import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildDiagramTelemetryEvents } from "./packet.js";

function advisory(code, message, details = {}) {
  return { code, severity: "warning", message, ...details };
}

function eventSummary(event) {
  return {
    event_kind: event.event_kind,
    classification: event.classification,
    impact: event.impact,
    scope: event.scope
  };
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function recordEvent(event, { cwd, env }) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "skillpress-diagram-"));
  const filePath = path.join(tempDir, "event.json");
  try {
    fs.writeFileSync(filePath, `${JSON.stringify(event, null, 2)}\n`, { mode: 0o600 });
    const result = spawnSync("diagram", ["event", "record", "--file", filePath, "--json"], {
      cwd,
      env,
      encoding: "utf8"
    });
    if (result.error) {
      return {
        ok: false,
        advisory: advisory(
          result.error.code === "ENOENT" ? "diagram_cli_unavailable" : "diagram_record_failed",
          "Diagram telemetry was requested but the event could not be recorded; Skillpress result is unchanged",
          { error_code: result.error.code ?? "spawn_failed" }
        )
      };
    }
    const parsed = parseJson(result.stdout);
    if (result.status !== 0) {
      return {
        ok: false,
        advisory: advisory("diagram_record_failed", "Diagram telemetry recording failed; Skillpress result is unchanged", {
          exit_code: result.status,
          error_code: parsed?.error_code ?? null
        })
      };
    }
    if (!parsed || parsed.ok !== true || parsed.type !== "diagram.event_record.v1") {
      return {
        ok: false,
        advisory: advisory("diagram_record_malformed", "Diagram telemetry returned an unexpected packet; Skillpress result is unchanged")
      };
    }
    return {
      ok: true,
      record: {
        ...eventSummary(event),
        event_id: parsed.event_id ?? null,
        fingerprint: parsed.fingerprint ?? null,
        duplicate: parsed.duplicate === true,
        appended: parsed.appended === true
      }
    };
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

export function attachDiagramTelemetry(packet, options = {}) {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const events = buildDiagramTelemetryEvents(packet, {
    cwd,
    command: options.command,
    createdAt: options.createdAt
  });
  const telemetry = {
    requested: true,
    event_count: events.length,
    emitted_count: 0,
    records: [],
    advisories: []
  };

  for (const event of events) {
    const result = recordEvent(event, {
      cwd,
      env: options.env ?? process.env
    });
    if (result.ok) {
      telemetry.emitted_count += 1;
      telemetry.records.push(result.record);
    } else {
      telemetry.advisories.push({
        ...eventSummary(event),
        ...result.advisory
      });
    }
  }

  return {
    ...packet,
    diagram_telemetry: telemetry
  };
}
