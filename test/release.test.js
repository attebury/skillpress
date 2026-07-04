import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function publicExportPaths(script) {
  const match = script.match(/PUBLIC_PATHS=\(\n([\s\S]*?)\n\)/);
  assert.ok(match, "export script must define PUBLIC_PATHS");
  return [...match[1].matchAll(/"([^"]+)"/g)].map((entry) => entry[1]);
}

test("GitHub CI runs generic public checks", () => {
  const workflow = fs.readFileSync(path.join(repoRoot, ".github", "workflows", "test.yml"), "utf8");

  assert.match(workflow, /node-version: '20'/);
  assert.match(workflow, /npm test/);
  assert.match(workflow, /NPM_CONFIG_CACHE=\/tmp\/skillpress-npm-cache npm pack --dry-run --json/);
  assert.doesNotMatch(workflow, /runlane|gitea|remogram/i);
});

test("public export script uses an explicit public source allowlist", () => {
  const script = fs.readFileSync(path.join(repoRoot, "scripts", "export-public-main.sh"), "utf8");
  const paths = publicExportPaths(script);

  for (const rel of [
    ".github/workflows/test.yml",
    ".gitignore",
    ".remogram.json.example",
    "LICENSE",
    "README.md",
    "SECURITY.md",
    "bin",
    "docs/decisions/skillpress-boundary.md",
    "docs/operating-model.md",
    "docs/release.md",
    "examples",
    "llms.txt",
    "package.json",
    "src",
    "test"
  ]) {
    assert.ok(paths.includes(rel), `${rel} must be public-exported`);
  }

  for (const rel of [
    "scripts",
    "scripts/export-public-main.sh",
    ".runlane",
    ".remogram.json",
    "skillpress.manifest.json",
    "skillpress.config.json",
    ".cursor",
    ".codex",
    ".agents",
    ".claude",
    ".gitea",
    ".tmp",
    "coverage",
    "node_modules"
  ]) {
    assert.equal(paths.includes(rel), false, `${rel} must not be public-exported`);
  }

  assert.match(script, /git -C "\$\{ROOT\}" archive HEAD -- "\$\{PUBLIC_PATHS\[@\]\}"/);
  assert.doesNotMatch(script, /git -C "\$\{ROOT\}" archive HEAD \|/);
  assert.match(script, /status --porcelain/);
  assert.match(script, /clean committed checkout/);
  assert.match(script, /git@github.com:attebury\/skillpress.git/);
  assert.match(script, /git push -u origin main --force/);
  assert.match(script, /npm test/);
  assert.match(script, /npm pack --dry-run --json/);
});

test("releasepress config exports an allowlisted public source tree", () => {
  const config = JSON.parse(fs.readFileSync(path.join(repoRoot, "releasepress.config.json"), "utf8"));
  const localBinDir = path.join("/", "Users", "attebury", "Documents", "tools", "bin");

  assert.equal(config.public_repo, "https://github.com/attebury/skillpress.git");
  assert.equal(config.stage_repo, "file:///tmp/skillpress-public-stage.git");
  assert.deepEqual(config.package.argv, ["npm", "pack", "--dry-run", "--json"]);
  assert.equal(config.surfaces.github.enabled, false);
  assert.equal(config.surfaces.npm.enabled, false);
  assert.deepEqual(config.surfaces.local, {
    enabled: true,
    strategy: "bin_shim",
    source: "source",
    command_name: "skillpress",
    bin_dir: localBinDir,
    target: "bin/skillpress.js"
  });

  for (const rel of [
    ".github/workflows/test.yml",
    ".gitignore",
    ".remogram.json.example",
    "LICENSE",
    "README.md",
    "SECURITY.md",
    "bin/**",
    "docs/**",
    "examples/**",
    "llms.txt",
    "package.json",
    "src/**",
    "test/**"
  ]) {
    assert.ok(config.include.includes(rel), `${rel} must be releasepress exported`);
  }

  for (const rel of [
    ".runlane/**",
    ".remogram.json",
    ".cursor/**",
    ".codex/**",
    ".agents/**",
    ".claude/**",
    "node_modules/**",
    "coverage/**",
    ".releasepress-report/**",
    "skillpress.manifest.json",
    "**/skillpress.manifest.json",
    "skillpress.config.json",
    "releasepress.config.json",
    "scripts/**"
  ]) {
    assert.ok(config.exclude.includes(rel), `${rel} must be releasepress excluded`);
  }
});

