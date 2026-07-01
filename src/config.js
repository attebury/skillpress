import fs from "node:fs";
import path from "node:path";
import { DEFAULT_CONTRACT_ROOT, DEFAULT_SOURCE_ROOT } from "./source.js";

export const CONFIG_FILE = "skillpress.config.json";
export const SOURCE_LAYOUTS = Object.freeze(["auto", "atteway", "agent-skills", "claude-skills"]);
export const POLICY_PACKS = Object.freeze(["generic", "atteway"]);

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
    return { layout: "atteway", issue: null };
  }
  return { layout: "agent-skills", issue: null };
}

function defaultConfig() {
  return {
    source_roots: [{ path: DEFAULT_SOURCE_ROOT, layout: "atteway" }],
    contract_root: DEFAULT_CONTRACT_ROOT,
    policy_packs: ["generic"],
    providers: null
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
  const providers = options.providers?.length
    ? options.providers
    : options.provider
      ? [options.provider]
      : Array.isArray(document.providers)
        ? document.providers
        : null;

  return {
    path: configState.path,
    present: configState.document !== null,
    config: {
      source_roots: sourceRoots,
      contract_root: options.contractRoot ?? document.contract_root ?? DEFAULT_CONTRACT_ROOT,
      policy_packs: policyPacks,
      providers
    },
    issues
  };
}
