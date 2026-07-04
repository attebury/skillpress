import { statusPacket } from "./status.js";

const BLOCKING_CODES = new Set([
  "command_contract_root_outside_repo",
  "canonical_source_root_outside_repo",
  "config_invalid",
  "config_invalid_diagram",
  "config_invalid_diagram_field",
  "config_invalid_diagram_telemetry",
  "config_invalid_manifest",
  "config_invalid_manifest_field",
  "config_invalid_policy_pack",
  "config_invalid_provider",
  "config_invalid_source_layout",
  "config_invalid_source_root",
  "invalid_skill_id",
  "manifest_invalid",
  "manifest_invalid_field",
  "manifest_invalid_provider",
  "manifest_invalid_provider_root",
  "manifest_invalid_schema",
  "manifest_provider_root_mismatch",
  "manifest_provider_root_outside_home",
  "manifest_provider_root_symlink_escape",
  "source_root_outside_repo"
]);

const SYNC_CODES = new Set([
  "installed_skill_missing",
  "installed_skill_drift",
  "installed_skill_file_missing",
  "manifest_source_hash_stale",
  "manifest_skill_md_hash_stale",
  "manifest_source_tree_hash_stale"
]);

const SOURCE_CONFIG_CODES = new Set([
  "canonical_source_root_missing",
  "canonical_source_missing_for_manifest"
]);

const MANIFEST_CODES = new Set([
  "generated_header_missing",
  "generated_header_stale",
  "generated_header_invalid",
  "manifest_source_missing"
]);

function unique(values) {
  return [...new Set(values.filter((value) => value !== undefined && value !== null && value !== ""))].sort();
}

function severityRank(severity) {
  if (severity === "error") {
    return 0;
  }
  if (severity === "warning") {
    return 1;
  }
  return 2;
}

function actionKey({ action, skill, provider, path }) {
  return [action, provider ?? "", skill ?? "", path ?? ""].join("\0");
}

function issuePath(issue) {
  return issue.path ?? issue.source_path ?? null;
}

function inferTool({ issue, status, options }) {
  if (issue.tool) {
    return issue.tool;
  }
  if (options.tool) {
    return options.tool;
  }
  const tools = status.canonical_sources?.tools ?? [];
  return tools.length === 1 ? tools[0] : null;
}

function syncCommand({ issue, status, options }) {
  const parts = ["skillpress", "sync", "--json"];
  const provider = issue.provider ?? options.provider ?? null;
  const tool = inferTool({ issue, status, options });
  if (tool) {
    parts.push("--tool", tool);
  }
  if (provider) {
    parts.push("--provider", provider);
  }
  return parts.join(" ");
}

function baseAction({
  action,
  severity,
  issue,
  reasonCodes,
  message,
  suggestedCommand = null,
  blocked = false
}) {
  return {
    id: null,
    action,
    severity,
    skill: issue.skill ?? null,
    provider: issue.provider ?? null,
    path: issuePath(issue),
    reason_codes: reasonCodes,
    message,
    safe_to_execute: false,
    suggested_command: suggestedCommand,
    requires_operator_review: true,
    blocked
  };
}

