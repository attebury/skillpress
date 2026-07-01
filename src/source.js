import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { assertSafeSkillId, isPathInside } from "./providers.js";
import { parseSkillFrontmatter } from "./skill-lint.js";

export const DEFAULT_SOURCE_ROOT = "agent-skills/src";
export const DEFAULT_CONTRACT_ROOT = "agent-skills/contracts";

const SAFE_TOOL_ID = /^[A-Za-z0-9._-]+$/;

function sourceError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, details);
  return error;
}

export function sha256(content) {
  return `sha256:${crypto.createHash("sha256").update(content).digest("hex")}`;
}

export function assertSafeToolId(tool) {
  if (typeof tool !== "string" || !SAFE_TOOL_ID.test(tool) || tool.length > 120) {
    throw sourceError("invalid_tool_id", "tool id must be a safe path segment", { tool });
  }
  return tool;
}

export function resolveSourceRoot({ cwd = process.cwd(), sourceRoot = DEFAULT_SOURCE_ROOT } = {}) {
  return path.resolve(cwd, sourceRoot ?? DEFAULT_SOURCE_ROOT);
}

export function relativeSourcePath(filePath, { cwd = process.cwd() } = {}) {
  return path.relative(path.resolve(cwd), path.resolve(filePath)).split(path.sep).join("/");
}

function validateSafeRelativePath(relativePath) {
  if (relativePath.includes("\0") || path.isAbsolute(relativePath)) {
    return false;
  }
  return !relativePath.split(/[\\/]+/).some((part) => part === "" || part === "..");
}

