import path from "node:path";

export const PROVIDER_IDS = Object.freeze([
  "codex",
  "agents",
  "cursor",
  "claude-code"
]);

const SAFE_SKILL_ID = /^[A-Za-z0-9._-]+$/;

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
  return [
    {
      id: "codex",
      title: "Codex",
      root: path.join(home, ".codex", "skills"),
      layout: "{root}/{skill}/SKILL.md",
      root_scope: "home",
      layout_known: true,
      installable: true
    },
    {
      id: "agents",
      title: "Agents",
      root: path.join(home, ".agents", "skills"),
      layout: "{root}/{skill}/SKILL.md",
      root_scope: "home",
      layout_known: true,
      installable: true
    },
    {
      id: "cursor",
      title: "Cursor",
      root: path.join(repo, ".cursor", "skills"),
      layout: "{workspace}/.cursor/skills/{skill}/SKILL.md",
      root_scope: "workspace",
      layout_known: true,
      installable: true
    },
    {
      id: "claude-code",
      title: "Claude Code",
      root: null,
      layout: null,
      root_scope: "unknown",
      layout_known: false,
      installable: false,
      placeholder_reason: "Provider skill layout is intentionally not claimed until verified."
    }
  ];
}

export function providerById(provider, options = {}) {
  const target = providerTargets(options).find((entry) => entry.id === provider);
  if (!target) {
    const error = new Error(`unknown provider '${provider}'`);
    error.code = "unknown_provider";
    error.provider = provider;
    throw error;
  }
  return target;
}

export function installedSkillPath(providerTarget, skill) {
  assertSafeSkillId(skill);
  if (!providerTarget?.installable || !providerTarget.root) {
    const error = new Error(`provider '${providerTarget?.id ?? "unknown"}' has no installable skill root`);
    error.code = "provider_layout_unknown";
    error.provider = providerTarget?.id ?? null;
    throw error;
  }
  return path.join(providerTarget.root, skill, "SKILL.md");
}