test("releasepress config scans local forge and token markers", () => {
  const config = JSON.parse(fs.readFileSync(path.join(repoRoot, "releasepress.config.json"), "utf8"));

  for (const marker of [
    "/Users/" + "attebury",
    "localhost:" + "3000",
    "http://" + "localhost",
    "127.0.0.1:" + "3000",
    "." + "runlane/forge-authority",
    "GITEA_" + "TOKEN",
    "REMOGRAM_" + "OPERATOR_CONFIG",
    "GITHUB_" + "TOKEN",
    "NPM_" + "TOKEN",
    "skillpress-" + "internal.git",
    "skillpress-" + "private.git"
  ]) {
    assert.ok(config.forbidden_strings.includes(marker), `${marker} must be scanned`);
  }
});

test("releasepress package surface excludes non-runtime sources", () => {
  const config = JSON.parse(fs.readFileSync(path.join(repoRoot, "releasepress.config.json"), "utf8"));

  for (const rel of [
    "scripts/",
    "examples/",
    "test/",
    ".github/",
    ".runlane/",
    ".cursor/",
    ".codex/",
    ".agents/",
    ".claude/",
    ".releasepress-report/",
    ".remogram.json",
    "skillpress.manifest.json",
    "skillpress.config.json",
    "releasepress.config.json"
  ]) {
    assert.ok(config.package.must_exclude.includes(rel), `${rel} must be excluded from npm package`);
  }
});

test("release docs describe releasepress beta flow", () => {
  const docs = fs.readFileSync(path.join(repoRoot, "docs", "release.md"), "utf8");

  assert.match(docs, /releasepress boundary --json/);
  assert.match(docs, /releasepress plan --json --config releasepress\.config\.json/);
  assert.match(docs, /releasepress export --json --config releasepress\.config\.json/);
  assert.match(docs, /releasepress scan --json --config releasepress\.config\.json/);
  assert.match(docs, /releasepress package --json --config releasepress\.config\.json/);
  assert.match(docs, /releasepress stage --json --config releasepress\.config\.json/);
  assert.match(docs, /releasepress checklist --json --config releasepress\.config\.json/);
  assert.match(docs, /releasepress verify --json --config releasepress\.config\.json/);
  assert.match(docs, /releasepress promote local --json --config releasepress\.config\.json/);
  assert.match(docs, /npm pack --dry-run --json/);
  assert.match(docs, /npm publish --tag beta/);
  assert.match(docs, /npm install -g skillpress@beta/);
  assert.match(docs, /clean, committed checkout/);
  assert.doesNotMatch(docs, /export-public-main/);
  assert.doesNotMatch(docs, /force/);
  assert.doesNotMatch(docs, /runlane/i);
  assert.doesNotMatch(docs, /dogfood/i);
  assert.doesNotMatch(docs, /private/i);
});

test("new public release files avoid exact local secret and forge markers", () => {
  const files = [
    "README.md",
    "llms.txt",
    "docs/release.md",
    ".github/workflows/test.yml",
    ".gitignore",
    ".remogram.json.example"
  ];
  const forbidden = [
    "/Users/" + "attebury",
    "localhost:" + "3000",
    "." + "runlane/forge-authority",
    "GITEA_" + "TOKEN",
    "REMOGRAM_" + "OPERATOR_CONFIG"
  ];

  for (const rel of files) {
    const text = fs.readFileSync(path.join(repoRoot, rel), "utf8");
    for (const marker of forbidden) {
      assert.equal(text.includes(marker), false, `${rel} contains ${marker}`);
    }
  }
});
