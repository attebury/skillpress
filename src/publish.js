import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { resolveRuntimeConfig } from "./config.js";
import { discoverSkillSources } from "./source.js";
import { loadCommandContracts } from "./contracts.js";
import { lintSkillContent } from "./skill-lint.js";
import {
  readManifestDocument,
  writeManifestDocument,
  resolveManifestLocation
} from "./manifest.js";
import {
  expandHome,
  isPathInside,
  assertNoSymlinkEscape,
  providerById,
  installedSkillRoot,
  installedEntrypointPath
} from "./providers.js";

const SENSITIVE_SYSTEM_PREFIXES = [
  "/etc", "/var", "/usr", "/bin", "/sbin", "/System", "/Library", "/opt",
  "/private/etc", "/private/var"
];

function publishError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, details);
  return error;
}

function findLaneRegistry(startDir) {
  let current = path.resolve(startDir);
  while (true) {
    const candidate = path.join(current, "lane-registry.local.json");
    if (fs.existsSync(candidate)) {
      return candidate;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  return null;
}

function findWorkspaceRoot(startDir) {
  let current = path.resolve(startDir);
  while (true) {
    if (
      fs.existsSync(path.join(current, ".git")) ||
      fs.existsSync(path.join(current, "package.json")) ||
      fs.existsSync(path.join(current, "skillpress.config.json"))
    ) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  return startDir;
}

function isPathSensitive(resolvedPath, homeDir) {
  const normalized = resolvedPath.toLowerCase();

  const tempDir = os.tmpdir().toLowerCase();
  if (normalized.startsWith(tempDir)) {
    return false;
  }

  for (const prefix of SENSITIVE_SYSTEM_PREFIXES) {
    if (normalized === prefix || normalized.startsWith(prefix + "/")) {
      return true;
    }
  }
  const sshDir = path.join(homeDir, ".ssh").toLowerCase();
  const awsDir = path.join(homeDir, ".aws").toLowerCase();
  const gnupgDir = path.join(homeDir, ".gnupg").toLowerCase();

  if (normalized === sshDir || normalized.startsWith(sshDir + "/")) return true;
  if (normalized === awsDir || normalized.startsWith(awsDir + "/")) return true;
  if (normalized === gnupgDir || normalized.startsWith(gnupgDir + "/")) return true;

  return false;
}

function parseLanesList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  let str = String(value).trim();
  if (str.startsWith("[") && str.endsWith("]")) {
    str = str.slice(1, -1);
  }
  return str.split(",").map((entry) => entry.trim()).filter(Boolean);
}

function manifestInstalledPath(providerTarget, installedPath, { cwd, homeDir }) {
  if (providerTarget.root_scope === "home") {
    const relative = path.relative(homeDir, installedPath).split(path.sep).join("/");
    return `~/${relative}`;
  }
  if (providerTarget.root_scope === "workspace") {
    const relative = path.relative(cwd, installedPath).split(path.sep).join("/");
    return relative || ".";
  }
  return installedPath;
}

function mergeManifestEntries(existingEntries, newEntries) {
  const replacementKeys = new Set(newEntries.flatMap((entry) => [
    `${entry.provider}\0${entry.skill}`,
    `path\0${entry.installed_path}`
  ]));
  const kept = existingEntries.filter((entry) => !replacementKeys.has(`${entry.provider}\0${entry.skill}`) && !replacementKeys.has(`path\0${entry.installed_path}`));
  return [...kept, ...newEntries].sort((a, b) => {
    const left = `${a.provider}/${a.skill}`;
    const right = `${b.provider}/${b.skill}`;
    return left.localeCompare(right);
  });
}

export function publishPacket(options = {}) {
  const cwd = path.resolve(options.workspaceRoot ?? options.cwd ?? process.cwd());
  const homeDir = path.resolve(options.homeDir ?? process.env.HOME ?? ".");
  const dryRun = options.dryRun === true;

  const skillName = options.skillName;
  if (!skillName) {
    throw publishError("missing_skill_name", "Skill name is required for publishing");
  }

  // Load config & sources
  const runtimeConfig = resolveRuntimeConfig({
    cwd,
    configPath: options.configPath,
    sourceRoot: options.sourceRoot,
    sourceLayout: options.sourceLayout,
    contractRoot: options.contractRoot,
    policyPacks: options.policyPacks
  });

  const sourceState = discoverSkillSources({
    cwd,
    sourceRoots: runtimeConfig.config.source_roots
  });

  const source = sourceState.sources.find((src) => src.skill === skillName);
  if (!source) {
    throw publishError("canonical_skill_missing", `Canonical skill '${skillName}' was not found in discovered source roots`);
  }

  // Lint skill first
  const contractState = loadCommandContracts({
    cwd,
    contractRoot: runtimeConfig.config.contract_root
  });

  const lintFindings = lintSkillContent(source.content, {
    skill: source.skill,
    tool: source.tool,
    path: source.path,
    contracts: contractState.contracts,
    policyPacks: runtimeConfig.config.policy_packs,
    source
  });

  const lintErrors = lintFindings.filter((f) => f.severity === "error");
  if (lintErrors.length > 0) {
    return {
      ok: false,
      type: "skillpress_publish_failed",
      schema_version: 1,
      code: "skill_validation_failed",
      message: `Skill validation failed with ${lintErrors.length} errors`,
      errors: lintErrors
    };
  }

  // Resolve scope precedence: CLI override > config overrides > frontmatter defaults > system default ("forest")
  let resolvedScope = options.scope;
  let explicitlyOverridden = !!options.scope;

  const configPublishRules = runtimeConfig.config.publish_rules ?? {};
  const configRule = configPublishRules[skillName] ?? {};

  if (!resolvedScope && configRule.scope) {
    resolvedScope = configRule.scope;
    explicitlyOverridden = true;
  }

  const fmFields = source.frontmatter?.fields ?? {};
  const fmScope = fmFields.skillpress_publish_scope ?? fmFields.publish_scope;

  if (!resolvedScope) {
    resolvedScope = fmScope ?? "forest";
  }

  if (!["global", "forest", "tree"].includes(resolvedScope)) {
    throw publishError("invalid_publish_scope", `Invalid resolved scope '${resolvedScope}'`);
  }

  // Global Elevation Refusal validation
  if (resolvedScope === "global" && !explicitlyOverridden && fmScope === "global") {
    return {
      ok: false,
      type: "skillpress_publish_failed",
      schema_version: 1,
      code: "publish_scope_elevation_forbidden",
      message: `Global publishing is requested by skill frontmatter but not authorized by project config or CLI overrides`
    };
  }

  // Resolve Lanes (only used for tree scope)
  let resolvedLanes = options.lanes;
  if (!resolvedLanes && configRule.lanes) {
    resolvedLanes = configRule.lanes;
  }
  if (!resolvedLanes) {
    resolvedLanes = parseLanesList(fmFields.skillpress_publish_lanes ?? fmFields.publish_lanes);
  }

  // Resolve target directory lists
  const targetDirectories = [];
  const targetProviderId = resolvedScope === "global" ? "agent-skills-global" : "agent-skills-workspace";
  const providerTarget = providerById(targetProviderId, { cwd, homeDir });

  const registryFile = findLaneRegistry(cwd);
  let lanesRoot = null;
  let parsedRegistry = null;

  if (registryFile) {
    lanesRoot = path.dirname(registryFile);
    try {
      parsedRegistry = JSON.parse(fs.readFileSync(registryFile, "utf8"));
    } catch {
      // Ignore parse failure; fallback gracefully
    }
  }

  if (resolvedScope === "global") {
    // Global path sandboxing
    const globalRoot = providerTarget.root;
    if (isPathSensitive(globalRoot, homeDir)) {
      throw publishError("unsafe_destination_path", "Global skills root is classified as a sensitive system path", { path: globalRoot });
    }
    const skillRoot = path.join(globalRoot, skillName);
    assertNoSymlinkEscape(skillRoot, globalRoot, "global_skills_root");
    targetDirectories.push({ path: skillRoot, type: "global" });
  } else if (resolvedScope === "forest") {
    if (parsedRegistry && parsedRegistry.lanes && typeof parsedRegistry.lanes === "object") {
      // Multi-worktree forest propagation
      for (const [laneName, laneConfig] of Object.entries(parsedRegistry.lanes)) {
        if (laneConfig && typeof laneConfig.path === "string") {
          const lanePath = path.resolve(expandHome(laneConfig.path, homeDir));
          if (isPathSensitive(lanePath, homeDir)) {
            throw publishError("unsafe_destination_path", `Lane path for '${laneName}' is classified as a sensitive system path`, { path: lanePath });
          }
          if (!isPathInside(lanePath, lanesRoot)) {
            throw publishError("unsafe_destination_path", `Lane path for '${laneName}' escapes the forest parent root`, { path: lanePath, root: lanesRoot });
          }
          const relWorkspaceRoot = process.env.AGENT_SKILLS_WORKSPACE_ROOT ?? ".agents/skills";
          const resolvedLocalSkillsRoot = path.resolve(lanePath, relWorkspaceRoot);
          const skillRoot = path.join(resolvedLocalSkillsRoot, skillName);
          assertNoSymlinkEscape(skillRoot, lanePath, `lane_${laneName}_root`);
          targetDirectories.push({ path: skillRoot, type: "lane", laneName });
        }
      }
    } else {
      // Standalone workspace fallback
      const wr = findWorkspaceRoot(cwd);
      if (isPathSensitive(wr, homeDir)) {
        throw publishError("unsafe_destination_path", "Workspace root is classified as a sensitive system path", { path: wr });
      }
      const relWorkspaceRoot = process.env.AGENT_SKILLS_WORKSPACE_ROOT ?? ".agents/skills";
      const resolvedLocalSkillsRoot = path.resolve(wr, relWorkspaceRoot);
      const skillRoot = path.join(resolvedLocalSkillsRoot, skillName);
      assertNoSymlinkEscape(skillRoot, wr, "workspace_root");
      targetDirectories.push({ path: skillRoot, type: "standalone" });
    }
  } else if (resolvedScope === "tree") {
    if (!parsedRegistry) {
      return {
        ok: false,
        type: "skillpress_publish_failed",
        schema_version: 1,
        code: "lane_registry_missing",
        message: "A lane-registry.local.json file is required to resolve specific lane targets"
      };
    }
    const filterLanes = resolvedLanes;
    if (filterLanes.length === 0) {
      throw publishError("missing_target_lanes", "Target lanes list is required for tree-scoped publishing");
    }
    const registryLanes = parsedRegistry.lanes ?? {};
    for (const laneName of filterLanes) {
      const laneConfig = registryLanes[laneName];
      if (!laneConfig || typeof laneConfig.path !== "string") {
        throw publishError("unknown_target_lane", `Requested lane '${laneName}' was not found in the lane registry`);
      }
      const lanePath = path.resolve(expandHome(laneConfig.path, homeDir));
      if (isPathSensitive(lanePath, homeDir)) {
        throw publishError("unsafe_destination_path", `Lane path for '${laneName}' is classified as a sensitive system path`, { path: lanePath });
      }
      if (!isPathInside(lanePath, lanesRoot)) {
        throw publishError("unsafe_destination_path", `Lane path for '${laneName}' escapes the forest parent root`, { path: lanePath, root: lanesRoot });
      }
      const relWorkspaceRoot = process.env.AGENT_SKILLS_WORKSPACE_ROOT ?? ".agents/skills";
      const resolvedLocalSkillsRoot = path.resolve(lanePath, relWorkspaceRoot);
      const skillRoot = path.join(resolvedLocalSkillsRoot, skillName);
      assertNoSymlinkEscape(skillRoot, lanePath, `lane_${laneName}_root`);
      targetDirectories.push({ path: skillRoot, type: "lane", laneName });
    }
  }

  // Pre-calculate published files lists
  const publishedFiles = [];
  const manifestEntries = [];

  for (const target of targetDirectories) {
    const filesList = [];
    for (const file of source.files) {
      const targetFilePath = path.join(target.path, file.relative_path);
      publishedFiles.push({
        source: file.path,
        target: targetFilePath,
        relative_path: file.relative_path,
        bytes: file.bytes
      });
      filesList.push(file.relative_path);
    }
    // Prepare manifest entry
    const installedEntrypoint = path.join(target.path, "SKILL.md");
    manifestEntries.push({
      skill: source.skill,
      provider: targetProviderId,
      source_path: source.source_path,
      source_root_path: source.source_root_path,
      source_hash: source.source_hash,
      skill_md_hash: source.skill_md_hash,
      source_tree_hash: source.source_tree_hash,
      source_layout: source.source_layout,
      source_commit: null,
      installed_path: manifestInstalledPath(providerTarget, installedEntrypoint, { cwd, homeDir }),
      installed_root: manifestInstalledPath(providerTarget, target.path, { cwd, homeDir }),
      files: filesList,
      version: source.frontmatter?.fields?.version ?? null,
      target: targetProviderId,
      surface_id: providerTarget.surface_id,
      surface_kind: providerTarget.surface_kind,
      fidelity: providerTarget.fidelity,
      provider_detected: true,
      auxiliary_files_omitted: false
    });
  }

  // Dry run output
  if (dryRun) {
    return {
      ok: true,
      type: "skillpress_publish",
      schema_version: 1,
      skill: skillName,
      scope: resolvedScope,
      dry_run: true,
      published_files: publishedFiles.map((f) => ({
        source: path.relative(cwd, f.source).split(path.sep).join("/"),
        target: f.target.startsWith(homeDir)
          ? `~/${path.relative(homeDir, f.target).split(path.sep).join("/")}`
          : path.relative(cwd, f.target).split(path.sep).join("/"),
        bytes: f.bytes
      })),
      targets: targetDirectories.map((t) => t.path)
    };
  }

  // Execute copying
  for (const f of publishedFiles) {
    fs.mkdirSync(path.dirname(f.target), { recursive: true });
    fs.copyFileSync(f.source, f.target);
  }

  // Update manifest document
  const resolvedManifest = readManifestDocument(options.manifestPath, {
    cwd,
    homeDir,
    configManifestPath: runtimeConfig.config.manifest?.path
  });
  const updatedEntries = mergeManifestEntries(resolvedManifest.manifest.entries, manifestEntries);
  resolvedManifest.document.entries = updatedEntries;
  writeManifestDocument(options.manifestPath, resolvedManifest.document, {
    cwd,
    homeDir,
    configManifestPath: runtimeConfig.config.manifest?.path
  });

  // Auto-generate forest config if missing and active forest is resolved
  if (resolvedScope !== "global" && lanesRoot && !fs.existsSync(path.join(lanesRoot, "skillpress.config.json"))) {
    const defaultRule = { scope: resolvedScope };
    if (resolvedScope === "tree") {
      defaultRule.lanes = resolvedLanes;
    }
    const defaultJson = {
      publish_rules: {
        [skillName]: defaultRule
      }
    };
    fs.writeFileSync(path.join(lanesRoot, "skillpress.config.json"), JSON.stringify(defaultJson, null, 2) + "\n");
  }

  return {
    ok: true,
    type: "skillpress_publish",
    schema_version: 1,
    skill: skillName,
    scope: resolvedScope,
    dry_run: false,
    published_files: publishedFiles.map((f) => ({
      source: path.relative(cwd, f.source).split(path.sep).join("/"),
      target: f.target.startsWith(homeDir)
        ? `~/${path.relative(homeDir, f.target).split(path.sep).join("/")}`
        : path.relative(cwd, f.target).split(path.sep).join("/"),
      bytes: f.bytes
    })),
    targets: targetDirectories.map((t) => t.path)
  };
}
