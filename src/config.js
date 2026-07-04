import fs from "node:fs";
import path from "node:path";
import { DEFAULT_CONTRACT_ROOT, DEFAULT_SOURCE_ROOT } from "./source.js";

export const CONFIG_FILE = "skillpress.config.json";
export const SOURCE_LAYOUTS = Object.freeze(["auto", "tool-scoped", "agent-skills", "claude-skills"]);
export const POLICY_PACKS = Object.freeze(["generic", "dogfood"]);

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
    policy_packs: ["generic"],
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
    return {
      path: requestedPath,
      document: JSON.parse(fs.readFileSync(requestedPath, "utf8")),
      issues: []
    };
  } catch (error) {
    return {
      path: requestedPath,
      document: null,
      issues: [configIssue("config_invalid", "error", "Skillpress config could not be read", {
        path: requestedPath,
        error: error.message
      })]
    };
  }
}

function normalizeSourceRoots(document, overrides, issues) {
  const requestedRoots = overrides.sourceRoot
    ? [{ path: overrides.sourceRoot, layout: overrides.sourceLayout ?? "auto" }]
    : Array.isArray(document?.source_roots) && document.source_roots.length > 0
      ? document.source_roots
      : defaultConfig().source_roots;

  return requestedRoots.map((entry) => {
    const sourcePath = typeof entry === "string" ? entry : entry?.path;
    const requestedLayout = overrides.sourceLayout ?? (typeof entry === "string" ? "auto" : entry?.layout ?? "auto");
    if (typeof sourcePath !== "string" || sourcePath.length === 0) {
      issues.push(configIssue("config_invalid_source_root", "error", "source root path must be a non-empty string"));
      return { path: "", layout: "agent-skills" };
    }
    const normalized = normalizeLayout(requestedLayout, sourcePath);
    if (normalized.issue) {
      issues.push(normalized.issue);
    }
    return { path: sourcePath, layout: normalized.layout };
  });
}

function normalizePolicies(document, overrides, issues) {
  const requestedPolicies = overrides.policyPacks
    ? parseList(overrides.policyPacks)
    : Array.isArray(document?.policy_packs)
      ? document.policy_packs
      : defaultConfig().policy_packs;
  if (requestedPolicies.includes("none")) {
    return [];
  }
  const policies = [];
  for (const policy of requestedPolicies) {
    if (!POLICY_PACKS.includes(policy)) {
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

export function resolveRuntimeConfig(options = {}) {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const configState = readConfigFile(options.configPath, cwd);
  const issues = [...configState.issues];
  const document = configState.document ?? {};
  const policyPacks = normalizePolicies(document, {
    policyPacks: options.policyPacks
  }, issues);
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
      providers,
      configured_providers: configuredProviders,
      manifest
    },
    issues
  };
}
