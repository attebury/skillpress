import fs from "node:fs";
import path from "node:path";
import { MANIFEST_SCHEMA, MANIFEST_VERSION, readManifestDocument, writeManifestDocument } from "./manifest.js";
import { installedSkillPath, providerById, providerTargets } from "./providers.js";
import { discoverSkillSources } from "./source.js";
import { renderSkill } from "./render.js";
import { loadCommandContracts } from "./contracts.js";
import { lintSkillContent } from "./skill-lint.js";

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

function selectProviders({ provider, cwd, homeDir }) {
  if (provider) {
    return [providerById(provider, { cwd, homeDir })];
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
  const sourceState = discoverSkillSources({
    cwd,
    sourceRoot: options.sourceRoot,
    tool: options.tool
  });
  const contractState = loadCommandContracts({
    cwd,
    contractRoot: options.contractRoot
  });
  const providers = selectProviders({ provider: options.provider, cwd, homeDir });
  const issues = [...sourceState.issues, ...contractState.issues];

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
      contracts: contractState.contracts
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
    for (const source of sourceState.sources) {
      for (const provider of providers) {
        const installedPath = installedSkillPath(provider, source.skill);
        const content = renderSkill({ source, provider: provider.id, generatedAt });
        writes.push({
          tool: source.tool,
          skill: source.skill,
          provider: provider.id,
          source_path: source.source_path,
          source_hash: source.source_hash,
          installed_path: installedPath,
          bytes: Buffer.byteLength(content, "utf8"),
          content
        });
        newManifestEntries.push({
          skill: source.skill,
          provider: provider.id,
          source_path: source.source_path,
          source_hash: source.source_hash,
          installed_path: manifestInstalledPath(provider, installedPath, { cwd, homeDir }),
          target: provider.id
        });
      }
    }
  }

  let manifestPath = null;
  if (!issues.some((entry) => entry.severity === "error")) {
    const manifestState = readManifestDocument(options.manifestPath, { cwd, homeDir });
    manifestPath = manifestState.path;
    const document = {
      schema: MANIFEST_SCHEMA,
      version: MANIFEST_VERSION,
      entries: mergeManifestEntries(manifestState.document.entries ?? [], newManifestEntries)
    };
    if (!dryRun) {
      for (const write of writes) {
        atomicWriteFile(write.installed_path, write.content);
      }
      writeManifestDocument(options.manifestPath, document, { cwd, homeDir });
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
    command_contract_root: contractState.root,
    manifest: {
      path: manifestPath,
      updated: errorCount === 0 && !dryRun,
      entry_count: newManifestEntries.length
    },
    filters: {
      provider: options.provider ?? null,
      tool: options.tool ?? null
    },
    writes: writes.map(({ content, ...write }) => ({
      ...write,
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
