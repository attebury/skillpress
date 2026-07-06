import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const defaultPackageJsonPath = path.join(repoRoot, "package.json");
const SAFE_PACKAGE_NAME = /^[a-z0-9][a-z0-9._-]{0,213}$/;
const SAFE_VERSION = /^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?$/;

function versionError(code, message) {
  return {
    ok: false,
    type: "skillpress.version_error.v1",
    schema_version: 1,
    tool: "skillpress",
    code,
    message
  };
}

function readPackageMetadata(packageJsonPath) {
  let raw;
  try {
    raw = fs.readFileSync(packageJsonPath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      return versionError("version_metadata_missing", "Package metadata is missing.");
    }
    return versionError("version_metadata_invalid", "Package metadata could not be read.");
  }

  let pkg;
  try {
    pkg = JSON.parse(raw);
  } catch {
    return versionError("version_metadata_invalid", "Package metadata is not valid JSON.");
  }

  if (!pkg || typeof pkg !== "object") {
    return versionError("version_metadata_invalid", "Package metadata must be an object.");
  }
  if (typeof pkg.name !== "string" || !SAFE_PACKAGE_NAME.test(pkg.name)) {
    return versionError("version_metadata_invalid", "Package metadata has an invalid package name.");
  }
  if (typeof pkg.version !== "string" || !SAFE_VERSION.test(pkg.version)) {
    return versionError("version_metadata_invalid", "Package metadata has an invalid version.");
  }

  return {
    ok: true,
    package_name: pkg.name,
    version: pkg.version
  };
}

export function versionPacket({
  packageJsonPath = defaultPackageJsonPath,
  nodeVersion = process.version
} = {}) {
  const metadata = readPackageMetadata(packageJsonPath);
  if (!metadata.ok) {
    return metadata;
  }

  return {
    ok: true,
    type: "skillpress.version.v1",
    schema_version: 1,
    tool: "skillpress",
    package_name: metadata.package_name,
    version: metadata.version,
    source: "package.json",
    node_version: nodeVersion
  };
}

export function versionText(options = {}) {
  const packet = versionPacket(options);
  if (!packet.ok) {
    return packet;
  }
  return {
    ok: true,
    text: `${packet.tool} ${packet.version}`
  };
}
