import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { assertSafeSkillId, providerById, isPathInside, resolveProviderSelection } from "./providers.js";
import { readManifestDocument, resolveManifestLocation } from "./manifest.js";
import { loadCommandContracts } from "./contracts.js";
import { expectedEntrypointBody, renderSingleInstructions, stripGeneratedHeader } from "./render.js";
import {
  compareHeaderToManifest,
  lintCommandContracts,
  lintMarkdownFences,
  lintSkillContent,
  parseGeneratedHeader
} from "./skill-lint.js";
import { discoverSkillSources, sourceByPath } from "./source.js";
import { resolveRuntimeConfig } from "./config.js";

function sha256(content) {
  return `sha256:${crypto.createHash("sha256").update(content).digest("hex")}`;
}

function issue(code, severity, message, details = {}) {
  return { code, severity, message, ...details };
}

function readSkillFile(filePath, provider, installedRoot, skillOverride = null) {
  const content = fs.readFileSync(filePath, "utf8");
  const skill = skillOverride ?? (path.basename(filePath) === "SKILL.md"
    ? path.basename(path.dirname(filePath))
    : path.basename(filePath, path.extname(filePath)));
  const header = parseGeneratedHeader(content);
  const markdownFindings = lintMarkdownFences(content);
  return {
    skill,
    provider,
    path: filePath,
    installed_root: installedRoot,
    content_hash: sha256(content),
    generated_header: {
      present: header.present,
      fields: header.fields,
      errors: header.errors
    },
    markdown: {
      ok: markdownFindings.length === 0,
      findings: markdownFindings
    },
    content
  };
}

function inventoryProvider(target) {
  if (!target.installable || !target.root || !target.syncable) {
    return {
      ...target,
      exists: false,
      scanned: false,
      skills: [],
      issues: [],
      advisory: target.unavailable_reason ?? target.placeholder_reason ?? "Provider root is not installable."
    };
  }
  if (!fs.existsSync(target.root)) {
    return {
      ...target,
      exists: false,
      scanned: true,
      skills: [],
      issues: []
    };
  }
  const skills = [];
  const issues = [];
  if (target.kind === "rule-directory") {
    for (const dirent of fs.readdirSync(target.root, { withFileTypes: true })) {
      const extension = target.extension ?? ".md";
      if (dirent.isSymbolicLink()) {
        const skill = dirent.name.endsWith(extension)
          ? dirent.name.slice(0, -extension.length)
          : dirent.name;
        issues.push(issue("installed_skill_symlink", "error", "Installed provider-cache skill entry is a symlink", {
          provider: target.id,
          skill,
          path: path.join(target.root, dirent.name)
        }));
        continue;
      }
      if (!dirent.isFile() || !dirent.name.endsWith(extension)) {
        continue;
      }
      const skill = dirent.name.slice(0, -extension.length);
      try {
        assertSafeSkillId(skill);
      } catch (error) {
        issues.push(issue(error.code ?? "invalid_skill_id", "error", error.message, {
          provider: target.id,
          skill,
          path: path.join(target.root, dirent.name)
        }));
        continue;
      }
      const skillPath = path.join(target.root, dirent.name);
      if (isPathInside(skillPath, target.root)) {
        skills.push(readSkillFile(skillPath, target.id, target.root));
      }
    }
    return {
      ...target,
      exists: true,
      scanned: true,
      skills,
      issues
    };
  }
  if (target.kind === "single-instructions-file") {
    const skillPath = path.join(target.root, target.entrypoint ?? "AGENTS.skillpress.md");
    if (isPathInside(skillPath, target.root) && fs.existsSync(skillPath) && fs.lstatSync(skillPath).isSymbolicLink()) {
      issues.push(issue("installed_skill_symlink", "error", "Installed provider-cache instruction file is a symlink", {
        provider: target.id,
        skill: target.single_skill_id ?? "skillpress-instructions",
        path: skillPath
      }));
      return {
        ...target,
        exists: true,
        scanned: true,
        skills,
        issues
      };
    }
    if (isPathInside(skillPath, target.root) && fs.existsSync(skillPath)) {
      skills.push(readSkillFile(skillPath, target.id, target.root, target.single_skill_id ?? "skillpress-instructions"));
    }
    return {
      ...target,
      exists: true,
      scanned: true,
      skills,
      issues
    };
  }
  for (const dirent of fs.readdirSync(target.root, { withFileTypes: true })) {
    if (dirent.isSymbolicLink()) {
      issues.push(issue("installed_skill_symlink", "error", "Installed provider-cache skill directory is a symlink", {
        provider: target.id,
        skill: dirent.name,
        path: path.join(target.root, dirent.name)
      }));
      continue;
    }
    if (!dirent.isDirectory()) {
      continue;
    }
    try {
      assertSafeSkillId(dirent.name);
    } catch (error) {
      issues.push(issue(error.code ?? "invalid_skill_id", "error", error.message, {
        provider: target.id,
        skill: dirent.name,
        path: path.join(target.root, dirent.name)
      }));
      continue;
    }
    const skillPath = path.join(target.root, dirent.name, "SKILL.md");
    if (!isPathInside(skillPath, target.root) || !fs.existsSync(skillPath)) {
      continue;
    }
    skills.push(readSkillFile(skillPath, target.id, path.dirname(skillPath)));
  }
  return {
    ...target,
    exists: true,
    scanned: true,
    skills,
    issues
  };
}

