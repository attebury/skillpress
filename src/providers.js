import fs from "node:fs";
import path from "node:path";

export const PROVIDER_IDS = Object.freeze([
  "codex",
  "agents",
  "cursor",
  "claude-code",
  "zed",
  "github-copilot",
  "cline",
  "roo",
  "continue",
  "devin",
  "github-copilot-instructions",
  "agents-md"
]);

const SAFE_SKILL_ID = /^[A-Za-z0-9._-]+$/;
const DEFAULT_PROVIDER_IDS = Object.freeze(["codex", "agents", "cursor", "claude-code"]);

const PROVIDER_DEFINITIONS = Object.freeze([
  {
    id: "codex",
    title: "Codex",
    root: ({ home }) => path.join(home, ".codex", "skills"),
    detect_path: ({ home }) => path.join(home, ".codex"),
    layout: "{root}/{skill}/SKILL.md",
    kind: "skill-directory",
    surface_kind: "skill-directory",
    surface_id: "codex-global",
    fidelity: "full",
    root_scope: "home",
    supports_auxiliary_files: true,
    default_enabled: true,
    detection: "path-exists"
  },
  {
    id: "agents",
    title: "Agents",
    root: ({ home }) => path.join(home, ".agents", "skills"),
    layout: "{root}/{skill}/SKILL.md",
    kind: "skill-directory",
    surface_kind: "skill-directory",
    surface_id: "agents-global",
    fidelity: "full",
    root_scope: "home",
    supports_auxiliary_files: true,
    default_enabled: true,
    detection: "always"
  },
  {
    id: "cursor",
    title: "Cursor",
    root: ({ repo }) => path.join(repo, ".cursor", "rules", "skillpress"),
    layout: "{workspace}/.cursor/rules/skillpress/{skill}.mdc",
    kind: "rule-directory",
    rule_format: "cursor-mdc",
    extension: ".mdc",
    surface_kind: "rule-directory",
    surface_id: "cursor-workspace-rules",
    fidelity: "rule-render",
    root_scope: "workspace",
    supports_auxiliary_files: false,
    default_enabled: true,
    detection: "always"
  },
  {
    id: "claude-code",
    title: "Claude Code",
    root: ({ home }) => path.join(home, ".claude", "skills"),
    detect_path: ({ home }) => path.join(home, ".claude"),
    layout: "{root}/{skill}/SKILL.md",
    kind: "skill-directory",
    surface_kind: "skill-directory",
    surface_id: "claude-code-global",
    fidelity: "full",
    root_scope: "home",
    supports_auxiliary_files: true,
    default_enabled: true,
    detection: "path-exists"
  },
  {
    id: "zed",
    title: "Zed",
    root: ({ home }) => path.join(home, ".agents", "skills"),
    layout: "{root}/{skill}/SKILL.md",
    kind: "skill-directory",
    surface_kind: "skill-directory",
    surface_id: "agents-global",
    fidelity: "full",
    root_scope: "home",
    supports_auxiliary_files: true,
    default_enabled: false,
    detection: "always"
  },
  {
    id: "github-copilot",
    title: "GitHub Copilot",
    root: ({ home }) => path.join(home, ".copilot", "skills"),
    detect_path: ({ home }) => path.join(home, ".copilot"),
    layout: "{root}/{skill}/SKILL.md",
    kind: "skill-directory",
    surface_kind: "skill-directory",
    surface_id: "github-copilot-global",
    fidelity: "full",
    root_scope: "home",
    supports_auxiliary_files: true,
    default_enabled: false,
    detection: "path-exists"
  },
  {
    id: "cline",
    title: "Cline",
    root: ({ home }) => path.join(home, ".cline", "skills"),
    detect_path: ({ home }) => path.join(home, ".cline"),
    layout: "{root}/{skill}/SKILL.md",
    kind: "skill-directory",
    surface_kind: "skill-directory",
    surface_id: "cline-global",
    fidelity: "full",
    root_scope: "home",
    supports_auxiliary_files: true,
    default_enabled: false,
    detection: "path-exists"
  },
  {
    id: "roo",
    title: "Roo Code",
    root: ({ home }) => path.join(home, ".roo", "skills"),
    detect_path: ({ home }) => path.join(home, ".roo"),
    layout: "{root}/{skill}/SKILL.md",
    kind: "skill-directory",
    surface_kind: "skill-directory",
    surface_id: "roo-global",
    fidelity: "full",
    root_scope: "home",
    supports_auxiliary_files: true,
    default_enabled: false,
    detection: "path-exists"
  },
  {
    id: "continue",
    title: "Continue",
    root: ({ repo }) => path.join(repo, ".continue", "rules"),
    layout: "{workspace}/.continue/rules/{skill}.md",
    kind: "rule-directory",
    rule_format: "continue-md",
    extension: ".md",
    surface_kind: "rule-directory",
    surface_id: "continue-workspace-rules",
    fidelity: "rule-render",
    root_scope: "workspace",
    supports_auxiliary_files: false,
    default_enabled: false,
    detection: "always"
  },
  {
    id: "devin",
    title: "Devin/Cascade",
    root: ({ repo }) => path.join(repo, ".devin", "rules"),
    layout: "{workspace}/.devin/rules/{skill}.md",
    kind: "rule-directory",
    rule_format: "devin-md",
    extension: ".md",
    surface_kind: "rule-directory",
    surface_id: "devin-workspace-rules",
    fidelity: "rule-render",
    root_scope: "workspace",
    supports_auxiliary_files: false,
    default_enabled: false,
    detection: "always"
  },
  {
    id: "github-copilot-instructions",
    title: "GitHub Copilot Instructions",
    root: ({ repo }) => path.join(repo, ".github", "instructions", "skillpress"),
    layout: "{workspace}/.github/instructions/skillpress/{skill}.instructions.md",
    kind: "rule-directory",
    rule_format: "github-copilot-instructions",
    extension: ".instructions.md",
    surface_kind: "rule-directory",
    surface_id: "github-copilot-workspace-instructions",
    fidelity: "rule-render",
    root_scope: "workspace",
    supports_auxiliary_files: false,
    default_enabled: false,
    detection: "always"
  },
  {
    id: "agents-md",
    title: "AGENTS.md",
    root: ({ repo }) => repo,
    layout: "{workspace}/AGENTS.skillpress.md",
    kind: "single-instructions-file",
    entrypoint: "AGENTS.skillpress.md",
    single_skill_id: "skillpress-instructions",
    surface_kind: "single-instructions-file",
    surface_id: "agents-md-workspace",
    fidelity: "summary",
    root_scope: "workspace",
    supports_auxiliary_files: false,
    default_enabled: false,
    detection: "always"
  }
]);

