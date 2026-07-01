import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { assertSafeSkillId, isPathInside } from "./providers.js";

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

function readSkillSource(skillPath, { cwd, tool, skill }) {
  const content = fs.readFileSync(skillPath, "utf8");
  return {
    tool,
    skill,
    path: path.resolve(skillPath),
    source_path: relativeSourcePath(skillPath, { cwd }),
    source_hash: sha256(content),
    content
  };
}

export function discoverSkillSources(options = {}) {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const root = resolveSourceRoot({ cwd, sourceRoot: options.sourceRoot });
  let toolFilter = null;
  if (options.tool) {
    try {
      toolFilter = assertSafeToolId(options.tool);
    } catch (error) {
      return {
        root,
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
  if (!isPathInside(root, cwd)) {
    return {
      root,
      sources: [],
      issues: [{
        code: "canonical_source_root_outside_repo",
        severity: "error",
        message: "Canonical skill source root must stay inside the repository",
        path: root
      }]
    };
  }
  if (!fs.existsSync(root)) {
    return {
      root,
      sources: [],
      issues: [{
        code: "canonical_source_root_missing",
        severity: "warning",
        message: "Canonical skill source root is missing",
        path: root
      }]
    };
  }

  const sources = [];
  const issues = [];
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
      const skillPath = path.join(toolRoot, skill, "SKILL.md");
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
      sources.push(readSkillSource(skillPath, { cwd, tool, skill }));
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

  return { root, sources, issues };
}

export function sourceByPath(sources) {
  return new Map(sources.map((source) => [source.source_path, source]));
}
