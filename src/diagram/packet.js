import fs from "node:fs";
import path from "node:path";

export const DIAGRAM_EVENT_TYPE = "diagram.diagnostic_event.v1";

const EVENT_KINDS = new Set(["diagnostic", "friction", "telemetry"]);
const CLASSIFICATIONS = new Set([
  "cli_contract_gap",
  "unexpected_blocker",
  "misleading_output",
  "resource_failure",
  "provider_failure",
  "docs_gap",
  "operator_error"
]);
const IMPACTS = new Set(["info", "advisory", "blocking", "recurring"]);
const REQUIRED_FIELDS = [
  "type",
  "event_kind",
  "producer",
  "scope",
  "classification",
  "impact",
  "expected",
  "actual",
  "evidence",
  "suggested_owner",
  "suggested_next_action",
  "authority",
  "created_at"
];
const ALLOWED_FIELDS = new Set([...REQUIRED_FIELDS, "source_packet_ref"]);
const AUTHORITY_LIKE_FIELDS = new Set([
  "proof",
  "proof_authority",
  "merge",
  "merge_readiness",
  "gate",
  "gate_status",
  "security",
  "security_status",
  "lane_authority",
  "lifecycle",
  "sdlc",
  "readiness"
]);
const UNSAFE_KEYS = new Set([
  "raw_log",
  "raw_logs",
  "log",
  "logs",
  "stdout",
  "stderr",
  "command_output",
  "prompt",
  "prompts",
  "system_prompt",
  "developer_prompt",
  "provider_payload",
  "provider_private_metadata",
  "private_metadata",
  "env",
  "environment",
  "headers",
  "request",
  "response"
]);

const LOCAL_PATH = /(?:\/Users\/[^\s"'`),]+|\/home\/[^\s"'`),]+|\/private\/tmp\/[^\s"'`),]+|\/private\/var\/folders\/[^\s"'`),]+|\/var\/folders\/[^\s"'`),]+|\/tmp\/[^\s"'`),]+|\/Volumes\/[^\s"'`),]+|~\/[^\s"'`),]+)/g;
const SECRET_ASSIGNMENT = /\b(token|secret|password|passwd|api[_-]?key|authorization)\b\s*[:=]\s*["']?[A-Za-z0-9._~+/=-]{8,}["']?/gi;
const BEARER_TOKEN = /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}\b/gi;
const QUERY_SECRET = /\b(access_token|token|api_key|password|secret)=([^&\s]+)/gi;
const CREDENTIAL_URL = /\b([a-z][a-z0-9+.-]*:\/\/)([^/\s:@]+):([^/\s@]+)@/gi;
const SHELL_CONTROL = /[|;&`$<>]/;

function fail(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

function throwIf(condition, code, message, details) {
  if (condition) {
    throw fail(code, message, details);
  }
}

function repoName(cwd) {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(cwd, "package.json"), "utf8"));
    if (typeof manifest.name === "string" && manifest.name.trim()) {
      return safeText(manifest.name, 128);
    }
  } catch {
    // Fall back to the directory name for temp fixtures and non-package repos.
  }
  return safeText(path.basename(cwd), 128);
}

function redactText(value) {
  return String(value)
    .replace(CREDENTIAL_URL, "$1[redacted]@")
    .replace(BEARER_TOKEN, "Bearer [redacted_secret]")
    .replace(SECRET_ASSIGNMENT, "$1=[redacted_secret]")
    .replace(QUERY_SECRET, "$1=[redacted_secret]")
    .replace(LOCAL_PATH, "[redacted_path]");
}

function safeText(value, maxLength = 1000) {
  const text = redactText(value).replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength)}[truncated]`;
}

function commandRef(command) {
  const value = safeText(command, 256);
  throwIf(SHELL_CONTROL.test(value) || value.includes("\n"), "unsafe_diagram_command_ref", "Diagram command refs must be bounded command references", {
    command: value
  });
  return value;
}

function diagnosticEntries(packet) {
  if (packet?.type === "skillpress_sync") {
    return (packet.issues ?? []).map((entry) => ({
      severity: entry.severity === "info" ? "advisory" : entry.severity,
      code: entry.code,
      provider: entry.provider ?? null,
      skill: entry.skill ?? null,
      tool: entry.tool ?? packet.filters?.tool ?? null,
      message: entry.message
    }));
  }
  if (packet?.type === "skillpress_doctor") {
    return (packet.findings ?? []).map((entry) => ({
      severity: entry.severity,
      code: entry.code,
      provider: entry.provider ?? null,
      skill: entry.skill ?? null,
      tool: packet.filters?.tool ?? null,
      message: entry.message
    }));
  }
  return [];
}