function providerTargetsForManifest(runtimeConfig, providerSelection, { cwd, homeDir }) {
  const targets = new Map();
  if (Array.isArray(runtimeConfig.config.configured_providers) && runtimeConfig.config.configured_providers.length > 0) {
    const configuredSelection = resolveProviderSelection({
      providers: runtimeConfig.config.configured_providers,
      cwd,
      homeDir,
      command: "status"
    });
    for (const provider of configuredSelection.providers) {
      targets.set(provider.id, provider);
    }
  }
  for (const provider of providerSelection.providers) {
    targets.set(provider.id, provider);
  }
  return targets;
}

function loadManifestIfPresent({ manifestPath, configManifestPath, cwd, homeDir, providerTargets }) {
  const state = readManifestDocument(manifestPath, { cwd, homeDir, configManifestPath, providerTargets });
  return {
    present: state.existed,
    path: state.path,
    location: state.location,
    manifest: state.existed ? state.manifest : null
  };
}

function manifestEntryKey(entry) {
  return `${entry.provider}\0${entry.installed_path}`;
}

function normalizeRelativePath(value) {
  return String(value ?? "").replace(/\\/g, "/").replace(/^\.\//, "");
}

function toolScopedPathMatches(value, { cwd, requestedTool, sourceState }) {
  if (!value) {
    return false;
  }
  const candidate = normalizeRelativePath(value);
  return sourceState.roots.some((root) => {
    if (root.layout !== "tool-scoped") {
      return false;
    }
    const rootPath = normalizeRelativePath(path.relative(cwd, root.path));
    const prefix = rootPath ? `${rootPath}/${requestedTool}` : requestedTool;
    return candidate === prefix || candidate.startsWith(`${prefix}/`);
  });
}

function createToolScope({ requestedTool, sourceState, manifestEntries, cwd }) {
  if (!requestedTool) {
    return null;
  }
  const canonicalByPath = sourceByPath(sourceState.sources);
  const canonicalSkillNames = new Set(sourceState.sources.map((source) => source.skill));
  const scopedManifestKeys = new Set();
  for (const entry of manifestEntries) {
    const source = entry.source_path ? canonicalByPath.get(entry.source_path) : null;
    if (
      source?.tool === requestedTool
      || toolScopedPathMatches(entry.source_path, { cwd, requestedTool, sourceState })
      || toolScopedPathMatches(entry.source_root_path, { cwd, requestedTool, sourceState })
    ) {
      scopedManifestKeys.add(manifestEntryKey(entry));
    }
  }
  return {
    requestedTool,
    canonicalSkillNames,
    scopedManifestKeys
  };
}

function manifestEntryInScope(entry, toolScope) {
  return !toolScope || toolScope.scopedManifestKeys.has(manifestEntryKey(entry));
}

function installedSkillInScope(skill, { toolScope, manifestByPath }) {
  if (!toolScope) {
    return true;
  }
  const key = `${skill.provider}\0${skill.path}`;
  if (manifestByPath.has(key)) {
    return toolScope.scopedManifestKeys.has(key);
  }
  return skill.generated_header.fields.tool === toolScope.requestedTool
    || toolScope.canonicalSkillNames.has(skill.skill);
}

function inventoryIssueInScope(entry, toolScope) {
  if (!toolScope) {
    return true;
  }
  return entry.skill ? toolScope.canonicalSkillNames.has(entry.skill) : false;
}

function contractIssueInScope(entry, toolScope) {
  if (!toolScope) {
    return true;
  }
  if (entry.code === "command_contract_root_outside_repo") {
    return true;
  }
  if (entry.tool) {
    return entry.tool === toolScope.requestedTool;
  }
  const fileTool = entry.path ? path.basename(entry.path).replace(/\.commands\.json$/, "") : null;
  return fileTool === toolScope.requestedTool;
}

function collectSourceIssues({ sourceState, contractState, policyPacks, customPolicyRules }) {
  const issues = [];
  for (const source of sourceState.sources) {
    const context = {
      skill: source.skill,
      tool: source.tool,
      path: source.path,
      contracts: contractState.contracts,
      policyPacks,
      customPolicyRules,
      source
    };
    for (const finding of lintSkillContent(source.content, context)) {
      issues.push(issue(finding.code, finding.severity, finding.message, {
        skill: source.skill,
        tool: finding.tool ?? source.tool,
        path: source.path,
        line: finding.line,
        command: finding.command,
        reference: finding.reference
      }));
    }
  }
  return issues;
}

function providerMap(inventory) {
  return new Map(inventory.map((target) => [target.id, target]));
}

function duplicateComparable(skill) {
  return skill.generated_header.fields.source_tree_hash
    ?? skill.generated_header.fields.source_hash
    ?? sha256(stripGeneratedHeader(skill.content));
}

function collectAuxiliaryDrift({ source, manifestEntry, providerTarget }) {
  const issues = [];
  if (!source || !manifestEntry || providerTarget?.supports_auxiliary_files === false) {
    if (source?.has_auxiliary_files && manifestEntry && providerTarget?.supports_auxiliary_files === false) {
      issues.push(issue("provider_auxiliary_files_omitted", "warning", "Provider cannot consume auxiliary Agent Skills files directly", {
        skill: manifestEntry.skill,
        provider: manifestEntry.provider,
        path: manifestEntry.installed_path
      }));
    }
    return issues;
  }
  for (const file of source.files) {
    if (file.relative_path === "SKILL.md") {
      continue;
    }
    const installedFile = path.join(manifestEntry.installed_root, file.relative_path);
    if (!fs.existsSync(installedFile)) {
      issues.push(issue("installed_skill_file_missing", "error", "Installed skill auxiliary file is missing", {
        skill: manifestEntry.skill,
        provider: manifestEntry.provider,
        path: installedFile,
        source_path: file.source_path
      }));
      continue;
    }
    const installedHash = sha256(fs.readFileSync(installedFile));
    if (installedHash !== file.hash) {
      issues.push(issue("installed_skill_drift", "error", "Installed skill auxiliary file differs from canonical source", {
        skill: manifestEntry.skill,
        provider: manifestEntry.provider,
        path: installedFile,
        source_path: file.source_path
      }));
    }
  }
  return issues;
}

function combinedSourceSummary(sources) {
  const payload = sources.map((source) => ({
    skill: source.skill,
    tool: source.tool,
    source_path: source.source_path,
    source_hash: source.source_hash,
    skill_md_hash: source.skill_md_hash,
    source_tree_hash: source.source_tree_hash
  })).sort((left, right) => left.source_path.localeCompare(right.source_path));
  const serialized = JSON.stringify(payload);
  return {
    source_hash: sha256(serialized),
    skill_md_hash: sha256(payload.map((entry) => `${entry.source_path}:${entry.skill_md_hash}`).join("\n")),
    source_tree_hash: sha256(payload.map((entry) => `${entry.source_path}:${entry.source_tree_hash}`).join("\n"))
  };
}

function collectIssues({ inventory, manifestState, sourceState, contractState, policyPacks, cwd, homeDir, toolScope }) {
  const issues = [];
  const allSkills = inventory.flatMap((provider) => provider.skills);
  const allManifestEntries = manifestState.manifest?.entries ?? [];
  const allManifestByPath = new Map(allManifestEntries.map((entry) => [manifestEntryKey(entry), entry]));
  const skills = allSkills.filter((skill) => installedSkillInScope(skill, {
    toolScope,
    manifestByPath: allManifestByPath
  }));
  const manifestEntries = allManifestEntries.filter((entry) => manifestEntryInScope(entry, toolScope));
  const manifestByPath = new Map(manifestEntries.map((entry) => [manifestEntryKey(entry), entry]));
  const canonicalByPath = sourceByPath(sourceState.sources);
  const installedKeys = new Set(allSkills.map((skill) => `${skill.provider}\0${skill.path}`));
  const providers = providerMap(inventory);

  for (const entry of manifestEntries) {
    const providerTarget = providers.get(entry.provider) ?? providerById(entry.provider, { cwd, homeDir });
    if (!installedKeys.has(manifestEntryKey(entry))) {
      issues.push(issue("installed_skill_missing", "error", "Manifest-managed installed skill is missing", {
        skill: entry.skill,
        provider: entry.provider,
        path: entry.installed_path
      }));
    }
    if (providerTarget.kind === "single-instructions-file") {
      const summary = combinedSourceSummary(sourceState.sources);
      if (entry.source_hash && entry.source_hash !== summary.source_hash) {
        issues.push(issue("manifest_source_hash_stale", "error", "Manifest source_hash does not match current generated instructions source set", {
          skill: entry.skill,
          provider: entry.provider,
          source_path: entry.source_path,
          expected: summary.source_hash,
          actual: entry.source_hash
        }));
      }
      if (entry.skill_md_hash && entry.skill_md_hash !== summary.skill_md_hash) {
        issues.push(issue("manifest_skill_md_hash_stale", "error", "Manifest skill_md_hash does not match current generated instructions source set", {
          skill: entry.skill,
          provider: entry.provider,
          source_path: entry.source_path,
          expected: summary.skill_md_hash,
          actual: entry.skill_md_hash
        }));
      }
      if (entry.source_tree_hash && entry.source_tree_hash !== summary.source_tree_hash) {
        issues.push(issue("manifest_source_tree_hash_stale", "error", "Manifest source_tree_hash does not match current generated instructions source set", {
          skill: entry.skill,
          provider: entry.provider,
          source_path: entry.source_path,
          expected: summary.source_tree_hash,
          actual: entry.source_tree_hash
        }));
      }
      continue;
    }
    if (entry.source_path) {
      const source = canonicalByPath.get(entry.source_path);
      if (!source) {
        issues.push(issue("canonical_source_missing_for_manifest", "error", "Manifest entry points to a missing canonical skill source", {
          skill: entry.skill,
          provider: entry.provider,
          source_path: entry.source_path
        }));
      } else if (entry.source_hash && entry.source_hash !== source.source_hash) {
        issues.push(issue("manifest_source_hash_stale", "error", "Manifest source_hash does not match current canonical source", {
          skill: entry.skill,
          provider: entry.provider,
          source_path: entry.source_path,
          expected: source.source_hash,
          actual: entry.source_hash
        }));
      }
      if (source && entry.skill_md_hash && entry.skill_md_hash !== source.skill_md_hash) {
        issues.push(issue("manifest_skill_md_hash_stale", "error", "Manifest skill_md_hash does not match current canonical SKILL.md", {
          skill: entry.skill,
          provider: entry.provider,
          source_path: entry.source_path,
          expected: source.skill_md_hash,
          actual: entry.skill_md_hash
        }));
      }
      if (source && entry.source_tree_hash && entry.source_tree_hash !== source.source_tree_hash) {
        issues.push(issue("manifest_source_tree_hash_stale", "error", "Manifest source_tree_hash does not match current canonical skill tree", {
          skill: entry.skill,
          provider: entry.provider,
          source_path: entry.source_path,
          expected: source.source_tree_hash,
          actual: entry.source_tree_hash
        }));
      }
    }
  }

  for (const skill of skills) {
    const manifestEntry = manifestByPath.get(`${skill.provider}\0${skill.path}`) ?? null;
    const providerTarget = providers.get(skill.provider) ?? providerById(skill.provider, { cwd, homeDir });
    if (manifestState.present && !manifestEntry) {
      issues.push(issue("installed_skill_unmanaged", "error", "Installed skill has no manifest entry", {
        skill: skill.skill,
        provider: skill.provider,
        path: skill.path
      }));
    }
    for (const finding of compareHeaderToManifest(skill.generated_header, manifestEntry)) {
      issues.push(issue(finding.code, finding.severity, finding.message, {
        skill: skill.skill,
        provider: skill.provider,
        path: skill.path,
        field: finding.field,
        expected: finding.expected,
        actual: finding.actual
      }));
    }
    const source = manifestEntry?.source_path ? canonicalByPath.get(manifestEntry.source_path) : null;
    if (manifestEntry && providerTarget.kind === "single-instructions-file") {
      const summary = combinedSourceSummary(sourceState.sources);
      const installedBody = stripGeneratedHeader(skill.content);
      const expectedBody = stripGeneratedHeader(renderSingleInstructions({
        sources: sourceState.sources,
        providerTarget,
        generatedAt: "",
        sourceSummary: summary
      }));
      if (installedBody !== expectedBody) {
        issues.push(issue("installed_skill_drift", "error", "Installed instruction file differs from canonical render", {
          skill: skill.skill,
          provider: skill.provider,
          path: skill.path,
          source_path: manifestEntry.source_path
        }));
      }
    }
    if (manifestEntry && source) {
      const installedBody = stripGeneratedHeader(skill.content);
      const expectedBody = expectedEntrypointBody({ source, providerTarget });
      if (installedBody !== expectedBody) {
        issues.push(issue("installed_skill_drift", "error", "Installed skill content differs from canonical render", {
          skill: skill.skill,
          provider: skill.provider,
          path: skill.path,
          source_path: source.source_path
        }));
      }
      issues.push(...collectAuxiliaryDrift({ source, manifestEntry, providerTarget }));
    }
    const lintContext = {
      skill: skill.skill,
      provider: skill.provider,
      path: skill.path,
      tool: source?.tool ?? null
    };

    for (const finding of lintCommandContracts(stripGeneratedHeader(skill.content), contractState.contracts, lintContext)) {
      issues.push(issue(finding.code, finding.severity, finding.message, {
        skill: skill.skill,
        provider: skill.provider,
        path: skill.path,
        tool: finding.tool,
        command: finding.command
      }));
    }
    for (const finding of skill.markdown.findings) {
      issues.push(issue(finding.code, finding.severity, finding.message, {
        skill: skill.skill,
        provider: skill.provider,
        path: skill.path,
        line: finding.line
      }));
    }
  }

  const bySkill = new Map();
  for (const skill of skills) {
    const group = bySkill.get(skill.skill) ?? [];
    group.push(skill);
    bySkill.set(skill.skill, group);
  }
  for (const [skillName, group] of bySkill.entries()) {
    if (group.length < 2) {
      continue;
    }
    issues.push(issue("duplicate_skill_name", "info", "Skill name is installed in multiple provider roots", {
      skill: skillName,
      providers: group.map((entry) => entry.provider),
      paths: group.map((entry) => entry.path)
    }));
    const hashes = new Set(group.map((entry) => duplicateComparable(entry)));
    if (hashes.size > 1) {
      issues.push(issue("duplicate_skill_content_conflict", "error", "Duplicate skill installs disagree by content hash", {
        skill: skillName,
        providers: group.map((entry) => entry.provider),
        hashes: [...hashes]
      }));
    }
  }
  return issues;
}

export function statusPacket(options = {}) {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const homeDir = path.resolve(options.homeDir ?? process.env.HOME ?? ".");
  const runtimeConfig = resolveRuntimeConfig({
    cwd,
    configPath: options.configPath,
    sourceRoot: options.sourceRoot,
    sourceLayout: options.sourceLayout,
    contractRoot: options.contractRoot,
    provider: options.provider,
    providers: options.providers,
    policyPacks: options.policyPacks
  });
  const configManifestPath = runtimeConfig.config.manifest?.path ?? null;
  const sourceState = discoverSkillSources({ cwd, sourceRoots: runtimeConfig.config.source_roots, tool: options.tool });
  const contractState = loadCommandContracts({ cwd, contractRoot: runtimeConfig.config.contract_root });
  const providerSelection = resolveProviderSelection({
    providers: runtimeConfig.config.providers,
    cwd,
    homeDir,
    command: "status"
  });
  const providers = providerSelection.providers;
  const manifestProviderTargets = providerTargetsForManifest(runtimeConfig, providerSelection, { cwd, homeDir });

  let manifestState;
  const loadIssues = [];
  try {
    manifestState = loadManifestIfPresent({
      manifestPath: options.manifestPath,
      configManifestPath,
      cwd,
      homeDir,
      providerTargets: manifestProviderTargets
    });
  } catch (error) {
    let location = null;
    try {
      location = resolveManifestLocation({ cwd, homeDir, manifestPath: options.manifestPath, configManifestPath });
    } catch {
      location = null;
    }
    manifestState = {
      present: false,
      path: location?.path ?? null,
      location,
      manifest: null
    };
    loadIssues.push(issue(error.code ?? "manifest_invalid", "error", error.message, {
      field: error.field,
      provider: error.provider,
      path: error.path
    }));
  }

  const inventory = providers.map(inventoryProvider);
  const manifestEntries = manifestState.manifest?.entries ?? [];
  const toolScope = createToolScope({
    requestedTool: options.tool ?? null,
    sourceState,
    manifestEntries,
    cwd
  });
  const allManifestByPath = new Map(manifestEntries.map((entry) => [manifestEntryKey(entry), entry]));
  const skills = inventory
    .flatMap((provider) => provider.skills)
    .filter((skill) => installedSkillInScope(skill, {
      toolScope,
      manifestByPath: allManifestByPath
    }))
    .map(({ content, ...skill }) => skill);
  const scopedSkillCounts = skills.reduce((counts, skill) => {
    counts.set(skill.provider, (counts.get(skill.provider) ?? 0) + 1);
    return counts;
  }, new Map());
  const issues = [
    ...providerSelection.issues,
    ...runtimeConfig.issues,
    ...loadIssues,
    ...(!manifestState.location?.explicit && manifestState.location?.legacy_default_present
      ? [issue("legacy_install_manifest_ignored", "warning", "Legacy root install manifest ignored; pass --manifest skillpress.manifest.json to inspect or migrate it explicitly", {
        path: manifestState.location.legacy_default_path
      })]
      : []),
    ...inventory.flatMap((provider) => provider.issues ?? []).filter((entry) => inventoryIssueInScope(entry, toolScope)),
    ...sourceState.issues,
    ...contractState.issues.filter((entry) => contractIssueInScope(entry, toolScope)),
    ...collectSourceIssues({
      sourceState,
      contractState,
      policyPacks: runtimeConfig.config.policy_packs,
      customPolicyRules: runtimeConfig.config.custom_policy_rules
    }),
    ...collectIssues({
      inventory,
      manifestState,
      sourceState,
      contractState,
      policyPacks: runtimeConfig.config.policy_packs,
      cwd,
      homeDir,
      toolScope
    })
  ];
  const errorCount = issues.filter((entry) => entry.severity === "error").length;
  const warningCount = issues.filter((entry) => entry.severity === "warning").length;
  const installedCount = skills.length;

  return {
    ok: errorCount === 0,
    type: "skillpress_status",
    schema_version: 1,
    status: errorCount > 0 ? "fail" : warningCount > 0 ? "drift" : "pass",
    providers: inventory.map(({ skills: providerSkills, ...provider }) => ({
      ...provider,
      skill_count: toolScope ? scopedSkillCounts.get(provider.id) ?? 0 : providerSkills.length
    })),
    manifest: {
      present: manifestState.present,
      path: manifestState.path,
      mode: manifestState.location?.mode ?? null,
      explicit: manifestState.location?.explicit ?? false,
      legacy_default_path: manifestState.location?.legacy_default_path ?? null,
      legacy_default_present: manifestState.location?.legacy_default_present ?? false,
      version: manifestState.present ? manifestState.manifest?.version ?? null : null,
      entry_count: manifestState.present ? manifestState.manifest?.entries.length ?? 0 : 0
    },
    canonical_sources: {
      root: sourceState.root,
      roots: sourceState.roots,
      count: sourceState.sources.length,
      tools: [...new Set(sourceState.sources.map((source) => source.tool))].sort()
    },
    command_contracts: {
      root: contractState.root,
      tools: Object.fromEntries(Object.entries(contractState.contracts).map(([tool, commands]) => [tool, commands.length]))
    },
    config: {
      path: runtimeConfig.path,
      present: runtimeConfig.present,
      policy_packs: runtimeConfig.config.policy_packs
    },
    skills,
    issues,
    summary: {
      provider_count: providers.length,
      installed_count: installedCount,
      issue_count: issues.length,
      error_count: errorCount,
      warning_count: warningCount,
      missing_count: issues.filter((entry) => entry.code === "installed_skill_missing").length,
      duplicate_count: issues.filter((entry) => entry.code === "duplicate_skill_name").length,
      conflict_count: issues.filter((entry) => entry.code === "duplicate_skill_content_conflict").length,
      malformed_markdown_count: issues.filter((entry) => entry.code === "markdown_fence_unbalanced").length,
      source_drift_count: issues.filter((entry) => [
        "installed_skill_drift",
        "installed_skill_file_missing",
        "manifest_source_hash_stale",
        "manifest_skill_md_hash_stale",
        "manifest_source_tree_hash_stale"
      ].includes(entry.code)).length,
      policy_lint_count: issues.filter((entry) => entry.code.startsWith("policy_")).length,
      command_contract_count: issues.filter((entry) => entry.code === "command_contract_unknown").length
    }
  };
}
