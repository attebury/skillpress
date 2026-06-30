import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { providerTargets, isPathInside } from "./providers.js";
import { readManifest } from "./manifest.js";
import {
  compareHeaderToManifest,
  lintMarkdownFences,
  parseGeneratedHeader
} from "./skill-lint.js";

function sha256(content) {
  return `sha256:${crypto.createHash("sha256").update(content).digest("hex")}`;
}

function issue(code, severity, message, details = {}) {
  return { code, severity, message, ...details };
}

function readSkillFile(filePath, provider) {
  const content = fs.readFileSync(filePath, "utf8");
  const skill = path.basename(path.dirname(filePath));
  const header = parseGeneratedHeader(content);
  const markdownFindings = lintMarkdownFences(content);
  return {
    skill,
    provider,
    path: filePath,
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
      advisory: target.placeholder_reason ?? "Provider root is not installable."
    };
  }
  if (!fs.existsSync(target.root)) {
    return {
      ...target,
      exists: false,
      scanned: true,
      skills: []
    };
  }
  const skills = [];
  for (const dirent of fs.readdirSync(target.root, { withFileTypes: true })) {
    if (!dirent.isDirectory()) {
      continue;
    }
    const skillPath = path.join(target.root, dirent.name, "SKILL.md");
    if (!isPathInside(skillPath, target.root) || !fs.existsSync(skillPath)) {
      continue;
    }
    skills.push(readSkillFile(skillPath, target.id));
  }
  return {
    ...target,
    exists: true,
    scanned: true,
    skills
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

function collectIssues({ inventory, manifestState }) {
  const issues = [];
  const skills = inventory.flatMap((provider) => provider.skills);
  const manifestEntries = manifestState.manifest?.entries ?? [];
  const manifestByPath = new Map(manifestEntries.map((entry) => [manifestEntryKey(entry), entry]));
  const installedKeys = new Set(skills.map((skill) => `${skill.provider}\0${skill.path}`));

  for (const entry of manifestEntries) {
    if (!installedKeys.has(manifestEntryKey(entry))) {
      issues.push(issue("installed_skill_missing", "error", "Manifest-managed installed skill is missing", {
        skill: entry.skill,
        provider: entry.provider,
        path: entry.installed_path
      }));
    }
  }

  for (const skill of skills) {
    const manifestEntry = manifestByPath.get(`${skill.provider}\0${skill.path}`) ?? null;
    if (manifestState.present && !manifestEntry) {
      issues.push(issue("installed_skill_unmanaged", "warning", "Installed skill has no manifest entry", {
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
    issues.push(issue("duplicate_skill_name", "warning", "Skill name is installed in multiple provider roots", {
      skill: skillName,
      providers: group.map((entry) => entry.provider),
      paths: group.map((entry) => entry.path)
    }));
    const hashes = new Set(group.map((entry) => entry.content_hash));
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
  const allProviders = providerTargets({ cwd, homeDir });
  const providerIssues = [];
  if (options.provider && !allProviders.some((provider) => provider.id === options.provider)) {
    providerIssues.push(issue("unknown_provider", "error", `unknown provider '${options.provider}'`, {
      provider: options.provider
    }));
  }
  const providerFilter = options.provider ? new Set([options.provider]) : null;
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
    ...loadIssues,
    ...collectIssues({ inventory, manifestState })
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
      entry_count: manifestState.manifest?.entries.length ?? 0
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
      malformed_markdown_count: issues.filter((entry) => entry.code === "markdown_fence_unbalanced").length
    }
  };
}