function severityRank(severity) {
  if (severity === "error") {
    return 3;
  }
  if (severity === "warning") {
    return 2;
  }
  return 1;
}

function dominantSeverity(entries) {
  return entries.reduce((winner, entry) => severityRank(entry.severity) > severityRank(winner) ? entry.severity : winner, "advisory");
}

function classify(entries) {
  const codes = new Set(entries.map((entry) => entry.code));
  if ([...codes].some((code) => code?.startsWith("provider_") || code === "provider_unavailable")) {
    return "provider_failure";
  }
  if ([...codes].some((code) => code?.startsWith("manifest_") || code?.startsWith("installed_") || code?.includes("source"))) {
    return "resource_failure";
  }
  if ([...codes].some((code) => code?.startsWith("command_contract"))) {
    return "cli_contract_gap";
  }
  if ([...codes].some((code) => code?.startsWith("policy_") || code?.startsWith("markdown_") || code?.startsWith("config_"))) {
    return "docs_gap";
  }
  return dominantSeverity(entries) === "error" ? "unexpected_blocker" : "provider_failure";
}

function impact(entries) {
  const severity = dominantSeverity(entries);
  if (severity === "error") {
    return "blocking";
  }
  if (severity === "warning") {
    return "advisory";
  }
  return "info";
}

function eventKind(entries) {
  if (dominantSeverity(entries) === "error") {
    return "friction";
  }
  return entries.some((entry) => entry.severity === "warning") ? "diagnostic" : "telemetry";
}