export function expandHome(value, homeDir) {
  if (typeof value !== "string") {
    return value;
  }
  if (value === "~") {
    return homeDir;
  }
  if (value.startsWith("~/")) {
    return path.join(homeDir, value.slice(2));
  }
  return value;
}

export function isPathInside(childPath, parentPath) {
  const relative = path.relative(path.resolve(parentPath), path.resolve(childPath));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function providerError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, details);
  return error;
}

function existingParent(targetPath) {
  let cursor = path.resolve(targetPath);
  while (!fs.existsSync(cursor)) {
    const parent = path.dirname(cursor);
    if (parent === cursor) {
      return null;
    }
    cursor = parent;
  }
  return cursor;
}

function assertNoSymlinkEscape(resolvedPath, allowedRoot, field) {
  const existing = existingParent(resolvedPath);
  if (!existing) {
    return;
  }
  const realRoot = fs.realpathSync(path.resolve(allowedRoot));
  const realExisting = fs.realpathSync(existing);
  if (!isPathInside(realExisting, realRoot)) {
    throw providerError("provider_root_outside_allowed_root", `${field} must not escape its configured root`, {
      field,
      path: resolvedPath,
      root: allowedRoot
    });
  }
}

function inferRootScope(root, { cwd, homeDir }) {
  if (isPathInside(root, homeDir)) {
    return "home";
  }
  if (isPathInside(root, cwd)) {
    return "workspace";
  }
  return "absolute";
}

