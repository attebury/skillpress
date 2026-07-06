import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { publishPacket } from "../src/publish.js";
import { resolveProviderSelection } from "../src/providers.js";

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "skillpress-publish-"));
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

function skillMarkdown(name = "atteware-tooling-agent-doctrine", fmExtra = "") {
  return [
    "---",
    `name: ${name}`,
    "description: Standard agent doctrine.",
    fmExtra,
    "---",
    "",
    `# ${name}`,
    "",
    "Do work safely.",
    ""
  ].join("\n");
}

function writeSourceSkill(fx, name = "atteware-tooling-agent-doctrine", fmExtra = "") {
  writeFile(
    path.join(fx.cwd, "agent-skills", "src", "atteware", name, "SKILL.md"),
    skillMarkdown(name, fmExtra)
  );
  // Write contract to satisfy dependencies
  writeFile(
    path.join(fx.cwd, "agent-skills", "contracts", "atteware.commands.json"),
    JSON.stringify([])
  );
}

test("publish supports dry-run without writing files", () => {
  const fx = fixture();
  writeSourceSkill(fx);

  const packet = publishPacket({
    cwd: fx.cwd,
    homeDir: fx.homeDir,
    skillName: "atteware-tooling-agent-doctrine",
    scope: "global",
    dryRun: true
  });

  assert.equal(packet.ok, true);
  assert.equal(packet.dry_run, true);
  assert.equal(packet.scope, "global");
  assert.ok(packet.published_files.length > 0);
  assert.equal(fs.existsSync(packet.targets[0]), false);
});

test("publish global copies skill raw files to global destination and logs in manifest", () => {
  const fx = fixture();
  writeSourceSkill(fx);

  const globalRoot = path.join(fx.homeDir, "global-customizations");
  fs.mkdirSync(globalRoot, { recursive: true });
  process.env.AGENT_SKILLS_GLOBAL_ROOT = globalRoot;

  const packet = publishPacket({
    cwd: fx.cwd,
    homeDir: fx.homeDir,
    skillName: "atteware-tooling-agent-doctrine",
    scope: "global"
  });

  assert.equal(packet.ok, true);
  assert.equal(packet.dry_run, false);
  assert.equal(packet.scope, "global");
  
  const targetSkillDir = path.join(globalRoot, "atteware-tooling-agent-doctrine");
  assert.equal(fs.existsSync(targetSkillDir), true);
  assert.equal(fs.existsSync(path.join(targetSkillDir, "SKILL.md")), true);

  // Check manifest document
  const manifestPath = path.join(fx.homeDir, ".local", "state", "skillpress", "install-manifests");
  // The state manifest path contains a cwd hash, find it dynamically
  const files = fs.readdirSync(manifestPath);
  const hashDir = files[0];
  const manifestDocument = JSON.parse(
    fs.readFileSync(path.join(manifestPath, hashDir, "install-manifest.local.json"), "utf8")
  );
  
  assert.equal(manifestDocument.entries.length, 1);
  assert.equal(manifestDocument.entries[0].skill, "atteware-tooling-agent-doctrine");
  assert.equal(manifestDocument.entries[0].provider, "agent-skills-global");
  assert.ok(manifestDocument.entries[0].installed_path.startsWith("~/global-customizations"));

  delete process.env.AGENT_SKILLS_GLOBAL_ROOT;
});

test("publish forest propagates skill to all active registered lanes and writes config", () => {
  const fx = fixture();
  writeSourceSkill(fx);

  // Mocks a lane registry inside repo root
  const registry = {
    schema: "runlane.lane-registry.local",
    version: 2,
    repo: "atteware",
    lanes_root: fx.cwd,
    lanes: {
      merge: { path: path.join(fx.cwd, "merge") },
      implement: { path: path.join(fx.cwd, "implement") }
    }
  };
  writeFile(path.join(fx.cwd, "lane-registry.local.json"), JSON.stringify(registry, null, 2));
  fs.mkdirSync(path.join(fx.cwd, "merge"), { recursive: true });
  fs.mkdirSync(path.join(fx.cwd, "implement"), { recursive: true });

  const packet = publishPacket({
    workspaceRoot: fx.cwd,
    cwd: path.join(fx.cwd, "merge"), // run command inside a lane
    homeDir: fx.homeDir,
    skillName: "atteware-tooling-agent-doctrine",
    scope: "forest"
  });

  assert.equal(packet.ok, true);
  assert.equal(packet.scope, "forest");

  // Check that files are written to both lane subfolders
  assert.equal(
    fs.existsSync(path.join(fx.cwd, "merge", ".agents", "skills", "atteware-tooling-agent-doctrine", "SKILL.md")),
    true
  );
  assert.equal(
    fs.existsSync(path.join(fx.cwd, "implement", ".agents", "skills", "atteware-tooling-agent-doctrine", "SKILL.md")),
    true
  );

  // Check that skillpress.config.json is auto-generated in lanes root
  const configPath = path.join(fx.cwd, "skillpress.config.json");
  assert.equal(fs.existsSync(configPath), true);
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  assert.deepEqual(config.publish_rules["atteware-tooling-agent-doctrine"], { scope: "forest" });
});