function groupSummary(entries) {
  const counts = new Map();
  for (const entry of entries) {
    const key = `${entry.severity}:${entry.code}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, count]) => `${key}=${count}`)
    .join(", ");
}

function sampleSummary(entries) {
  return entries
    .map((entry) => ({
      severity: entry.severity,
      code: entry.code,
      provider: entry.provider ?? "",
      skill: entry.skill ?? "",
      tool: entry.tool ?? ""
    }))
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)))
    .slice(0, 5)
    .map((entry) => [
      entry.severity,
      entry.code,
      entry.provider ? `provider=${entry.provider}` : null,
      entry.skill ? `skill=${entry.skill}` : null,
      entry.tool ? `tool=${entry.tool}` : null
    ].filter(Boolean).join(" "))
    .join("; ");
}

function scopeFor(packet, { cwd, command }) {
  const scope = {
    repo: repoName(cwd),
    command: commandRef(command)
  };
  if (packet?.filters?.tool) {
    scope.tool = safeText(packet.filters.tool, 128);
  }
  if (packet?.filters?.provider) {
    scope.provider = safeText(packet.filters.provider, 128);
  }
  return scope;
}

export function buildDiagramTelemetryEvents(packet, options = {}) {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const command = options.command ?? `skillpress ${String(packet?.type ?? "unknown").replace(/^skillpress_/, "")} --json`;
  const entries = diagnosticEntries(packet).filter((entry) => entry.code);
  if (entries.length === 0) {
    return [];
  }

  const summary = groupSummary(entries);
  const sample = sampleSummary(entries);
  const event = {
    type: DIAGRAM_EVENT_TYPE,
    event_kind: eventKind(entries),
    producer: "skillpress",
    scope: scopeFor(packet, { cwd, command }),
    classification: classify(entries),
    impact: impact(entries),
    expected: "Skillpress reports bounded sync and doctor diagnostics while preserving Skillpress authority.",
    actual: safeText(`Skillpress reported ${entries.length} diagnostic(s): ${summary}.`, 1000),
    evidence: {
      refs: [
        { kind: "command", value: commandRef(command) },
        { kind: "other", value: safeText(`packet:${packet.type}`, 256) }
      ],
      snippets: [
        { label: "summary", text: safeText(summary, 1000) },
        { label: "sample", text: safeText(sample || "no sample", 1000) }
      ]
    },
    suggested_owner: "skillpress",
    suggested_next_action: "Use the Skillpress command result as authority and inspect the summarized diagnostic codes.",
    authority: "telemetry_only",
    created_at: new Date(options.createdAt ?? Date.now()).toISOString(),
    source_packet_ref: safeText(packet.type, 256)
  };

  validateDiagramEvent(event);
  return [event];
}

export function validateDiagramEvent(packet) {
  throwIf(!packet || typeof packet !== "object" || Array.isArray(packet), "invalid_diagram_event", "Diagram event must be an object");
  rejectUnsafeKeys(packet);
  for (const field of REQUIRED_FIELDS) {
    throwIf(packet[field] === undefined || packet[field] === null, "diagram_event_missing_field", `Diagram event missing field: ${field}`, { field });
  }
  for (const field of Object.keys(packet)) {
    throwIf(AUTHORITY_LIKE_FIELDS.has(field), "diagram_authority_claim_rejected", `Diagram event cannot include authority field: ${field}`, { field });
    throwIf(!ALLOWED_FIELDS.has(field), "diagram_event_unknown_field", `Diagram event field is not supported: ${field}`, { field });
  }
  throwIf(packet.type !== DIAGRAM_EVENT_TYPE, "diagram_invalid_event_type", "Diagram event type is invalid", { type: packet.type });
  throwIf(!EVENT_KINDS.has(packet.event_kind), "diagram_invalid_event_kind", "Diagram event kind is invalid", { event_kind: packet.event_kind });
  throwIf(packet.producer !== "skillpress", "diagram_invalid_producer", "Diagram telemetry producer must be skillpress", { producer: packet.producer });
  throwIf(!CLASSIFICATIONS.has(packet.classification), "diagram_invalid_classification", "Diagram classification is invalid", { classification: packet.classification });
  throwIf(!IMPACTS.has(packet.impact), "diagram_invalid_impact", "Diagram impact is invalid", { impact: packet.impact });
  throwIf(packet.authority !== "telemetry_only", "diagram_authority_claim_rejected", "Diagram event authority must be telemetry_only", { authority: packet.authority });
  throwIf(Number.isNaN(new Date(packet.created_at).getTime()), "diagram_invalid_created_at", "Diagram created_at must be an ISO timestamp");
  validateScope(packet.scope);
  validateEvidence(packet.evidence);
  return packet;
}

function rejectUnsafeKeys(value, currentPath = "packet") {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => rejectUnsafeKeys(entry, `${currentPath}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") {
    return;
  }
  for (const [key, entry] of Object.entries(value)) {
    const normalized = key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`).toLowerCase();
    throwIf(UNSAFE_KEYS.has(normalized), "diagram_unsafe_event_content", `Diagram event contains unsafe field: ${currentPath}.${key}`, {
      field: `${currentPath}.${key}`
    });
    rejectUnsafeKeys(entry, `${currentPath}.${key}`);
  }
}

function validateScope(scope) {
  throwIf(!scope || typeof scope !== "object" || Array.isArray(scope), "diagram_invalid_scope", "Diagram event scope must be an object");
  for (const [key, value] of Object.entries(scope)) {
    throwIf(!/^[a-z][a-z0-9_]*$/.test(key), "diagram_invalid_scope_field", "Diagram event scope field is invalid", { field: key });
    throwIf(typeof value !== "string" || value.trim() === "", "diagram_invalid_scope_value", "Diagram event scope values must be non-empty strings", { field: key });
    if (key === "command") {
      commandRef(value);
    }
  }
}

function validateEvidence(evidence) {
  throwIf(!evidence || typeof evidence !== "object" || Array.isArray(evidence), "diagram_invalid_evidence", "Diagram evidence must be an object");
  for (const key of Object.keys(evidence)) {
    throwIf(!["refs", "snippets"].includes(key), "diagram_unknown_evidence_field", "Diagram evidence field is not supported", { field: key });
  }
  for (const ref of evidence.refs ?? []) {
    throwIf(!["file", "command", "url", "issue", "pr", "event", "doc", "other"].includes(ref.kind), "diagram_invalid_evidence_ref", "Diagram evidence ref kind is invalid", { kind: ref.kind });
    if (ref.kind === "command") {
      commandRef(ref.value);
    }
  }
  for (const snippet of evidence.snippets ?? []) {
    throwIf(typeof snippet.text !== "string" || snippet.text.split(/\r?\n/).length > 12, "diagram_invalid_evidence_snippet", "Diagram evidence snippets must be bounded text");
  }
}