function resolveProviderRoot(root, { cwd, homeDir, field = "provider.root" }) {
  if (typeof root !== "string" || root.length === 0) {
    throw providerError("provider_invalid_root", `${field} must be a non-empty string`, { field });
  }
  if (root.includes("\0")) {
    throw providerError("provider_unsafe_root", `${field} must not contain NUL`, { field });
  }
  const expanded = expandHome(root, homeDir);
  if (!path.isAbsolute(expanded)) {
    const parts = expanded.split(/[\\/]+/).filter(Boolean);
    if (parts.includes("..")) {
      throw providerError("provider_unsafe_root", `${field} must not contain parent segments`, {
        field,
        path: root
      });
    }
    const resolved = path.resolve(cwd, expanded);
    assertNoSymlinkEscape(resolved, cwd, field);
    return resolved;
  }
  return path.resolve(expanded);
}

function normalizeProviderRequest(entry, { explicit = false } = {}) {
  if (typeof entry === "string") {
    return { id: entry, explicit, enabled: true, required: false, allow_undetected: false };
  }
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    throw providerError("config_invalid_provider", "provider config entries must be strings or objects");
  }
  const id = entry.id ?? entry.provider;
  if (typeof id !== "string" || id.length === 0) {
    throw providerError("config_invalid_provider", "provider config entries must include id");
  }
  for (const key of Object.keys(entry)) {
    if (!["id", "provider", "enabled", "required", "root", "scope", "allow_undetected", "explicit"].includes(key) || /hook|command/i.test(key)) {
      throw providerError("config_invalid_provider_field", "provider config field is not supported", {
        provider: id,
        field: key
      });
    }
  }
  return {
    id,
    explicit: explicit || entry.explicit === true,
    enabled: entry.enabled !== false,
    required: entry.required === true,
    root: entry.root,
    scope: entry.scope,
    allow_undetected: entry.allow_undetected === true
  };
}

function definitionById(id) {
  return PROVIDER_DEFINITIONS.find((entry) => entry.id === id) ?? null;
}

export function assertSafeSkillId(skill) {
  if (typeof skill !== "string" || !SAFE_SKILL_ID.test(skill) || skill.length > 120) {
    const error = new Error("skill id must be a safe path segment");
    error.code = "invalid_skill_id";
    error.field = "skill";
    throw error;
  }
  return skill;
}

export function providerTargets({ cwd = process.cwd(), homeDir = process.env.HOME ?? "" } = {}) {
  const home = path.resolve(homeDir || ".");
  const repo = path.resolve(cwd);
  return PROVIDER_DEFINITIONS.map((definition) => providerFromDefinition(definition, { cwd: repo, homeDir: home }));
}

function providerFromDefinition(definition, { cwd, homeDir, request = {} }) {
  const home = path.resolve(homeDir || ".");
  const repo = path.resolve(cwd);
  const root = request.root
    ? resolveProviderRoot(request.root, { cwd: repo, homeDir: home })
    : definition.root({ home, repo });
  const rootScope = request.root ? inferRootScope(root, { cwd: repo, homeDir: home }) : definition.root_scope;
  const detectPath = request.root
    ? root
    : definition.detect_path
      ? definition.detect_path({ home, repo })
      : root;
  const detection = request.root ? "configured-root" : definition.detection;
  const detected = detection === "always" || fs.existsSync(detectPath);
  const required = request.required === true;
  const explicit = request.explicit === true;
  const allowUndetected = request.allow_undetected === true || request.root !== undefined;
  const syncable = detected || allowUndetected;
  const unavailable = !detected && !allowUndetected;
  return {
    id: definition.id,
    title: definition.title,
    root,
    layout: definition.layout,
    kind: definition.kind,
    rule_format: definition.rule_format ?? null,
    extension: definition.extension ?? null,
    entrypoint: definition.entrypoint ?? null,
    single_skill_id: definition.single_skill_id ?? null,
    surface_kind: definition.surface_kind,
    surface_id: definition.surface_id,
    fidelity: definition.fidelity,
    root_scope: rootScope,
    layout_known: true,
    installable: true,
    supports_auxiliary_files: definition.supports_auxiliary_files === true,
    supports_generated_headers: true,
    default_enabled: definition.default_enabled === true,
    detectable: detection !== "always",
    detection,
    detection_path: detectPath,
    detected,
    configured: request.id !== undefined,
    explicit,
    required,
    allow_undetected: allowUndetected,
    syncable,
    unavailable,
    unavailable_reason: unavailable ? `provider '${definition.id}' was not detected at ${detectPath}` : null
  };
}

