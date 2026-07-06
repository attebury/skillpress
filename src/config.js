import fs from "node:fs";
import path from "node:path";
import { DEFAULT_CONTRACT_ROOT, DEFAULT_SOURCE_ROOT } from "./source.js";

export const CONFIG_FILE = "skillpress.config.json";
export const SOURCE_LAYOUTS = Object.freeze(["auto", "tool-scoped", "agent-skills", "claude-skills"]);
export const POLICY_PACKS = Object.freeze(["generic", "linter", "security", "ci", "performance"]);

function configIssue(code, severity, message, details = {}) {
  return { code, severity, message, ...details };
}

function parseList(values) {
  return values
    .flatMap((value) => String(value).split(","))
    .map((value) => value.trim())
    .filter(Boolean);
}

function normalizeLayout(layout, sourcePath = "") {
  const requested = layout ?? "auto";
  if (!SOURCE_LAYOUTS.includes(requested)) {
    return { layout: requested, issue: configIssue("config_invalid_source_layout", "error", "source layout is not supported", { layout: requested }) };
  }
  if (requested !== "auto") {
    return { layout: requested, issue: null };
  }
  const normalizedPath = sourcePath.split(path.sep).join("/");
  if (normalizedPath.endsWith(".claude/skills")) {
    return { layout: "claude-skills", issue: null };
  }
  if (normalizedPath.endsWith("agent-skills/src")) {
    return { layout: "tool-scoped", issue: null };
  }
  return { layout: "agent-skills", issue: null };
}

function defaultConfig() {
  return {
    source_roots: [{ path: DEFAULT_SOURCE_ROOT, layout: "tool-scoped" }],
    contract_root: DEFAULT_CONTRACT_ROOT,
    policy_packs: ["linter"],
    custom_policy_rules: [],
    providers: null,
    manifest: {
      path: null
    }
  };
}

function readConfigFile(configPath, cwd) {
  const defaultPath = path.join(cwd, CONFIG_FILE);
  const requestedPath = configPath ? path.resolve(cwd, configPath) : defaultPath;
  if (!configPath && !fs.existsSync(defaultPath)) {
    return { path: requestedPath, document: null, issues: [] };
  }
  try {
    const raw = fs.readFileSync(requestedPath, "utf8");
    const document = JSON.parse(raw);
    if (!document || typeof document !== "object" || Array.isArray(document)) {
      return { path: requestedPath, document: null, issues: [configIssue("config_invalid_json", "error", "config root must be a JSON object")] };
    }
    return { path: requestedPath, document, issues: [] };
  } catch (error) {
    return { path: requestedPath, document: null, issues: [configIssue("config_invalid_json", "error", error.message)] };
  }
}

function normalizeSourceRoots(document, overrides, issues) {
  const requestedRoots = overrides.sourceRoot
    ? [{ path: overrides.sourceRoot, layout: overrides.sourceLayout ?? "auto" }]
    : Array.isArray(document?.source_roots)
      ? document.source_roots
      : defaultConfig().source_roots;

  return requestedRoots.map((entry) => {
    if (typeof entry === "string") {
      const layout = overrides.sourceLayout ?? "auto";
      const normalized = normalizeLayout(layout, entry);
      if (normalized.issue) {
        issues.push(normalized.issue);
      }
      return { path: entry, layout: normalized.layout };
    }
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      issues.push(configIssue("config_invalid_source_root", "error", "source_roots entries must be strings or objects"));
      return { path: "", layout: "auto" };
    }
    const sourcePath = entry.path ?? "";
    const layout = overrides.sourceLayout ?? entry.layout ?? "auto";
    const normalized = normalizeLayout(layout, sourcePath);
    if (normalized.issue) {
      issues.push(normalized.issue);
    }
    return { path: sourcePath, layout: normalized.layout };
  });
}

function normalizePolicies(document, overrides, issues, customPolicyRules = []) {
  const requestedPolicies = overrides.policyPacks
    ? parseList(overrides.policyPacks)
    : Array.isArray(document?.policy_packs)
      ? document.policy_packs
      : defaultConfig().policy_packs;
  if (requestedPolicies.includes("none")) {
    return [];
  }
  const customPacks = new Set(customPolicyRules.map((r) => r.pack).filter(Boolean));
  const policies = [];
  for (const policy of requestedPolicies) {
    if (!POLICY_PACKS.includes(policy) && !customPacks.has(policy)) {
      issues.push(configIssue("config_invalid_policy_pack", "error", "policy pack is not supported", { policy }));
      continue;
    }
    if (!policies.includes(policy)) {
      policies.push(policy);
    }
  }
  return policies;
}

function normalizeManifestConfig(document, issues) {
  if (document?.manifest === undefined) {
    return defaultConfig().manifest;
  }
  if (!document.manifest || typeof document.manifest !== "object" || Array.isArray(document.manifest)) {
    issues.push(configIssue("config_invalid_manifest", "error", "manifest config must be an object"));
    return defaultConfig().manifest;
  }
  for (const key of Object.keys(document.manifest)) {
    if (key !== "path" || /hook|command/i.test(key)) {
      issues.push(configIssue("config_invalid_manifest_field", "error", "manifest config field is not supported", {
        field: key
      }));
    }
  }
  if (document.manifest.path === undefined || document.manifest.path === null) {
    return defaultConfig().manifest;
  }
  if (typeof document.manifest.path !== "string" || document.manifest.path.length === 0) {
    issues.push(configIssue("config_invalid_manifest_path", "error", "manifest.path must be a non-empty string"));
    return defaultConfig().manifest;
  }
  return {
    path: document.manifest.path
  };
}

