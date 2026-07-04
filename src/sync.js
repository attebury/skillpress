import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { MANIFEST_SCHEMA, MANIFEST_VERSION, readManifestDocument, writeManifestDocument } from "./manifest.js";
import { installedEntrypointPath, installedSkillRoot, providerById, providerTargets } from "./providers.js";
import { discoverSkillSources } from "./source.js";
import { renderEntrypoint } from "./render.js";
import { loadCommandContracts } from "./contracts.js";
import { lintSkillContent } from "./skill-lint.js";
import { resolveRuntimeConfig } from "./config.js";

function syncIssue(code, severity, message, details = {}) {
  return { code, severity, message, ...details };
}

function atomicWriteFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.tmp`);
  fs.writeFileSync(tmp, content, { mode: 0o644 });
  fs.renameSync(tmp, filePath);
}

function manifestInstalledPath(providerTarget, installedPath, { cwd, homeDir }) {
  if (providerTarget.root_scope === "home") {
    const relative = path.relative(homeDir, installedPath).split(path.sep).join("/");
    return `~/${relative}`;
  }
  if (providerTarget.root_scope === "workspace") {
    return path.relative(cwd, installedPath).split(path.sep).join("/");
  }
  return installedPath;
}

function sourceCommit(cwd) {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

function selectProviders({ provider, providers: configuredProviders, cwd, homeDir }) {
  if (provider) {
    return [providerById(provider, { cwd, homeDir })];
  }
  if (configuredProviders?.length) {
    return configuredProviders.map((entry) => providerById(entry, { cwd, homeDir }));
  }
  return providerTargets({ cwd, homeDir }).filter((target) => target.installable);
}

function mergeManifestEntries(existingEntries, newEntries) {
  const replacements = new Map(newEntries.map((entry) => [`${entry.provider}\0${entry.skill}`, entry]));
  const kept = existingEntries.filter((entry) => !replacements.has(`${entry.provider}\0${entry.skill}`));
  return [...kept, ...newEntries].sort((a, b) => {
    const left = `${a.provider}/${a.skill}`;
    const right = `${b.provider}/${b.skill}`;
    return left.localeCompare(right);
  });
}

export function syncPacket(options = {}) {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const homeDir = path.resolve(options.homeDir ?? process.env.HOME ?? ".");
  const dryRun = options.dryRun === true;
  const generatedAt = options.generatedAt ?? new Date().toISOString();
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
  const sourceState = discoverSkillSources({
    cwd,
    sourceRoots: runtimeConfig.config.source_roots,
    tool: options.tool
  });
  const contractState = loadCommandContracts({
    cwd,
    contractRoot: runtimeConfig.config.contract_root
  });
  const providers = selectProviders({
    provider: options.provider,
    providers: runtimeConfig.config.providers,
    cwd,
    homeDir
  });
  const issues = [...runtimeConfig.issues, ...sourceState.issues, ...contractState.issues];

  for (const provider of providers) {
    if (!provider.installable) {
      issues.push(syncIssue("provider_layout_unknown", "error", `provider '${provider.id}' has no installable skill root`, {
        provider: provider.id
      }));
    }
  }

  if (sourceState.sources.length === 0 && !sourceState.issues.some((issue) => issue.severity === "error")) {
    issues.push(syncIssue("canonical_source_missing", "error", "No canonical skills matched the sync request", {
      tool: options.tool ?? null,
      source_root: sourceState.root
    }));
  }

  for (const source of sourceState.sources) {
    const findings = lintSkillContent(source.content, {
      skill: source.skill,
      tool: source.tool,
      path: source.path,
      contracts: contractState.contracts,
      policyPacks: runtimeConfig.config.policy_packs,
      source
    });
    for (const finding of findings) {
      issues.push(syncIssue(finding.code, finding.severity, finding.message, {
        skill: source.skill,
        tool: finding.tool ?? source.tool,
        path: source.path,
        command: finding.command ?? null
      }));
    }
  }

  const writes = [];
  const newManifestEntries = [];
  if (!issues.some((entry) => entry.severity === "error")) {
    const commit = sourceCommit(cwd);
    for (const source of sourceState.sources) {
      for (const provider of providers) {
        const installedRoot = installedSkillRoot(provider, source.skill);
        const installedPath = installedEntrypointPath(provider, source.skill);
        const entrypointContent = renderEntrypoint({ source, providerTarget: provider, generatedAt });
        const files = [];
        if (provider.kind === "cursor-rule") {
          files.push({
            relative_path: `${source.skill}.mdc`,
            installed_path: installedPath,
            content: entrypointContent,
            bytes: Buffer.byteLength(entrypointContent, "utf8")
          });
          if (source.has_auxiliary_files) {
            issues.push(syncIssue("cursor_auxiliary_files_ignored", "warning", "Cursor rules cannot consume auxiliary Agent Skills files directly", {
              skill: source.skill,
              tool: source.tool,
              provider: provider.id
            }));
          }
        } else {
          for (const file of source.files) {
            const content = file.relative_path === "SKILL.md"
              ? entrypointContent
              : fs.readFileSync(file.path);
            files.push({
              relative_path: file.relative_path,
              installed_path: path.join(installedRoot, file.relative_path),
              content,
              bytes: Buffer.isBuffer(content) ? content.length : Buffer.byteLength(content, "utf8")
            });
          }
        }
        const write = {
          tool: source.tool,
          skill: source.skill,
          provider: provider.id,
          source_path: source.source_path,
          source_hash: source.source_hash,
          skill_md_hash: source.skill_md_hash,
          source_tree_hash: source.source_tree_hash,
          installed_root: installedRoot,
          installed_path: installedPath,
          bytes: files.reduce((total, file) => total + file.bytes, 0),
          files
        };
        writes.push(write);
        newManifestEntries.push({
          skill: source.skill,
          provider: provider.id,
          source_path: source.source_path,
          source_root_path: source.source_root_path,
          source_hash: source.source_hash,
          skill_md_hash: source.skill_md_hash,
          source_tree_hash: source.source_tree_hash,
          source_layout: source.source_layout,
          source_commit: commit,
          installed_path: manifestInstalledPath(provider, installedPath, { cwd, homeDir }),
          installed_root: manifestInstalledPath(provider, installedRoot, { cwd, homeDir }),
          files: files.map((file) => file.relative_path),
          target: provider.id
        });
      }
    }
  }

  let manifestPath = null;
  let manifestLocation = null;
  if (!issues.some((entry) => entry.severity === "error")) {
    const manifestState = readManifestDocument(options.manifestPath, { cwd, homeDir, configManifestPath });
    manifestPath = manifestState.path;
    manifestLocation = manifestState.location;
    if (!manifestState.location.explicit && manifestState.location.legacy_default_present) {
      issues.push(syncIssue("legacy_install_manifest_ignored", "warning", "Legacy root install manifest ignored; pass --manifest skillpress.manifest.json to inspect or migrate it explicitly", {
        path: manifestState.location.legacy_default_path
      }));
    }
    const existingEntries = manifestState.manifest.entries.map((entry) => {
      const target = providerById(entry.provider, { cwd, homeDir });
      return {
        ...entry,
        installed_path: manifestInstalledPath(target, entry.installed_path, { cwd, homeDir }),
        installed_root: manifestInstalledPath(target, entry.installed_root, { cwd, homeDir })
      };
    });
    const document = {
      schema: MANIFEST_SCHEMA,
      version: MANIFEST_VERSION,
      entries: mergeManifestEntries(existingEntries, newManifestEntries)
    };
    if (!dryRun) {
      for (const write of writes) {
        for (const file of write.files) {
          atomicWriteFile(file.installed_path, file.content);
        }
      }
      writeManifestDocument(options.manifestPath, document, { cwd, homeDir, configManifestPath });
    }
  }

  const errorCount = issues.filter((entry) => entry.severity === "error").length;
  return {
    ok: errorCount === 0,
    type: "skillpress_sync",
    schema_version: 1,
    status: errorCount > 0 ? "fail" : "synced",
    dry_run: dryRun,
    source_root: sourceState.root,
    source_roots: sourceState.roots,
    command_contract_root: contractState.root,
    config: {
      path: runtimeConfig.path,
      present: runtimeConfig.present,
      policy_packs: runtimeConfig.config.policy_packs
    },
    manifest: {
      path: manifestPath,
      mode: manifestLocation?.mode ?? null,
      explicit: manifestLocation?.explicit ?? false,
      legacy_default_path: manifestLocation?.legacy_default_path ?? null,
      legacy_default_present: manifestLocation?.legacy_default_present ?? false,
      updated: errorCount === 0 && !dryRun,
      entry_count: newManifestEntries.length
    },
    filters: {
      provider: options.provider ?? null,
      tool: options.tool ?? null
    },
    writes: writes.map((write) => ({
      ...write,
      files: write.files.map(({ content, ...file }) => ({
        ...file,
        written: errorCount === 0 && !dryRun
      })),
      written: errorCount === 0 && !dryRun
    })),
    issues,
    summary: {
      source_count: sourceState.sources.length,
      provider_count: providers.length,
      write_count: writes.length,
      error_count: errorCount
    }
  };
}