function actionForIssue(issue, { status, options, conflicts }) {
  if (issue.code === "provider_unavailable") {
    return null;
  }
  if (issue.code === "duplicate_skill_content_conflict") {
    return baseAction({
      action: "resolve_duplicate_conflict",
      severity: issue.severity,
      issue,
      reasonCodes: [issue.code],
      message: "Duplicate installed skills disagree by content; inspect canonical source and resync before any prune.",
      blocked: true
    });
  }
  if (issue.code === "duplicate_skill_name") {
    if (conflicts.has(issue.skill)) {
      return null;
    }
    return baseAction({
      action: "prune_duplicate_identical",
      severity: issue.severity,
      issue,
      reasonCodes: [issue.code],
      message: "Duplicate installed skills appear identical; this is a future prune candidate, not an automatic cleanup.",
      blocked: false
    });
  }
  if (SYNC_CODES.has(issue.code)) {
    return baseAction({
      action: "sync_managed_install",
      severity: issue.severity,
      issue,
      reasonCodes: [issue.code],
      message: "Manifest-managed install is missing or stale; rerun Skillpress sync from canonical source.",
      suggestedCommand: syncCommand({ issue, status, options }),
      blocked: false
    });
  }
  if (issue.code === "installed_skill_unmanaged") {
    return baseAction({
      action: "inspect_unmanaged_install",
      severity: issue.severity,
      issue,
      reasonCodes: [issue.code],
      message: "Installed skill is not managed by the local Skillpress manifest; inspect before deciding whether to adopt, resync, or remove.",
      blocked: false
    });
  }
  if (SOURCE_CONFIG_CODES.has(issue.code)) {
    if (status.summary.installed_count === 0 && status.manifest.entry_count === 0) {
      return null;
    }
    return baseAction({
      action: "fix_source_config",
      severity: issue.severity,
      issue,
      reasonCodes: [issue.code],
      message: "Canonical source configuration is missing or stale; fix source roots or manifest source attribution before cleanup.",
      blocked: issue.severity === "error"
    });
  }
  if (MANIFEST_CODES.has(issue.code) || issue.code?.startsWith("manifest_") || issue.code?.startsWith("generated_header_")) {
    return baseAction({
      action: "repair_manifest",
      severity: issue.severity,
      issue,
      reasonCodes: [issue.code],
      message: "Manifest or generated header metadata is inconsistent; inspect and resync or migrate explicitly.",
      suggestedCommand: issue.provider ? syncCommand({ issue, status, options }) : null,
      blocked: true
    });
  }
  if (issue.code === "installed_skill_symlink") {
    return baseAction({
      action: "manual_review",
      severity: issue.severity,
      issue,
      reasonCodes: [issue.code],
      message: "Installed provider-cache entry is a symlink; resolve manually without following it.",
      blocked: true
    });
  }
  if (issue.severity === "error" || issue.severity === "warning") {
    return baseAction({
      action: "manual_review",
      severity: issue.severity,
      issue,
      reasonCodes: [issue.code],
      message: "Skillpress cannot derive a safe cleanup recommendation for this diagnostic.",
      blocked: issue.severity === "error"
    });
  }
  return null;
}

function mergeActions(actions) {
  const byKey = new Map();
  for (const action of actions) {
    const key = actionKey(action);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { ...action });
      continue;
    }
    existing.reason_codes = unique([...existing.reason_codes, ...action.reason_codes]);
    existing.severity = severityRank(action.severity) < severityRank(existing.severity) ? action.severity : existing.severity;
    existing.blocked = existing.blocked || action.blocked;
  }
  return [...byKey.values()]
    .sort((left, right) => {
      const severity = severityRank(left.severity) - severityRank(right.severity);
      if (severity !== 0) {
        return severity;
      }
      return [
        left.action.localeCompare(right.action),
        String(left.provider ?? "").localeCompare(String(right.provider ?? "")),
        String(left.skill ?? "").localeCompare(String(right.skill ?? "")),
        String(left.path ?? "").localeCompare(String(right.path ?? ""))
      ].find((value) => value !== 0) ?? 0;
    })
    .map((action, index) => ({
      ...action,
      id: `repair-${String(index + 1).padStart(3, "0")}`
    }));
}

function blocksTrust(issue) {
  return issue.severity === "error" && (
    BLOCKING_CODES.has(issue.code)
    || issue.code?.startsWith("config_invalid")
    || issue.code?.startsWith("manifest_invalid")
  );
}

export function repairPlanPacket(options = {}) {
  const status = statusPacket(options);
  const conflicts = new Set(status.issues
    .filter((issue) => issue.code === "duplicate_skill_content_conflict" && issue.skill)
    .map((issue) => issue.skill));
  const trustBlockers = status.issues.filter(blocksTrust);
  const rawActions = status.issues
    .map((issue) => actionForIssue(issue, { status, options, conflicts }))
    .filter(Boolean);
  for (const issue of trustBlockers) {
    rawActions.push(baseAction({
      action: "manual_review",
      severity: issue.severity,
      issue,
      reasonCodes: [issue.code],
      message: "Skillpress cannot produce a trustworthy cleanup plan until this configuration or manifest error is fixed.",
      blocked: true
    }));
  }
  const merged = mergeActions(rawActions);
  const blockedActions = merged.filter((action) => action.blocked);
  const actions = merged.map(({ blocked, ...action }) => action);

  return {
    ok: trustBlockers.length === 0,
    type: "skillpress_repair_plan",
    schema_version: 1,
    status: trustBlockers.length > 0 ? "blocked" : actions.length > 0 ? "planned" : "clean",
    filters: {
      provider: options.provider ?? null,
      tool: options.tool ?? null
    },
    actions,
    blocked_actions: blockedActions.map(({ blocked, ...action }) => action),
    summary: {
      action_count: actions.length,
      blocked_action_count: blockedActions.length,
      status_issue_count: status.summary.issue_count,
      status_error_count: status.summary.error_count,
      by_action: actions.reduce((counts, action) => {
        counts[action.action] = (counts[action.action] ?? 0) + 1;
        return counts;
      }, {})
    },
    status_summary: status.summary
  };
}