test("publish tree targets only specified lanes in active forest registry", () => {
  const fx = fixture();
  writeSourceSkill(fx);

  const registry = {
    schema: "runlane.lane-registry.local",
    version: 2,
    repo: "atteware",
    lanes_root: fx.cwd,
    lanes: {
      merge: { path: path.join(fx.cwd, "merge") },
      implement: { path: path.join(fx.cwd, "implement") },
      verify: { path: path.join(fx.cwd, "verify") }
    }
  };
  writeFile(path.join(fx.cwd, "lane-registry.local.json"), JSON.stringify(registry, null, 2));
  fs.mkdirSync(path.join(fx.cwd, "merge"), { recursive: true });
  fs.mkdirSync(path.join(fx.cwd, "implement"), { recursive: true });
  fs.mkdirSync(path.join(fx.cwd, "verify"), { recursive: true });

  const packet = publishPacket({
    workspaceRoot: fx.cwd,
    cwd: path.join(fx.cwd, "merge"),
    homeDir: fx.homeDir,
    skillName: "atteware-tooling-agent-doctrine",
    scope: "tree",
    lanes: ["implement", "verify"]
  });

  assert.equal(packet.ok, true);
  assert.equal(packet.scope, "tree");

  // Should write only to implement and verify, leaving merge clean
  assert.equal(
    fs.existsSync(path.join(fx.cwd, "implement", ".agents", "skills", "atteware-tooling-agent-doctrine", "SKILL.md")),
    true
  );
  assert.equal(
    fs.existsSync(path.join(fx.cwd, "verify", ".agents", "skills", "atteware-tooling-agent-doctrine", "SKILL.md")),
    true
  );
  assert.equal(
    fs.existsSync(path.join(fx.cwd, "merge", ".agents", "skills", "atteware-tooling-agent-doctrine", "SKILL.md")),
    false
  );
});

test("publish standalone falls back to local workspace root when registry is missing", () => {
  const fx = fixture();
  writeSourceSkill(fx);

  const packet = publishPacket({
    cwd: fx.cwd,
    homeDir: fx.homeDir,
    skillName: "atteware-tooling-agent-doctrine",
    scope: "forest"
  });

  assert.equal(packet.ok, true);
  assert.equal(packet.scope, "forest");
  assert.equal(
    fs.existsSync(path.join(fx.cwd, ".agents", "skills", "atteware-tooling-agent-doctrine", "SKILL.md")),
    true
  );
});

test("publish blocks paths that escape forest root boundaries", () => {
  const fx = fixture();
  writeSourceSkill(fx);

  // Mock registry pointing lane outside forest root
  const registry = {
    schema: "runlane.lane-registry.local",
    version: 2,
    repo: "atteware",
    lanes_root: fx.cwd,
    lanes: {
      malicious: { path: path.join(fx.root, "escaped_folder") } // outside fx.cwd repo
    }
  };
  writeFile(path.join(fx.cwd, "lane-registry.local.json"), JSON.stringify(registry, null, 2));

  assert.throws(() => {
    publishPacket({
      cwd: fx.cwd,
      homeDir: fx.homeDir,
      skillName: "atteware-tooling-agent-doctrine",
      scope: "forest"
    });
  }, /escapes the forest parent root/);
});

test("publish blocks path resolutions for sensitive system folders", () => {
  const fx = fixture();
  writeSourceSkill(fx);

  const registry = {
    schema: "runlane.lane-registry.local",
    version: 2,
    repo: "atteware",
    lanes_root: fx.cwd,
    lanes: {
      etc: { path: "/etc" }
    }
  };
  writeFile(path.join(fx.cwd, "lane-registry.local.json"), JSON.stringify(registry, null, 2));

  assert.throws(() => {
    publishPacket({
      cwd: fx.cwd,
      homeDir: fx.homeDir,
      skillName: "atteware-tooling-agent-doctrine",
      scope: "forest"
    });
  }, /classified as a sensitive system path/);
});

test("publish protects against global elevation from untrusted frontmatter", () => {
  const fx = fixture();
  // Skill requests global publishing natively
  writeSourceSkill(fx, "atteware-tooling-agent-doctrine", "skillpress_publish_scope: global");

  const packet = publishPacket({
    cwd: fx.cwd,
    homeDir: fx.homeDir,
    skillName: "atteware-tooling-agent-doctrine"
  });

  assert.equal(packet.ok, false);
  assert.equal(packet.code, "publish_scope_elevation_forbidden");
});

test("providers support config-driven custom provider targets at runtime", () => {
  const fx = fixture();
  const customProviders = [
    {
      id: "my-config-provider",
      kind: "skill-directory",
      root: path.join(fx.cwd, "custom-agent-sinks"),
      layout: "{root}/{skill}/SKILL.md",
      fidelity: "full"
    }
  ];

  const selection = resolveProviderSelection({
    providers: customProviders,
    cwd: fx.cwd,
    homeDir: fx.homeDir
  });

  assert.equal(selection.issues.length, 0);
  assert.equal(selection.providers.length, 1);
  assert.equal(selection.providers[0].id, "my-config-provider");
  assert.equal(selection.providers[0].root, path.join(fx.cwd, "custom-agent-sinks"));
});
