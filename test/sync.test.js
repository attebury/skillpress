import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { syncPacket } from "../src/sync.js";
import { statusPacket } from "../src/status.js";

const GENERATED_AT = "2026-07-01T00:00:00.000Z";

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "skillpress-sync-"));
  const cwd = path.join(root, "repo");
  const homeDir = path.join(root, "home");
  fs.mkdirSync(cwd, { recursive: true });
  fs.mkdirSync(homeDir, { recursive: true });
  return { root, cwd, homeDir };
}

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function detectProviders(fx, providers = ["codex", "claude-code"]) {
  for (const provider of providers) {
    if (provider === "codex") {
      fs.mkdirSync(path.join(fx.homeDir, ".codex"), { recursive: true });
    }
    if (provider === "claude-code") {
      fs.mkdirSync(path.join(fx.homeDir, ".claude"), { recursive: true });
    }
    if (provider === "github-copilot") {
      fs.mkdirSync(path.join(fx.homeDir, ".copilot"), { recursive: true });
    }
    if (provider === "cline") {
      fs.mkdirSync(path.join(fx.homeDir, ".cline"), { recursive: true });
    }
    if (provider === "roo") {
      fs.mkdirSync(path.join(fx.homeDir, ".roo"), { recursive: true });
    }
  }
}

function skillMarkdown(name = "runlane-consumer", description = "Use Runlane facts.") {
  return [
    "---",
    `name: ${name}`,
    `description: ${description}`,
    "---",
    "",
    `# ${name}`,
    "",
    "```bash",
    "runlane status --json",
    "runlane verify build --json",
    "```",
    ""
  ].join("\n");
}

function sourcePath(fx, tool = "runlane", skill = "runlane-consumer") {
  return path.join(fx.cwd, "agent-skills", "src", tool, skill, "SKILL.md");
}

function readManifest(packet) {
  return JSON.parse(fs.readFileSync(packet.manifest.path, "utf8"));
}