function walkSkillFiles(skillRoot, { cwd, tool, skill, issues }) {
  const files = [];
  function visit(currentPath) {
    const stat = fs.lstatSync(currentPath);
    const relativePath = path.relative(skillRoot, currentPath).split(path.sep).join("/");
    if (stat.isSymbolicLink()) {
      issues.push({
        code: "canonical_skill_symlink_forbidden",
        severity: "error",
        message: "Canonical skill sources must not contain symlinks",
        tool,
        skill,
        path: currentPath
      });
      return;
    }
    if (relativePath && !validateSafeRelativePath(relativePath)) {
      issues.push({
        code: "canonical_skill_unsafe_path",
        severity: "error",
        message: "Canonical skill source path is unsafe",
        tool,
        skill,
        path: currentPath
      });
      return;
    }
    if (stat.isDirectory()) {
      for (const dirent of fs.readdirSync(currentPath, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        visit(path.join(currentPath, dirent.name));
      }
      return;
    }
    if (!stat.isFile()) {
      issues.push({
        code: "canonical_skill_unsupported_file_type",
        severity: "error",
        message: "Canonical skill sources may contain only regular files and directories",
        tool,
        skill,
        path: currentPath
      });
      return;
    }
    const content = fs.readFileSync(currentPath);
    files.push({
      relative_path: relativePath,
      path: path.resolve(currentPath),
      source_path: relativeSourcePath(currentPath, { cwd }),
      hash: sha256(content),
      bytes: content.length
    });
  }
  visit(skillRoot);
  files.sort((left, right) => left.relative_path.localeCompare(right.relative_path));
  return files;
}

function hashSkillTree(files) {
  const digest = crypto.createHash("sha256");
  for (const file of files) {
    digest.update(file.relative_path);
    digest.update("\0");
    digest.update(file.hash);
    digest.update("\0");
  }
  return `sha256:${digest.digest("hex")}`;
}

function toolFromFrontmatter(frontmatter) {
  return frontmatter.fields.tool ?? frontmatter.fields.metadata_tool ?? null;
}

function readSkillSource(skillRoot, { cwd, tool, skill, layout, issues }) {
  const skillPath = path.join(skillRoot, "SKILL.md");
  const content = fs.readFileSync(skillPath, "utf8");
  const frontmatter = parseSkillFrontmatter(content);
  const files = walkSkillFiles(skillRoot, { cwd, tool, skill, issues });
  const skillFile = files.find((file) => file.relative_path === "SKILL.md");
  const inferredTool = tool ?? toolFromFrontmatter(frontmatter);
  return {
    tool: inferredTool,
    skill,
    root_path: path.resolve(skillRoot),
    path: path.resolve(skillPath),
    source_path: relativeSourcePath(skillPath, { cwd }),
    source_root_path: relativeSourcePath(skillRoot, { cwd }),
    source_layout: layout,
    source_hash: skillFile?.hash ?? sha256(content),
    skill_md_hash: skillFile?.hash ?? sha256(content),
    source_tree_hash: hashSkillTree(files),
    files,
    has_auxiliary_files: files.some((file) => file.relative_path !== "SKILL.md"),
    frontmatter,
    content
  };
}

export function discoverSkillSources(options = {}) {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const configuredRoots = options.sourceRoots?.length
    ? options.sourceRoots
    : [{ path: options.sourceRoot ?? DEFAULT_SOURCE_ROOT, layout: options.sourceLayout ?? "atteway" }];
  let toolFilter = null;
  if (options.tool) {
    try {
      toolFilter = assertSafeToolId(options.tool);
    } catch (error) {
      return {
        root: resolveSourceRoot({ cwd, sourceRoot: configuredRoots[0]?.path ?? DEFAULT_SOURCE_ROOT }),
        roots: configuredRoots.map((entry) => ({
          path: resolveSourceRoot({ cwd, sourceRoot: entry.path }),
          layout: entry.layout ?? "atteway"
        })),
        sources: [],
        issues: [{
          code: error.code,
          severity: "error",
          message: error.message,
          tool: options.tool
        }]
      };
    }
  }

  const sources = [];
  const issues = [];
  const roots = [];

  function scanAttewayRoot(root, layout) {
    const toolNames = fs.readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .filter((tool) => !toolFilter || tool === toolFilter)
      .sort();

    for (const tool of toolNames) {
      try {
        assertSafeToolId(tool);
      } catch (error) {
        issues.push({
          code: error.code,
          severity: "error",
          message: error.message,
          tool
        });
        continue;
      }
      const toolRoot = path.join(root, tool);
      for (const dirent of fs.readdirSync(toolRoot, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        if (!dirent.isDirectory()) {
          continue;
        }
        const skill = dirent.name;
        try {
          assertSafeSkillId(skill);
        } catch (error) {
          issues.push({
            code: error.code,
            severity: "error",
            message: error.message,
            tool,
            skill
          });
          continue;
        }
        const skillRoot = path.join(toolRoot, skill);
        const skillPath = path.join(skillRoot, "SKILL.md");
        if (!fs.existsSync(skillPath)) {
          issues.push({
            code: "canonical_skill_missing",
            severity: "error",
            message: "Canonical skill directory is missing SKILL.md",
            tool,
            skill,
            path: skillPath
          });
          continue;
        }
        sources.push(readSkillSource(skillRoot, { cwd, tool, skill, layout, issues }));
      }
    }

    if (toolFilter && !toolNames.includes(toolFilter)) {
      issues.push({
        code: "canonical_tool_missing",
        severity: "error",
        message: `Canonical tool '${toolFilter}' has no source directory`,
        tool: toolFilter,
        path: path.join(root, toolFilter)
      });
    }
  }

  function scanSkillDirectoryRoot(root, layout) {
    for (const dirent of fs.readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (!dirent.isDirectory()) {
        continue;
      }
      const skill = dirent.name;
      try {
        assertSafeSkillId(skill);
      } catch (error) {
        issues.push({
          code: error.code,
          severity: "error",
          message: error.message,
          skill
        });
        continue;
      }
      const skillRoot = path.join(root, skill);
      const skillPath = path.join(skillRoot, "SKILL.md");
      if (!fs.existsSync(skillPath)) {
        issues.push({
          code: "canonical_skill_missing",
          severity: "error",
          message: "Canonical skill directory is missing SKILL.md",
          skill,
          path: skillPath
        });
        continue;
      }
      const source = readSkillSource(skillRoot, { cwd, tool: null, skill, layout, issues });
      if (toolFilter && source.tool !== toolFilter) {
        continue;
      }
      sources.push(source);
    }
  }

  for (const sourceRoot of configuredRoots) {
    const root = resolveSourceRoot({ cwd, sourceRoot: sourceRoot.path });
    const layout = sourceRoot.layout ?? "atteway";
    roots.push({ path: root, layout });
    if (!isPathInside(root, cwd)) {
      issues.push({
        code: "canonical_source_root_outside_repo",
        severity: "error",
        message: "Canonical skill source root must stay inside the repository",
        path: root
      });
      continue;
    }
    if (!fs.existsSync(root)) {
      issues.push({
        code: "canonical_source_root_missing",
        severity: "warning",
        message: "Canonical skill source root is missing",
        path: root
      });
      continue;
    }
    if (layout === "atteway") {
      scanAttewayRoot(root, layout);
    } else {
      scanSkillDirectoryRoot(root, layout);
    }
  }

  return { root: roots[0]?.path ?? resolveSourceRoot({ cwd }), roots, sources, issues };
}

export function sourceByPath(sources) {
  return new Map(sources.map((source) => [source.source_path, source]));
}

export function sourceBySkill(sources) {
  return new Map(sources.map((source) => [source.skill, source]));
}

/*
 * Legacy code below intentionally removed in favor of layout-aware discovery.
 */
