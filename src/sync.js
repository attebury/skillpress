import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { MANIFEST_SCHEMA, MANIFEST_VERSION, readManifestDocument, writeManifestDocument } from "./manifest.js";
import { installedEntrypointPath, installedSkillRoot, providerById, resolveProviderSelection } from "./providers.js";
import { discoverSkillSources } from "./source.js";
import { renderEntrypoint, renderSingleInstructions } from "./render.js";
import { loadCommandContracts } from "./contracts.js";
import { lintSkillContent } from "./skill-lint.js";
import { parseGeneratedHeader } from "./skill-lint.js";
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

function sha256(content) {
  return `sha256:${crypto.createHash("sha256").update(content).digest("hex")}`;
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

function sourceCommit(cwd) {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
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

function unmanagedEntrypointIssue({ filePath, manifestEntries, provider, skill }) {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  const hasManifestEntry = manifestEntries.some((entry) => entry.provider === provider.id && entry.installed_path === filePath);
  if (hasManifestEntry) {
    return null;
  }
  const content = fs.readFileSync(filePath, "utf8");
  if (parseGeneratedHeader(content).present) {
    return null;
  }
  return syncIssue("installed_skill_unmanaged", "error", "Refusing to overwrite unmanaged provider instruction file", {
    skill,
    provider: provider.id,
    path: filePath
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
  const providerSelection = resolveProviderSelection({
    providers: runtimeConfig.config.providers,
    cwd,
    homeDir,
    command: "sync"
  });
  const providers = providerSelection.providers;
  const syncableProviders = providers.filter((provider) => provider.syncable);
  const manifestProviderTargets = providerTargetsForManifest(runtimeConfig, providerSelection, { cwd, homeDir });
  const issues = [...runtimeConfig.issues, ...providerSelection.issues, ...sourceState.issues, ...contractState.issues];

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
      for (const provider of syncableProviders.filter((entry) => entry.kind !== "single-instructions-file")) {
        const installedRoot = installedSkillRoot(provider, source.skill);
        const installedPath = installedEntrypointPath(provider, source.skill);
        const entrypointContent = renderEntrypoint({ source, providerTarget: provider, generatedAt });
        const files = [];
        if (provider.kind === "rule-directory") {
          files.push({
            relative_path: path.basename(installedPath),
            installed_path: installedPath,
            content: entrypointContent,
            bytes: Buffer.byteLength(entrypointContent, "utf8")
          });
          if (source.has_auxiliary_files) {
            issues.push(syncIssue("provider_auxiliary_files_omitted", "warning", "Rule-render providers cannot consume auxiliary Agent Skills files directly", {
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
          target: provider.id,
          surface_id: provider.surface_id,
          surface_kind: provider.surface_kind,
          fidelity: provider.fidelity,
          provider_detected: provider.detected,
          auxiliary_files_omitted: provider.supports_auxiliary_files === false && source.has_auxiliary_files
        });
      }
    }
    for (const provider of syncableProviders.filter((entry) => entry.kind === "single-instructions-file")) {
      const summary = combinedSourceSummary(sourceState.sources);
      const installedRoot = installedSkillRoot(provider, provider.single_skill_id);
      const installedPath = installedEntrypointPath(provider, provider.single_skill_id);
      const content = renderSingleInstructions({
        sources: sourceState.sources,
        providerTarget: provider,
        generatedAt,
        sourceSummary: summary
      });
      const relativePath = path.basename(installedPath);
      writes.push({
        tool: options.tool ?? null,
        skill: provider.single_skill_id,
        provider: provider.id,
        source_path: ".",
        source_hash: summary.source_hash,
        skill_md_hash: summary.skill_md_hash,
        source_tree_hash: summary.source_tree_hash,
        installed_root: installedRoot,
        installed_path: installedPath,
        bytes: Buffer.byteLength(content, "utf8"),
        files: [{
          relative_path: relativePath,
          installed_path: installedPath,
          content,
          bytes: Buffer.byteLength(content, "utf8")
        }]
      });
      if (sourceState.sources.some((source) => source.has_auxiliary_files)) {
        issues.push(syncIssue("provider_auxiliary_files_omitted", "warning", "Single-file instruction providers cannot consume auxiliary Agent Skills files directly", {
          skill: provider.single_skill_id,
          tool: options.tool ?? null,
          provider: provider.id
        }));
      }
      newManifestEntries.push({
        skill: provider.single_skill_id,
        provider: provider.id,
        source_path: ".",
        source_root_path: sourceState.roots[0]?.source_path ?? ".",
        source_hash: summary.source_hash,
        skill_md_hash: summary.skill_md_hash,
        source_tree_hash: summary.source_tree_hash,
        source_layout: "generated",
        source_commit: commit,
        installed_path: manifestInstalledPath(provider, installedPath, { cwd, homeDir }),
        installed_root: manifestInstalledPath(provider, installedRoot, { cwd, homeDir }),
        files: [relativePath],
        target: provider.id,
        surface_id: provider.surface_id,
        surface_kind: provider.surface_kind,
        fidelity: provider.fidelity,
        provider_detected: provider.detected,
        auxiliary_files_omitted: sourceState.sources.some((source) => source.has_auxiliary_files)
      });
    }
  }

  let manifestPath = null;
  let manifestLocation = null;
  if (!issues.some((entry) => entry.severity === "error")) {
    const manifestState = readManifestDocument(options.manifestPath, {
      cwd,
      homeDir,
      configManifestPath,
      providerTargets: manifestProviderTargets
    });
    manifestPath = manifestState.path;
    manifestLocation = manifestState.location;
    if (!manifestState.location.explicit && manifestState.location.legacy_default_present) {
      issues.push(syncIssue("legacy_install_manifest_ignored", "warning", "Legacy root install manifest ignored; pass --manifest skillpress.manifest.json to inspect or migrate it explicitly", {
        path: manifestState.location.legacy_default_path
      }));
    }
    const existingEntries = manifestState.manifest.entries.map((entry) => {
      const target = manifestProviderTargets.get(entry.provider) ?? providerById(entry.provider, { cwd, homeDir });
      return {
        ...entry,
        installed_path: manifestInstalledPath(target, entry.installed_path, { cwd, homeDir }),
        installed_root: manifestInstalledPath(target, entry.installed_root, { cwd, homeDir })
      };
    });
    for (const write of writes) {
      const provider = manifestProviderTargets.get(write.provider) ?? providerById(write.provider, { cwd, homeDir });
      if (provider.kind === "rule-directory" || provider.kind === "single-instructions-file") {
        const unmanaged = unmanagedEntrypointIssue({
          filePath: write.installed_path,
          manifestEntries: manifestState.manifest.entries,
          provider,
          skill: write.skill
        });
        if (unmanaged) {
          issues.push(unmanaged);
        }
      }
    }
    const document = {
      schema: MANIFEST_SCHEMA,
      version: MANIFEST_VERSION,
      entries: mergeManifestEntries(existingEntries, newManifestEntries)
    };
    if (!dryRun && !issues.some((entry) => entry.severity === "error")) {
      for (const write of writes) {
        for (const file of write.files) {
          atomicWriteFile(file.installed_path, file.content);
        }
      }
      writeManifestDocument(options.manifestPath, document, {
        cwd,
        homeDir,
        configManifestPath,
        providerTargets: manifestProviderTargets
      });
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
    providers: providers.map((provider) => ({
      id: provider.id,
      title: provider.title,
      surface_kind: provider.surface_kind,
      surface_id: provider.surface_id,
      fidelity: provider.fidelity,
      root: provider.root,
      configured: provider.configured,
      detected: provider.detected,
      syncable: provider.syncable,
      required: provider.required,
      explicit: provider.explicit,
      reason: provider.unavailable_reason
    })),
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
      provider_count: syncableProviders.length,
      write_count: writes.length,
      error_count: errorCount
    }
  };
}
