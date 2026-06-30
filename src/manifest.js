import fs from "node:fs";
import path from "node:path";
import {
  expandHome,
  isPathInside,
  providerById,
  assertSafeSkillId
} from "./providers.js";

export const MANIFEST_SCHEMA = "skillpress.install-manifest";
export const MANIFEST_VERSION = 1;

const SAFE_SOURCE_REPO = /^[A-Za-z0-9._/-]+$/;
const SAFE_VERSION = /^[A-Za-z0-9._:+-]+$/;
const SHA_RE = /^[a-f0-9]{7,64}$/i;
const HASH_RE = /^sha256:[a-f0-9]{64}$/i;

function manifestError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, details);
  return error;
}

function requireString(value, field, { max = 512 } = {}) {
  if (typeof value !== "string" || value.length === 0 || value.length > max) {
    throw manifestError("manifest_invalid_field", `${field} must be a non-empty string`, { field });
  }
  return value;
}

function validateSafeRelativePath(value, field) {
  const raw = requireString(value, field);
  if (path.isAbsolute(raw) || raw.includes("\0")) {
    throw manifestError("manifest_unsafe_path", `${field} must be a relative path`, { field, path: raw });
  }
  const parts = raw.split(/[\\/]+/);
  if (parts.some((part) => part === ".." || part === "")) {
    throw manifestError("manifest_unsafe_path", `${field} must not contain empty or parent segments`, { field, path: raw });
  }
  return raw;
}

function validateOptionalSha(value, field) {
  if (value === undefined) {
    return undefined;
  }
  const raw = requireString(value, field, { max: 80 });
  if (!SHA_RE.test(raw)) {
    throw manifestError("manifest_invalid_sha", `${field} must be a git sha`, { field });
  }
  return raw;
}

function validateOptionalHash(value, field) {
  if (value === undefined) {
    return undefined;
  }
  const raw = requireString(value, field, { max: 80 });
  if (!HASH_RE.test(raw)) {
    throw manifestError("manifest_invalid_hash", `${field} must be a sha256 content hash`, { field });
  }
  return raw;
}

function normalizeInstalledPath(value, providerTarget, { cwd, homeDir }) {
  const raw = requireString(value, "installed_path", { max: 2048 });
  if (raw.includes("\0")) {
    throw manifestError("manifest_unsafe_path", "installed_path must not contain NUL", { field: "installed_path" });
  }
  const expanded = expandHome(raw, homeDir);
  const resolved = path.resolve(cwd, expanded);
  if (!providerTarget.installable || !providerTarget.root) {
    throw manifestError("manifest_provider_layout_unknown", `provider '${providerTarget.id}' has no known install layout`, {
      provider: providerTarget.id
    });
  }
  if (!isPathInside(resolved, providerTarget.root)) {
    throw manifestError("manifest_path_outside_provider_root", "installed_path must stay inside provider root", {
      provider: providerTarget.id,
      installed_path: resolved,
      provider_root: providerTarget.root
    });
  }
  if (path.basename(resolved) !== "SKILL.md") {
    throw manifestError("manifest_invalid_installed_path", "installed_path must point to SKILL.md", {
      installed_path: resolved
    });
  }
  return resolved;
}

export function validateManifestEntry(entry, context = {}) {
  const cwd = path.resolve(context.cwd ?? process.cwd());
  const homeDir = path.resolve(context.homeDir ?? process.env.HOME ?? ".");
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    throw manifestError("manifest_invalid_entry", "manifest entries must be objects");
  }
  const skill = assertSafeSkillId(requireString(entry.skill, "skill", { max: 120 }));
  const provider = requireString(entry.provider, "provider", { max: 80 });
  const providerTarget = providerById(provider, { cwd, homeDir });
  const sourcePath = entry.source_path === undefined
    ? undefined
    : validateSafeRelativePath(entry.source_path, "source_path");
  const sourceRepo = entry.source_repo === undefined
    ? undefined
    : requireString(entry.source_repo, "source_repo", { max: 256 });
  if (sourceRepo !== undefined && (!SAFE_SOURCE_REPO.test(sourceRepo) || sourceRepo.includes(".."))) {
    throw manifestError("manifest_invalid_source_repo", "source_repo must be a safe repository identifier", {
      source_repo: sourceRepo
    });
  }
  if (!sourcePath && !sourceRepo) {
    throw manifestError("manifest_source_missing", "entry must include source_path or source_repo", { skill, provider });
  }

  const sourceCommit = validateOptionalSha(entry.source_commit, "source_commit");
  const sourceSha = validateOptionalSha(entry.source_sha, "source_sha");
  const sourceHash = validateOptionalHash(entry.source_hash, "source_hash");
  if (!sourceCommit && !sourceSha && !sourceHash) {
    throw manifestError("manifest_source_revision_missing", "entry must include source_commit, source_sha, or source_hash", {
      skill,
      provider
    });
  }
  const version = entry.version === undefined ? null : requireString(entry.version, "version", { max: 120 });
  if (version !== null && !SAFE_VERSION.test(version)) {
    throw manifestError("manifest_invalid_version", "version contains unsafe characters", { version });
  }

  const installedPath = normalizeInstalledPath(entry.installed_path, providerTarget, { cwd, homeDir });

  return {
    skill,
    provider,
    source_path: sourcePath ?? null,
    source_repo: sourceRepo ?? null,
    source_commit: sourceCommit ?? null,
    source_sha: sourceSha ?? null,
    source_hash: sourceHash ?? null,
    installed_path: installedPath,
    version,
    target: entry.target === undefined ? provider : requireString(entry.target, "target", { max: 80 })
  };
}

export function validateManifest(document, context = {}) {
  if (!document || typeof document !== "object" || Array.isArray(document)) {
    throw manifestError("manifest_invalid", "manifest must be a JSON object");
  }
  if (document.schema !== MANIFEST_SCHEMA) {
    throw manifestError("manifest_schema_mismatch", `manifest schema must be '${MANIFEST_SCHEMA}'`, {
      schema: document.schema
    });
  }
  if (document.version !== MANIFEST_VERSION) {
    throw manifestError("manifest_version_unsupported", `manifest version must be ${MANIFEST_VERSION}`, {
      version: document.version
    });
  }
  if (!Array.isArray(document.entries)) {
    throw manifestError("manifest_entries_invalid", "manifest entries must be an array");
  }
  const entries = document.entries.map((entry) => validateManifestEntry(entry, context));
  const byInstalledPath = new Set();
  for (const entry of entries) {
    const key = entry.installed_path;
    if (byInstalledPath.has(key)) {
      throw manifestError("manifest_duplicate_installed_path", "installed_path must be unique", {
        installed_path: key
      });
    }
    byInstalledPath.add(key);
  }
  return {
    schema: MANIFEST_SCHEMA,
    version: MANIFEST_VERSION,
    entries
  };
}

export function readManifest(manifestPath, context = {}) {
  const cwd = path.resolve(context.cwd ?? process.cwd());
  const homeDir = path.resolve(context.homeDir ?? process.env.HOME ?? ".");
  const resolvedPath = path.resolve(cwd, expandHome(manifestPath, homeDir));
  const raw = fs.readFileSync(resolvedPath, "utf8");
  return {
    path: resolvedPath,
    manifest: validateManifest(JSON.parse(raw), { cwd, homeDir })
  };
}