function git(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

test("sync renders canonical skills into installable provider roots and updates manifest", () => {
  const fx = fixture();
  detectProviders(fx);
  writeFile(sourcePath(fx), skillMarkdown());

  const packet = syncPacket({ cwd: fx.cwd, homeDir: fx.homeDir, tool: "runlane", generatedAt: GENERATED_AT });

  assert.equal(packet.ok, true);
  assert.equal(packet.manifest.mode, "xdg-state");
  assert.equal(packet.manifest.explicit, false);
  assert.equal(fs.existsSync(path.join(fx.cwd, "skillpress.manifest.json")), false);
  assert.ok(packet.manifest.path.startsWith(path.join(fx.homeDir, ".local", "state", "skillpress")));
  assert.equal(packet.summary.write_count, 4);
  assert.deepEqual(packet.writes.map((entry) => entry.provider).sort(), ["agents", "claude-code", "codex", "cursor"]);
  for (const write of packet.writes) {
    assert.equal(write.written, true);
    assert.equal(fs.existsSync(write.installed_path), true);
    const content = fs.readFileSync(write.installed_path, "utf8");
    assert.match(content, /<!-- skillpress/);
    assert.match(content, new RegExp(`target: ${write.provider}`));
    assert.match(content, /source_path: agent-skills\/src\/runlane\/runlane-consumer\/SKILL.md/);
    assert.match(content, /source_tree_hash: sha256:/);
  }

  const manifest = readManifest(packet);
  assert.equal(manifest.version, 2);
  assert.equal(manifest.entries.length, 4);
  assert.ok(manifest.entries.some((entry) => entry.provider === "codex" && entry.installed_path.startsWith("~/")));
  assert.ok(manifest.entries.some((entry) => entry.provider === "claude-code" && entry.installed_path.startsWith("~/")));
  assert.ok(manifest.entries.some((entry) => entry.provider === "cursor" && entry.installed_path === ".cursor/rules/skillpress/runlane-consumer.mdc"));
  assert.ok(manifest.entries.every((entry) => entry.source_layout === "tool-scoped"));
  assert.ok(manifest.entries.every((entry) => entry.source_tree_hash?.startsWith("sha256:")));

  const status = statusPacket({ cwd: fx.cwd, homeDir: fx.homeDir });
  assert.equal(status.ok, true);
  assert.equal(status.status, "pass");
  assert.equal(status.summary.source_drift_count, 0);
  assert.equal(status.summary.conflict_count, 0);
});

test("auto maps agent-skills/src to tool-scoped", () => {
  const fx = fixture();
  detectProviders(fx, ["codex"]);
  writeFile(sourcePath(fx), skillMarkdown());

  const packet = syncPacket({
    cwd: fx.cwd,
    homeDir: fx.homeDir,
    provider: "codex",
    tool: "runlane",
    sourceRoot: "agent-skills/src",
    sourceLayout: "auto",
    generatedAt: GENERATED_AT
  });

  assert.equal(packet.ok, true);
  assert.equal(packet.source_roots[0].layout, "tool-scoped");
  const manifest = readManifest(packet);
  assert.equal(manifest.entries[0].source_layout, "tool-scoped");
});

test("generic Agent Skills source root syncs", () => {
  const fx = fixture();
  detectProviders(fx, ["codex"]);
  writeFile(path.join(fx.cwd, "skills", "alpha", "SKILL.md"), skillMarkdown("alpha", "Alpha skill."));

  const packet = syncPacket({
    cwd: fx.cwd,
    homeDir: fx.homeDir,
    provider: "codex",
    sourceRoot: "skills",
    sourceLayout: "agent-skills",
    generatedAt: GENERATED_AT
  });

  assert.equal(packet.ok, true);
  assert.equal(fs.existsSync(path.join(fx.homeDir, ".codex", "skills", "alpha", "SKILL.md")), true);
  const manifest = readManifest(packet);
  assert.equal(manifest.entries[0].source_layout, "agent-skills");
});

test("sync dry-run reports writes without mutating roots or manifest", () => {
  const fx = fixture();
  detectProviders(fx, ["codex"]);
  writeFile(sourcePath(fx), skillMarkdown());

  const packet = syncPacket({
    cwd: fx.cwd,
    homeDir: fx.homeDir,
    provider: "codex",
    tool: "runlane",
    dryRun: true,
    generatedAt: GENERATED_AT
  });

  assert.equal(packet.ok, true);
  assert.equal(packet.dry_run, true);
  assert.equal(packet.writes.length, 1);
  assert.equal(packet.writes[0].written, false);
  assert.equal(fs.existsSync(packet.writes[0].installed_path), false);
  assert.equal(fs.existsSync(packet.manifest.path), false);
  assert.equal(fs.existsSync(path.join(fx.cwd, "skillpress.manifest.json")), false);
});

test("sync defaults to a git-local manifest without dirtying a clean checkout", () => {
  const fx = fixture();
  detectProviders(fx, ["codex"]);
  writeFile(sourcePath(fx), skillMarkdown());
  git(fx.cwd, ["init"]);
  git(fx.cwd, ["add", "."]);
  git(fx.cwd, ["-c", "user.name=Skillpress Test", "-c", "user.email=test@example.invalid", "commit", "-m", "fixture"]);
  assert.equal(git(fx.cwd, ["status", "--short"]), "");

  const packet = syncPacket({ cwd: fx.cwd, homeDir: fx.homeDir, provider: "codex", tool: "runlane", generatedAt: GENERATED_AT });

  assert.equal(packet.ok, true);
  assert.equal(packet.manifest.mode, "git-local");
  assert.equal(packet.manifest.path.includes(`${path.sep}.git${path.sep}`), true);
  assert.equal(fs.existsSync(packet.manifest.path), true);
  assert.equal(fs.existsSync(path.join(fx.cwd, "skillpress.manifest.json")), false);
  assert.equal(git(fx.cwd, ["status", "--short"]), "");
});

test("status fails when canonical source changes after sync", () => {
  const fx = fixture();
  detectProviders(fx, ["codex"]);
  const canonicalPath = sourcePath(fx);
  writeFile(canonicalPath, skillMarkdown("runlane-consumer", "Initial guidance."));
  assert.equal(syncPacket({ cwd: fx.cwd, homeDir: fx.homeDir, provider: "codex", tool: "runlane", generatedAt: GENERATED_AT }).ok, true);

  writeFile(canonicalPath, skillMarkdown("runlane-consumer", "Changed guidance."));

  const status = statusPacket({ cwd: fx.cwd, homeDir: fx.homeDir });
  assert.equal(status.ok, false);
  assert.ok(status.issues.some((entry) => entry.code === "manifest_source_hash_stale"));
  assert.ok(status.issues.some((entry) => entry.code === "manifest_source_tree_hash_stale"));
  assert.ok(status.issues.some((entry) => entry.code === "installed_skill_drift"));
});

test("sync refuses canonical skills that violate policy before writing", () => {
  const fx = fixture();
  detectProviders(fx, ["codex"]);
  writeFile(sourcePath(fx, "remogram", "remogram-dogfood"), [
    "---",
    "name: remogram-dogfood",
    "description: Remogram dogfood overlay.",
    "---",
    "",
    "# Remogram Dogfood",
    "",
    "Dogfood lanes may set allow_missing_checks before merge."
  ].join("\n"));

  const packet = syncPacket({
    cwd: fx.cwd,
    homeDir: fx.homeDir,
    provider: "codex",
    tool: "remogram",
    policyPacks: ["generic", "dogfood"],
    generatedAt: GENERATED_AT
  });

  assert.equal(packet.ok, false);
  assert.equal(packet.summary.write_count, 0);
  assert.ok(packet.issues.some((entry) => entry.code === "policy_missing_pending_check_waiver_forbidden"));
  assert.equal(fs.existsSync(path.join(fx.homeDir, ".codex", "skills", "remogram-dogfood", "SKILL.md")), false);
});

test("dogfood policy rules are opt-in", () => {
  const fx = fixture();
  detectProviders(fx, ["codex"]);
  writeFile(sourcePath(fx, "remogram", "remogram-dogfood"), [
    "---",
    "name: remogram-dogfood",
    "description: Remogram dogfood overlay.",
    "---",
    "",
    "# Remogram Dogfood",
    "",
    "Dogfood lanes may set allow_missing_checks before merge."
  ].join("\n"));

  const packet = syncPacket({
    cwd: fx.cwd,
    homeDir: fx.homeDir,
    provider: "codex",
    tool: "remogram",
    policyPacks: ["generic"],
    generatedAt: GENERATED_AT
  });

  assert.equal(packet.ok, true);
  assert.equal(fs.existsSync(path.join(fx.homeDir, ".codex", "skills", "remogram-dogfood", "SKILL.md")), true);
});

test("sync copies full skill directories for skill-directory providers", () => {
  const fx = fixture();
  detectProviders(fx, ["claude-code"]);
  writeFile(sourcePath(fx), skillMarkdown());
  writeFile(path.join(fx.cwd, "agent-skills", "src", "runlane", "runlane-consumer", "scripts", "verify.js"), "console.log('ok');\n");

  const packet = syncPacket({ cwd: fx.cwd, homeDir: fx.homeDir, provider: "claude-code", tool: "runlane", generatedAt: GENERATED_AT });

  assert.equal(packet.ok, true);
  assert.equal(fs.existsSync(path.join(fx.homeDir, ".claude", "skills", "runlane-consumer", "SKILL.md")), true);
  assert.equal(fs.existsSync(path.join(fx.homeDir, ".claude", "skills", "runlane-consumer", "scripts", "verify.js")), true);
  const manifest = readManifest(packet);
  assert.deepEqual(manifest.entries[0].files.sort(), ["SKILL.md", "scripts/verify.js"]);
});

test("sync supports additional full-fidelity Agent Skills providers", () => {
  const cases = [
    {
      provider: "zed",
      detect: [],
      expected: [".agents", "skills", "runlane-consumer", "scripts", "verify.js"]
    },
    {
      provider: "github-copilot",
      detect: ["github-copilot"],
      expected: [".copilot", "skills", "runlane-consumer", "scripts", "verify.js"]
    },
    {
      provider: "cline",
      detect: ["cline"],
      expected: [".cline", "skills", "runlane-consumer", "scripts", "verify.js"]
    },
    {
      provider: "roo",
      detect: ["roo"],
      expected: [".roo", "skills", "runlane-consumer", "scripts", "verify.js"]
    }
  ];

  for (const providerCase of cases) {
    const fx = fixture();
    detectProviders(fx, providerCase.detect);
    writeFile(sourcePath(fx), skillMarkdown());
    writeFile(path.join(fx.cwd, "agent-skills", "src", "runlane", "runlane-consumer", "scripts", "verify.js"), "console.log('ok');\n");

    const packet = syncPacket({
      cwd: fx.cwd,
      homeDir: fx.homeDir,
      provider: providerCase.provider,
      tool: "runlane",
      generatedAt: GENERATED_AT
    });

    assert.equal(packet.ok, true, providerCase.provider);
    assert.equal(fs.existsSync(path.join(fx.homeDir, ...providerCase.expected)), true, providerCase.provider);
    const manifest = readManifest(packet);
    assert.equal(manifest.entries[0].provider, providerCase.provider);
    assert.equal(manifest.entries[0].fidelity, "full");
    assert.equal(manifest.entries[0].surface_kind, "skill-directory");
    assert.equal(manifest.entries[0].provider_detected, true);
  }
});

test("cursor sync renders an mdc rule and warns about auxiliary files", () => {
  const fx = fixture();
  writeFile(sourcePath(fx), skillMarkdown());
  writeFile(path.join(fx.cwd, "agent-skills", "src", "runlane", "runlane-consumer", "references", "notes.md"), "# Notes\n");

  const packet = syncPacket({ cwd: fx.cwd, homeDir: fx.homeDir, provider: "cursor", tool: "runlane", generatedAt: GENERATED_AT });

  assert.equal(packet.ok, true);
  const cursorRule = path.join(fx.cwd, ".cursor", "rules", "skillpress", "runlane-consumer.mdc");
  assert.equal(fs.existsSync(cursorRule), true);
  const content = fs.readFileSync(cursorRule, "utf8");
  assert.match(content, /^---\ndescription: "Use Runlane facts\."\nalwaysApply: false\n---/);
  assert.ok(packet.issues.some((entry) => entry.code === "provider_auxiliary_files_omitted"));
});

test("sync renders rule-directory providers and warns about omitted auxiliary files", () => {
  const cases = [
    {
      provider: "continue",
      expected: [".continue", "rules", "runlane-consumer.md"],
      frontmatter: /name: "runlane-consumer"\ndescription: "Use Runlane facts\."\nalwaysApply: false/
    },
    {
      provider: "devin",
      expected: [".devin", "rules", "runlane-consumer.md"],
      frontmatter: /description: "Use Runlane facts\."\nactivation: model_decision/
    },
    {
      provider: "github-copilot-instructions",
      expected: [".github", "instructions", "skillpress", "runlane-consumer.instructions.md"],
      frontmatter: /description: "Use Runlane facts\."\napplyTo: "\*\*"/
    }
  ];

  for (const providerCase of cases) {
    const fx = fixture();
    writeFile(sourcePath(fx), skillMarkdown());
    writeFile(path.join(fx.cwd, "agent-skills", "src", "runlane", "runlane-consumer", "references", "notes.md"), "# Notes\n");

    const packet = syncPacket({
      cwd: fx.cwd,
      homeDir: fx.homeDir,
      provider: providerCase.provider,
      tool: "runlane",
      generatedAt: GENERATED_AT
    });

    assert.equal(packet.ok, true, providerCase.provider);
    const rulePath = path.join(fx.cwd, ...providerCase.expected);
    assert.equal(fs.existsSync(rulePath), true, providerCase.provider);
    const content = fs.readFileSync(rulePath, "utf8");
    assert.match(content, providerCase.frontmatter);
    assert.match(content, /<!-- skillpress/);
    assert.ok(packet.issues.some((entry) => entry.code === "provider_auxiliary_files_omitted" && entry.provider === providerCase.provider));
    const manifest = readManifest(packet);
    assert.equal(manifest.entries[0].fidelity, "rule-render");
    assert.equal(manifest.entries[0].auxiliary_files_omitted, true);
  }
});

test("provider-scoped sync preserves configured provider roots across manifest round trips", () => {
  const fx = fixture();
  writeFile(sourcePath(fx), skillMarkdown());
  writeFile(path.join(fx.cwd, "skillpress.config.json"), JSON.stringify({
    providers: [
      { id: "cursor", root: ".custom-cursor-rules" },
      { id: "codex", root: "~/.custom-codex-skills" }
    ]
  }));

  const cursor = syncPacket({
    cwd: fx.cwd,
    homeDir: fx.homeDir,
    configPath: "skillpress.config.json",
    provider: "cursor",
    tool: "runlane",
    generatedAt: GENERATED_AT
  });
  assert.equal(cursor.ok, true);
  assert.equal(fs.existsSync(path.join(fx.cwd, ".custom-cursor-rules", "runlane-consumer.mdc")), true);

  const codex = syncPacket({
    cwd: fx.cwd,
    homeDir: fx.homeDir,
    configPath: "skillpress.config.json",
    provider: "codex",
    tool: "runlane",
    generatedAt: GENERATED_AT
  });
  assert.equal(codex.ok, true);
  assert.equal(fs.existsSync(path.join(fx.homeDir, ".custom-codex-skills", "runlane-consumer", "SKILL.md")), true);

  const manifest = readManifest(codex);
  assert.deepEqual(manifest.entries.map((entry) => entry.provider).sort(), ["codex", "cursor"]);
  assert.ok(manifest.entries.some((entry) => entry.provider === "cursor" && entry.installed_path === ".custom-cursor-rules/runlane-consumer.mdc"));
  assert.ok(manifest.entries.some((entry) => entry.provider === "codex" && entry.installed_path === "~/.custom-codex-skills/runlane-consumer/SKILL.md"));

  const status = statusPacket({
    cwd: fx.cwd,
    homeDir: fx.homeDir,
    configPath: "skillpress.config.json",
    tool: "runlane"
  });
  assert.equal(status.ok, true);
});

test("sync refuses unmanaged files in configured rule provider roots", () => {
  const fx = fixture();
  writeFile(sourcePath(fx), skillMarkdown());
  writeFile(path.join(fx.cwd, "skillpress.config.json"), JSON.stringify({
    providers: [{ id: "cursor", root: ".custom-cursor-rules" }]
  }));
  writeFile(path.join(fx.cwd, ".custom-cursor-rules", "runlane-consumer.mdc"), "# Existing local rule\n");

  const packet = syncPacket({
    cwd: fx.cwd,
    homeDir: fx.homeDir,
    configPath: "skillpress.config.json",
    provider: "cursor",
    tool: "runlane",
    generatedAt: GENERATED_AT
  });

  assert.equal(packet.ok, false);
  assert.ok(packet.issues.some((entry) => entry.code === "installed_skill_unmanaged" && entry.path.endsWith(".custom-cursor-rules/runlane-consumer.mdc")));
});

test("single-instructions provider writes opt-in generated AGENTS file", () => {
  const fx = fixture();
  writeFile(sourcePath(fx), skillMarkdown());

  const packet = syncPacket({
    cwd: fx.cwd,
    homeDir: fx.homeDir,
    provider: "agents-md",
    tool: "runlane",
    generatedAt: GENERATED_AT
  });

  assert.equal(packet.ok, true);
  const agentsPath = path.join(fx.cwd, "AGENTS.skillpress.md");
  assert.equal(fs.existsSync(agentsPath), true);
  const content = fs.readFileSync(agentsPath, "utf8");
  assert.match(content, /# Skillpress Agent Instructions/);
  assert.match(content, /## runlane-consumer/);
  assert.match(content, /target: agents-md/);
  const manifest = readManifest(packet);
  assert.equal(manifest.entries[0].provider, "agents-md");
  assert.equal(manifest.entries[0].fidelity, "summary");
  assert.equal(manifest.entries[0].skill, "skillpress-instructions");

  const status = statusPacket({ cwd: fx.cwd, homeDir: fx.homeDir, provider: "agents-md" });
  assert.equal(status.ok, true);
  assert.equal(status.summary.source_drift_count, 0);
});

test("sync merges second provider entries after null-normalized manifest read", () => {
  const fx = fixture();
  detectProviders(fx, ["codex"]);
  writeFile(sourcePath(fx, "remogram", "remogram-consumer"), skillMarkdown("remogram-consumer", "Use Remogram facts."));

  const cursor = syncPacket({
    cwd: fx.cwd,
    homeDir: fx.homeDir,
    provider: "cursor",
    tool: "remogram",
    generatedAt: GENERATED_AT
  });
  assert.equal(cursor.ok, true);

  const codex = syncPacket({
    cwd: fx.cwd,
    homeDir: fx.homeDir,
    provider: "codex",
    tool: "remogram",
    generatedAt: GENERATED_AT
  });
  assert.equal(codex.ok, true);

  const manifest = readManifest(codex);
  assert.deepEqual(manifest.entries.map((entry) => entry.provider).sort(), ["codex", "cursor"]);
  assert.ok(manifest.entries.every((entry) => entry.source_layout === "tool-scoped"));

  const status = statusPacket({ cwd: fx.cwd, homeDir: fx.homeDir, tool: "remogram" });
  assert.equal(status.ok, true);
});

test("sync ignores legacy root install manifest unless explicitly requested", () => {
  const fx = fixture();
  detectProviders(fx, ["codex"]);
  writeFile(sourcePath(fx), skillMarkdown());
  writeFile(path.join(fx.cwd, "skillpress.manifest.json"), JSON.stringify({
    schema: "skillpress.install-manifest",
    version: 2,
    entries: []
  }));

  const implicit = syncPacket({ cwd: fx.cwd, homeDir: fx.homeDir, provider: "codex", tool: "runlane", generatedAt: GENERATED_AT });
  assert.equal(implicit.ok, true);
  assert.equal(implicit.manifest.legacy_default_present, true);
  assert.notEqual(implicit.manifest.path, path.join(fx.cwd, "skillpress.manifest.json"));
  assert.ok(implicit.issues.some((entry) => entry.code === "legacy_install_manifest_ignored"));
  assert.equal(readManifest(implicit).entries.length, 1);

  const explicit = syncPacket({
    cwd: fx.cwd,
    homeDir: fx.homeDir,
    provider: "agents",
    tool: "runlane",
    manifestPath: "skillpress.manifest.json",
    generatedAt: GENERATED_AT
  });
  assert.equal(explicit.ok, true);
  assert.equal(explicit.manifest.mode, "explicit");
  assert.equal(explicit.manifest.path, path.join(fx.cwd, "skillpress.manifest.json"));
  const manifest = JSON.parse(fs.readFileSync(path.join(fx.cwd, "skillpress.manifest.json"), "utf8"));
  assert.deepEqual(manifest.entries.map((entry) => entry.provider), ["agents"]);
});
