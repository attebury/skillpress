import fs from "node:fs";
import path from "node:path";
import {
  expandHome,
  isPathInside,
  providerById,
  assertSafeSkillId
} from "./providers.js";

export const MANIFEST_SCHEMA = "skillpress.install-manifest";
export const MANIFEST_VERSION = 2;
export const READABLE_MANIFEST_VERSIONS = Object.freeze([1, 2]);

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

function validateOptionalSafeRelativePath(value, field) {
  if (value === undefined || value === null) {
    return undefined;
  }
  return validateSafeRelativePath(value, field);
}

function validateOptionalSha(value, field) {
  if (value === undefined || value === null) {
    return undefined;
  }
  const raw = requireString(value, field, { max: 80 });
  if (!SHA_RE.test(raw)) {
    throw manifestError("manifest_invalid_sha", `${field} must be a git sha`, { field });
  }
  return raw;
}

function validateOptionalHash(value, field) {
  if (value === undefined || value === null) {
    return undefined;
  }
  const raw = requireString(value, field, { max: 80 });
  if (!HASH_RE.test(raw)) {
    throw manifestError("manifest_invalid_hash", `${field} must be a sha256 content hash`, { field });
  }
  return raw;
}

function normalizeProviderPath(value, providerTarget, { cwd, homeDir, field }) {
  const raw = requireString(value, field, { max: 2048 });
  if (raw.includes("\0")) {
    throw manifestError("manifest_unsafe_path", `${field} must not contain NUL`, { field });
  }
  const expanded = expandHome(raw, homeDir);
  const resolved = path.resolve(cwd, expanded);
  if (!providerTarget.installable || !providerTarget.root) {
    throw manifestError("manifest_provider_layout_unknown", `provider '${providerTarget.id}' has no known install layout`, {
      provider: providerTarget.id
    });
  }
  if (!isPathInside(resolved, providerTarget.root)) {
    throw manifestError("manifest_path_outside_provider_root", `${field} must stay inside provider root`, {
      provider: providerTarget.id,
      [field]: resolved,
      provider_root: providerTarget.root
    });
  }
  return resolved;
}

function normalizeInstalledPath(value, providerTarget, { cwd, homeDir }) {
  const resolved = normalizeProviderPath(value, providerTarget, { cwd, homeDir, field: "installed_path" });
  if (providerTarget.kind === "cursor-rule") {
    if (path.extname(resolved) !== ".mdc") {
      throw manifestError("manifest_invalid_installed_path", "cursor installed_path must point to an .mdc rule", {
        installed_path: resolved
      });
    }
    return resolved;
  }
  if (path.basename(resolved) !== "SKILL.md") {
    throw manifestError("manifest_invalid_installed_path", "installed_path must point to SKILL.md", {
      installed_path: resolved
    });
  }
  return resolved;
}

function normalizeInstalledRoot(value, providerTarget, { cwd, homeDir }) {
  if (value === undefined || value === null) {
    return path.dirname(normalizeInstalledPath(providerTarget.kind === "cursor-rule"
      ? path.join(providerTarget.root, "__placeholder__.mdc")
      : path.join(providerTarget.root, "__placeholder__", "SKILL.md"), providerTarget, { cwd, homeDir }));
  }
  return normalizeProviderPath(value, providerTarget, { cwd, homeDir, field: "installed_root" });
}

function validateFiles(value) {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw manifestError("manifest_invalid_files", "files must be an array of relative paths");
  }
  return value.map((entry) => validateSafeRelativePath(entry, "files[]"));
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
  const sourcePath = validateOptionalSafeRelativePath(entry.source_path, "source_path");
  const sourceRootPath = validateOptionalSafeRelativePath(entry.source_root_path, "source_root_path");
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
  const skillMdHash = validateOptionalHash(entry.skill_md_hash, "skill_md_hash");
  const sourceTreeHash = validateOptionalHash(entry.source_tree_hash, "source_tree_hash");
  if (!sourceCommit && !sourceSha && !sourceHash && !skillMdHash && !sourceTreeHash) {
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
  const installedRoot = entry.installed_root === undefined || entry.installed_root === null
    ? path.dirname(installedPath)
    : normalizeInstalledRoot(entry.installed_root, providerTarget, { cwd, homeDir });
  const files = validateFiles(entry.files);

  return {
    skill,
    provider,
    source_path: sourcePath ?? null,
    source_root_path: sourceRootPath ?? null,
    source_repo: sourceRepo ?? null,
    source_commit: sourceCommit ?? null,
    source_sha: sourceSha ?? null,
    source_hash: sourceHash ?? null,
    skill_md_hash: skillMdHash ?? null,
    source_tree_hash: sourceTreeHash ?? null,
    source_layout: entry.source_layout === undefined || entry.source_layout === null ? null : requireString(entry.source_layout, "source_layout", { max: 80 }),
    installed_path: installedPath,
    installed_root: installedRoot,
    files,
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
  if (!READABLE_MANIFEST_VERSIONS.includes(document.version)) {
    throw manifestError("manifest_version_unsupported", `manifest version must be one of ${READABLE_MANIFEST_VERSIONS.join(", ")}`, {
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
    version: document.version,
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

export function manifestPath({ cwd = process.cwd(), manifestPath: requestedPath = null, homeDir = process.env.HOME ?? "." } = {}) {
  return path.resolve(path.resolve(cwd), expandHome(requestedPath ?? "skillpress.manifest.json", homeDir));
}

export function emptyManifest() {
  return {
    schema: MANIFEST_SCHEMA,
    version: MANIFEST_VERSION,
    entries: []
  };
}

export function readManifestDocument(manifestFile, context = {}) {
  const resolvedPath = manifestPath({
    cwd: context.cwd,
    homeDir: context.homeDir,
    manifestPath: manifestFile
  });
  if (!fs.existsSync(resolvedPath)) {
    return {
      path: resolvedPath,
      document: emptyManifest(),
      manifest: validateManifest(emptyManifest(), context),
      existed: false
    };
  }
  const document = JSON.parse(fs.readFileSync(resolvedPath, "utf8"));
  return {
    path: resolvedPath,
    document,
    manifest: validateManifest(document, context),
    existed: true
  };
}

export function writeManifestDocument(manifestFile, document, context = {}) {
  const resolvedPath = manifestPath({
    cwd: context.cwd,
    homeDir: context.homeDir,
    manifestPath: manifestFile
  });
  validateManifest(document, context);
  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
  const tmp = path.join(path.dirname(resolvedPath), `.${path.basename(resolvedPath)}.${process.pid}.tmp`);
  fs.writeFileSync(tmp, `${JSON.stringify(document, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, resolvedPath);
  return resolvedPath;
}