function normalizeProviders(document, overrides, issues) {
  if (overrides.providers?.length) {
    return overrides.providers;
  }
  if (document.providers === undefined || document.providers === null) {
    return null;
  }
  if (!Array.isArray(document.providers)) {
    issues.push(configIssue("config_invalid_providers", "error", "providers must be an array"));
    return null;
  }
  const providers = [];
  for (const entry of document.providers) {
    if (typeof entry === "string") {
      if (entry.length === 0) {
        issues.push(configIssue("config_invalid_provider", "error", "provider id must be a non-empty string"));
        continue;
      }
      providers.push(entry);
      continue;
    }
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      issues.push(configIssue("config_invalid_provider", "error", "provider entries must be strings or objects"));
      continue;
    }
    const id = entry.id ?? entry.provider;
    if (typeof id !== "string" || id.length === 0) {
      issues.push(configIssue("config_invalid_provider", "error", "provider entries must include id"));
      continue;
    }
    for (const key of Object.keys(entry)) {
      if (!["id", "provider", "enabled", "required", "root", "scope", "allow_undetected"].includes(key) || /hook|command/i.test(key)) {
        issues.push(configIssue("config_invalid_provider_field", "error", "provider config field is not supported", {
          provider: id,
          field: key
        }));
      }
    }
    providers.push({ ...entry, id });
  }
  return providers;
}

function providerId(entry) {
  return typeof entry === "string" ? entry : entry?.id;
}

function explicitProviderRequest(entry, provider) {
  if (typeof entry === "string" || entry === undefined || entry === null) {
    return { id: provider, explicit: true };
  }
  return { ...entry, explicit: true };
}

function normalizeCustomPolicyRules(document, issues) {
  if (document?.custom_policy_rules === undefined) {
    return [];
  }
  if (!Array.isArray(document.custom_policy_rules)) {
    issues.push(configIssue("config_invalid_custom_policy_rules", "error", "custom_policy_rules must be an array"));
    return [];
  }
  const rules = [];
  const seenIds = new Set();
  for (const entry of document.custom_policy_rules) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      issues.push(configIssue("config_invalid_custom_policy_rule", "error", "custom_policy_rules entries must be objects"));
      continue;
    }
    const { id, pattern, message, severity = "error", pack = "generic" } = entry;
    if (typeof id !== "string" || id.length === 0) {
      issues.push(configIssue("config_invalid_custom_policy_rule_field", "error", "custom policy rule must include non-empty string 'id'"));
      continue;
    }
    if (seenIds.has(id)) {
      issues.push(configIssue("config_invalid_custom_policy_rule_duplicate", "error", `duplicate custom policy rule id '${id}'`, { id }));
      continue;
    }
    seenIds.add(id);
    if (typeof pattern !== "string" || pattern.length === 0) {
      issues.push(configIssue("config_invalid_custom_policy_rule_field", "error", "custom policy rule must include non-empty string 'pattern'", { id }));
      continue;
    }
    try {
      new RegExp(pattern);
    } catch (err) {
      issues.push(configIssue("config_invalid_custom_policy_rule_pattern", "error", `invalid regex pattern in custom rule '${id}'`, { id, pattern }));
      continue;
    }
    if (typeof message !== "string" || message.length === 0) {
      issues.push(configIssue("config_invalid_custom_policy_rule_field", "error", "custom policy rule must include non-empty string 'message'", { id }));
      continue;
    }
    if (severity !== "error" && severity !== "warning") {
      issues.push(configIssue("config_invalid_custom_policy_rule_severity", "error", "custom policy rule severity must be 'error' or 'warning'", { id, severity }));
      continue;
    }
    if (typeof pack !== "string" || pack.length === 0) {
      issues.push(configIssue("config_invalid_custom_policy_rule_field", "error", "custom policy rule pack must be a non-empty string", { id }));
      continue;
    }
    rules.push({ id, pattern, message, severity, pack });
  }
  return rules;
}

export function resolveRuntimeConfig(options = {}) {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const configState = readConfigFile(options.configPath, cwd);
  const issues = [...configState.issues];
  const document = configState.document ?? {};
  const customPolicyRules = normalizeCustomPolicyRules(document, issues);
  const policyPacks = normalizePolicies(document, {
    policyPacks: options.policyPacks
  }, issues, customPolicyRules);
  const sourceRoots = normalizeSourceRoots(document, {
    sourceRoot: options.sourceRoot,
    sourceLayout: options.sourceLayout
  }, issues);
  const configuredProviders = normalizeProviders(document, {}, issues);
  const providers = options.provider
    ? [explicitProviderRequest(configuredProviders?.find((entry) => providerId(entry) === options.provider), options.provider)]
    : options.providers?.length
      ? options.providers
      : configuredProviders;
  const manifest = normalizeManifestConfig(document, issues);

  return {
    path: configState.path,
    present: configState.document !== null,
    config: {
      source_roots: sourceRoots,
      contract_root: options.contractRoot ?? document.contract_root ?? DEFAULT_CONTRACT_ROOT,
      policy_packs: policyPacks,
      custom_policy_rules: customPolicyRules,
      providers,
      configured_providers: configuredProviders,
      manifest
    },
    issues
  };
}