export function providerById(provider, options = {}) {
  const definition = definitionById(provider);
  if (!definition) {
    const error = new Error(`unknown provider '${provider}'`);
    error.code = "unknown_provider";
    error.provider = provider;
    throw error;
  }
  return providerFromDefinition(definition, options);
}

export function defaultProviderIds() {
  return [...DEFAULT_PROVIDER_IDS];
}

export function resolveProviderSelection({
  provider = null,
  providers = null,
  cwd = process.cwd(),
  homeDir = process.env.HOME ?? ".",
  command = "status"
} = {}) {
  const issues = [];
  const requests = [];
  if (provider) {
    requests.push(normalizeProviderRequest(provider, { explicit: true }));
  } else if (Array.isArray(providers) && providers.length > 0) {
    for (const entry of providers) {
      try {
        requests.push(normalizeProviderRequest(entry));
      } catch (error) {
        issues.push({
          code: error.code ?? "config_invalid_provider",
          severity: "error",
          message: error.message,
          provider: error.provider ?? null,
          field: error.field ?? null
        });
      }
    }
  } else {
    requests.push(...DEFAULT_PROVIDER_IDS.map((id) => normalizeProviderRequest(id)));
  }

  const targets = [];
  const seenSurfaces = new Map();
  for (const request of requests) {
    if (request.enabled === false) {
      continue;
    }
    const definition = definitionById(request.id);
    if (!definition) {
      issues.push({
        code: "unknown_provider",
        severity: "error",
        message: `unknown provider '${request.id}'`,
        provider: request.id
      });
      continue;
    }
    let target;
    try {
      target = providerFromDefinition(definition, { cwd, homeDir, request });
    } catch (error) {
      issues.push({
        code: error.code ?? "provider_invalid",
        severity: "error",
        message: error.message,
        provider: request.id,
        field: error.field ?? null,
        path: error.path ?? null
      });
      continue;
    }
    if (target.unavailable) {
      issues.push({
        code: "provider_unavailable",
        severity: target.explicit || target.required ? "error" : "warning",
        message: target.unavailable_reason,
        provider: target.id,
        required: target.required,
        explicit: target.explicit,
        path: target.detection_path
      });
      if (command === "sync" || target.explicit || target.required) {
        targets.push(target);
      } else {
        targets.push(target);
      }
      continue;
    }
    if (seenSurfaces.has(target.surface_id)) {
      issues.push({
        code: "provider_surface_deduped",
        severity: "info",
        message: `provider '${target.id}' shares install surface '${target.surface_id}' with '${seenSurfaces.get(target.surface_id)}'`,
        provider: target.id,
        surface_id: target.surface_id,
        primary_provider: seenSurfaces.get(target.surface_id)
      });
      continue;
    }
    seenSurfaces.set(target.surface_id, target.id);
    targets.push(target);
  }
  return { providers: targets, issues };
}

export function installedSkillPath(providerTarget, skill) {
  return installedEntrypointPath(providerTarget, skill);
}

export function installedSkillRoot(providerTarget, skill) {
  assertSafeSkillId(skill);
  if (!providerTarget?.installable || !providerTarget.root) {
    const error = new Error(`provider '${providerTarget?.id ?? "unknown"}' has no installable skill root`);
    error.code = "provider_layout_unknown";
    error.provider = providerTarget?.id ?? null;
    throw error;
  }
  if (providerTarget.kind === "rule-directory" || providerTarget.kind === "single-instructions-file") {
    return providerTarget.root;
  }
  return path.join(providerTarget.root, skill);
}

export function installedEntrypointPath(providerTarget, skill) {
  const root = installedSkillRoot(providerTarget, skill);
  if (providerTarget.kind === "rule-directory") {
    return path.join(root, `${skill}${providerTarget.extension ?? ".md"}`);
  }
  if (providerTarget.kind === "single-instructions-file") {
    return path.join(root, providerTarget.entrypoint ?? "AGENTS.skillpress.md");
  }
  return path.join(root, "SKILL.md");
}
