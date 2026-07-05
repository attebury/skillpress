import { spawnSync } from "node:child_process";
import path from "node:path";

const MAX_FIELD_LENGTH = 180;
const MAX_SAMPLE_COUNT = 5;
const ALLOWED_COMMANDS = new Set(["sync", "status", "doctor"]);
const SHELL_CONTROL = /[|&;<>()`$\\\n\r]/;
const UNSAFE_VALUE = /\b(?:authorization|bearer|operator[_-]?config|password|secret|token)\b/i;
const AUTHORITY_VALUE = /\b(?:proof|merge readiness|gate status|security status|lane authority|sdlc|review approval|forge write authority)\b/i;
const LOCAL_PATH = /(?:\/Users\/[^\s,;:]+|\/private\/tmp\/[^\s,;:]+|\/tmp\/[^\s,;:]+)/g;

const TELEMETRY_CODES = new Set([
  "installed_skill_drift",
  "installed_skill_missing",
  "installed_skill_file_missing",
  "manifest_source_hash_stale",
  "manifest_skill_md_hash_stale",
  "manifest_source_tree_hash_stale",
  "canonical_source_missing",
  "canonical_source_missing_for_manifest",
  "duplicate_skill_content_conflict",
  "command_contract_unknown",
  "provider_unavailable",
  "provider_auxiliary_files_omitted"
]);

function severityRank(severity) {
  if (severity === "error") {
    return 0;
  }
  if (severity === "warning") {
    return 1;
  }
  return 2;
}

function diagnosticSeverity(entry) {
  const severity = entry?.severity ?? "warning";
  return severity === "advisory" ? "info" : severity;
}

function boundedText(value) {
  const text = String(value ?? "")
    .replace(LOCAL_PATH, "<local-path>")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length === 0 || text.includes("\0") || UNSAFE_VALUE.test(text) || AUTHORITY_VALUE.test(text)) {
    return null;
  }
  return text.length > MAX_FIELD_LENGTH ? `${text.slice(0, MAX_FIELD_LENGTH - 3)}...` : text;
}

function safeScope(key, value) {
  if (!/^[a-z][a-z0-9_-]*$/.test(key)) {
    return null;
  }
  const text = boundedText(value);
  return text ? `${key}=${text}` : null;
}

function safeCommandRef(command) {
  if (!ALLOWED_COMMANDS.has(command)) {
    return null;
  }
  const ref = `skillpress ${command} --json`;
  return SHELL_CONTROL.test(ref) ? null : ref;
}

function packetDiagnostics(command, packet) {
  if (packet?.type === "skillpress_error") {
    return [{
      code: packet.code ?? `${command}_failed`,
      severity: "error",
      skill: null,
      provider: null,
      tool: packet?.filters?.tool ?? null
    }];
  }
  const entries = packet?.issues ?? packet?.findings ?? [];
  return entries
    .map((entry) => ({
      code: entry.code ?? "unknown_diagnostic",
      severity: diagnosticSeverity(entry),
      skill: entry.skill ?? null,
      provider: entry.provider ?? null,
      tool: entry.tool ?? packet?.filters?.tool ?? null
    }))
    .filter((entry) => shouldEmitDiagnostic(command, entry));
}

function shouldEmitDiagnostic(command, entry) {
  if (TELEMETRY_CODES.has(entry.code)) {
    return true;
  }
  return command === "sync" && entry.severity === "error";
}

function classificationFor(code) {
  if (code === "command_contract_unknown") {
    return "cli_contract_gap";
  }
  if (code === "provider_unavailable" || code === "provider_auxiliary_files_omitted") {
    return "provider_failure";
  }
  if (code.startsWith("config_")) {
    return "operator_error";
  }
  if (
    code.startsWith("manifest_") ||
    code.startsWith("installed_skill_") ||
    code === "canonical_source_missing" ||
    code === "canonical_source_missing_for_manifest" ||
    code === "duplicate_skill_content_conflict"
  ) {
    return "resource_failure";
  }
  return "unexpected_blocker";
}

function impactFor(severity, count) {
  if (severity === "error") {
    return "blocking";
  }
  return count > 1 ? "recurring" : "advisory";
}

function nextActionFor(code, command) {
  if (code === "command_contract_unknown") {
    return "Update the command contract or the skill command reference.";
  }
  if (code === "provider_auxiliary_files_omitted") {
    return "Review provider fidelity and choose a full skill-directory provider when auxiliary files are required.";
  }
  if (code === "provider_unavailable") {
    return "Install or enable the requested provider surface, or run Skillpress with an available provider.";
  }
  if (code.startsWith("manifest_") || code.startsWith("installed_skill_")) {
    return "Run skillpress repair-plan --json, then resync the affected managed skill.";
  }
  if (command === "sync") {
    return "Fix the reported sync diagnostic and rerun skillpress sync --json.";
  }
  return "Inspect the Skillpress diagnostic and repair the canonical source or install cache.";
}

function expectedFor(code) {
  if (code === "command_contract_unknown") {
    return "Skill command references match loaded command contracts.";
  }
  if (code === "provider_auxiliary_files_omitted") {
    return "Provider fidelity is explicit when auxiliary Agent Skills files cannot be installed.";
  }
  if (code === "provider_unavailable") {
    return "Requested provider surfaces are available or reported as advisory.";
  }
  return "Installed provider caches match canonical Skillpress sources and manifests.";
}

function groupDiagnostics(command, diagnostics) {
  const groups = new Map();
  for (const diagnostic of diagnostics) {
    const key = [
      diagnostic.code,
      diagnostic.severity,
      diagnostic.provider ?? "",
      diagnostic.tool ?? ""
    ].join("\0");
    const group = groups.get(key) ?? {
      code: diagnostic.code,
      severity: diagnostic.severity,
      provider: diagnostic.provider,
      tool: diagnostic.tool,
      skills: [],
      count: 0
    };
    group.count += 1;
    if (diagnostic.skill && !group.skills.includes(diagnostic.skill)) {
      group.skills.push(diagnostic.skill);
    }
    groups.set(key, group);
  }
  return [...groups.values()].sort((left, right) => (
    severityRank(left.severity) - severityRank(right.severity) ||
    left.code.localeCompare(right.code) ||
    String(left.provider ?? "").localeCompare(String(right.provider ?? "")) ||
    String(left.tool ?? "").localeCompare(String(right.tool ?? ""))
  ));
}

function addPair(argv, flag, value) {
  const safe = boundedText(value);
  if (safe) {
    argv.push(flag, safe);
  }
}

function addRepeated(argv, flag, key, value) {
  const safe = safeScope(key, value);
  if (safe) {
    argv.push(flag, safe);
  }
}

function requestForGroup({ command, packet, cwd, group }) {
  const commandRef = safeCommandRef(command);
  if (!commandRef) {
    return null;
  }
  const classification = classificationFor(group.code);
  const impact = impactFor(group.severity, group.count);
  const repo = path.basename(path.resolve(cwd));
  const sampleSkills = group.skills.sort().slice(0, MAX_SAMPLE_COUNT);
  const argv = ["event", "emit"];

  addPair(argv, "--producer", "skillpress");
  addPair(argv, "--event-kind", group.severity === "error" ? "friction" : "telemetry");
  addPair(argv, "--classification", classification);
  addPair(argv, "--impact", impact);
  addRepeated(argv, "--scope", "repo", repo);
  addRepeated(argv, "--scope", "command", commandRef);
  addRepeated(argv, "--scope", "code", group.code);
  addRepeated(argv, "--scope", "provider", group.provider ?? packet?.filters?.provider ?? "");
  addRepeated(argv, "--scope", "tool", group.tool ?? packet?.filters?.tool ?? "");
  addPair(argv, "--expected", expectedFor(group.code));
  addPair(argv, "--actual", `${group.count} ${group.code} diagnostic${group.count === 1 ? "" : "s"} reported by ${commandRef}.`);
  addRepeated(argv, "--evidence-ref", "command", commandRef);
  addRepeated(argv, "--evidence-snippet", "summary", `${group.code} count=${group.count}`);
  if (sampleSkills.length > 0) {
    addRepeated(argv, "--evidence-snippet", "skills", sampleSkills.join(","));
  }
  addPair(argv, "--suggested-owner", "skillpress");
  addPair(argv, "--suggested-next-action", nextActionFor(group.code, command));
  argv.push("--json");

  return {
    code: group.code,
    count: group.count,
    classification,
    impact,
    provider: group.provider ?? null,
    tool: group.tool ?? null,
    argv
  };
}

export function buildDiagramEmitRequests({ command, packet, cwd = process.cwd() } = {}) {
  const diagnostics = packetDiagnostics(command, packet);
  return groupDiagnostics(command, diagnostics)
    .map((group) => requestForGroup({ command, packet, cwd, group }))
    .filter(Boolean);
}

function advisory(code, message, details = {}) {
  return { code, message, ...details };
}

function parseDiagramOutput(stdout) {
  if (!stdout || stdout.trim().length === 0) {
    return null;
  }
  return JSON.parse(stdout);
}

export function emitDiagramTelemetry({
  command,
  packet,
  cwd = process.cwd(),
  env = process.env,
  diagramCommand = "diagram"
} = {}) {
  const requests = buildDiagramEmitRequests({ command, packet, cwd });
  const advisories = [];
  const emitted = [];

  for (const request of requests) {
    const result = spawnSync(diagramCommand, request.argv, {
      cwd,
      env,
      encoding: "utf8",
      shell: false
    });

    if (result.error) {
      advisories.push(advisory("diagram_cli_unavailable", "Diagram telemetry was requested but the diagram CLI could not be executed.", {
        reason: result.error.code ?? "spawn_failed"
      }));
      continue;
    }

    if (result.status !== 0) {
      let errorCode = "diagram_emit_failed";
      try {
        errorCode = parseDiagramOutput(result.stdout)?.error_code ?? errorCode;
      } catch {
        // Keep advisory bounded; raw stdout is intentionally not reported.
      }
      advisories.push(advisory("diagram_emit_failed", "Diagram telemetry emit returned a non-zero status.", {
        diagram_error_code: errorCode,
        status: result.status
      }));
      continue;
    }

    try {
      const output = parseDiagramOutput(result.stdout);
      if (!output) {
        advisories.push(advisory("diagram_emit_malformed_json", "Diagram telemetry emit returned malformed JSON."));
        continue;
      }
      if (output && output.ok === false) {
        advisories.push(advisory("diagram_emit_rejected", "Diagram telemetry emit was rejected.", {
          diagram_error_code: output.error_code ?? "diagram_rejected"
        }));
        continue;
      }
    } catch {
      advisories.push(advisory("diagram_emit_malformed_json", "Diagram telemetry emit returned malformed JSON."));
      continue;
    }

    emitted.push({
      code: request.code,
      count: request.count,
      classification: request.classification,
      impact: request.impact,
      provider: request.provider,
      tool: request.tool
    });
  }

  return {
    requested: true,
    ok: advisories.length === 0,
    emitted_count: emitted.length,
    skipped_count: requests.length - emitted.length,
    events: emitted,
    advisories
  };
}
