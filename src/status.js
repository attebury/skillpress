import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { assertSafeSkillId, providerTargets, providerById, isPathInside } from "./providers.js";
import { readManifest } from "./manifest.js";
import { loadCommandContracts } from "./contracts.js";
import { expectedEntrypointBody, stripGeneratedHeader } from "./render.js";
import {
  compareHeaderToManifest,
  lintCommandContracts,
  lintMarkdownFences,
  lintPolicyRules,
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

function readSkillFile(filePath, provider, installedRoot) {
  const content = fs.readFileSync(filePath, "utf8");
  const skill = path.basename(filePath) === "SKILL.md"
    ? path.basename(path.dirname(filePath))
    : path.basename(filePath, path.extname(filePath));
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
  if (!target.installable || !target.root) {
    return {
      ...target,
      exists: false,
      scanned: false,
      skills: [],
      issues: [],
      advisory: target.placeholder_reason ?? "Provider root is not installable."
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
  if (target.kind === "cursor-rule") {
    for (const dirent of fs.readdirSync(target.root, { withFileTypes: true })) {
      if (!dirent.isFile() || path.extname(dirent.name) !== ".mdc") {
        continue;
      }
      const skill = path.basename(dirent.name, ".mdc");
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
  for (const dirent of fs.readdirSync(target.root, { withFileTypes: true })) {
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

function loadManifestIfPresent({ manifestPath, cwd, homeDir }) {
  if (manifestPath) {
    return { present: true, ...readManifest(manifestPath, { cwd, homeDir }) };
  }
  const defaultPath = path.join(cwd, "skillpress.manifest.json");
  if (!fs.existsSync(defaultPath)) {
    return { present: false, path: defaultPath, manifest: null };
  }
  return { present: true, ...readManifest(defaultPath, { cwd, homeDir }) };
}

function manifestEntryKey(entry) {
  return `${entry.provider}\0${entry.installed_path}`;
}

function collectSourceIssues({ sourceState, contractState, policyPacks }) {
  const issues = [];
  for (const source of sourceState.sources) {
    const context = {
      skill: source.skill,
      tool: source.tool,
      path: source.path,
      contracts: contractState.contracts,
      policyPacks,
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
  if (!source || !manifestEntry || providerTarget?.kind === "cursor-rule") {
    if (source?.has_auxiliary_files && manifestEntry && providerTarget?.kind === "cursor-rule") {
      issues.push(issue("cursor_auxiliary_files_ignored", "warning", "Cursor rules cannot consume auxiliary Agent Skills files directly", {
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

function collectIssues({ inventory, manifestState, sourceState, contractState, policyPacks, cwd, homeDir }) {
  const issues = [];
  const skills = inventory.flatMap((provider) => provider.skills);
  const manifestEntries = manifestState.manifest?.entries ?? [];
  const manifestByPath = new Map(manifestEntries.map((entry) => [manifestEntryKey(entry), entry]));
  const canonicalByPath = sourceByPath(sourceState.sources);
  const installedKeys = new Set(skills.map((skill) => `${skill.provider}\0${skill.path}`));
  const providers = providerMap(inventory);

  for (const entry of manifestEntries) {
    if (!installedKeys.has(manifestEntryKey(entry))) {
      issues.push(issue("installed_skill_missing", "error", "Manifest-managed installed skill is missing", {
        skill: entry.skill,
        provider: entry.provider,
        path: entry.installed_path
      }));
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
    if (policyPacks.includes("dogfood")) {
      for (const finding of lintPolicyRules(stripGeneratedHeader(skill.content), lintContext)) {
        issues.push(issue(finding.code, finding.severity, finding.message, {
          skill: skill.skill,
          provider: skill.provider,
          path: skill.path,
          tool: finding.tool ?? lintContext.tool
        }));
      }
    }
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
  const sourceState = discoverSkillSources({ cwd, sourceRoots: runtimeConfig.config.source_roots, tool: options.tool });
  const contractState = loadCommandContracts({ cwd, contractRoot: runtimeConfig.config.contract_root });
  const allProviders = providerTargets({ cwd, homeDir });
  const providerIssues = [];
  const requestedProviders = runtimeConfig.config.providers ?? (options.provider ? [options.provider] : null);
  for (const providerId of requestedProviders ?? []) {
    if (!allProviders.some((provider) => provider.id === providerId)) {
      providerIssues.push(issue("unknown_provider", "error", `unknown provider '${providerId}'`, {
        provider: providerId
      }));
    }
  }
  const providerFilter = requestedProviders ? new Set(requestedProviders) : null;
  const providers = allProviders.filter((provider) => !providerFilter || providerFilter.has(provider.id));

  let manifestState;
  const loadIssues = [];
  try {
    manifestState = loadManifestIfPresent({ manifestPath: options.manifestPath, cwd, homeDir });
  } catch (error) {
    manifestState = {
      present: false,
      path: path.resolve(cwd, options.manifestPath ?? "skillpress.manifest.json"),
      manifest: null
    };
    loadIssues.push(issue(error.code ?? "manifest_invalid", "error", error.message, {
      field: error.field,
      provider: error.provider,
      path: error.path
    }));
  }

  const inventory = providers.map(inventoryProvider);
  const issues = [
    ...providerIssues,
    ...runtimeConfig.issues,
    ...loadIssues,
    ...inventory.flatMap((provider) => provider.issues ?? []),
    ...sourceState.issues,
    ...contractState.issues,
    ...collectSourceIssues({
      sourceState,
      contractState,
      policyPacks: runtimeConfig.config.policy_packs
    }),
    ...collectIssues({
      inventory,
      manifestState,
      sourceState,
      contractState,
      policyPacks: runtimeConfig.config.policy_packs,
      cwd,
      homeDir
    })
  ];
  const skills = inventory.flatMap((provider) => provider.skills).map(({ content, ...skill }) => skill);
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
      skill_count: providerSkills.length
    })),
    manifest: {
      present: manifestState.present,
      path: manifestState.path,
      version: manifestState.manifest?.version ?? null,
      entry_count: manifestState.manifest?.entries.length ?? 0
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
