import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const releasepressConfigPath = path.join(repoRoot, "releasepress.config.json");
const exportScriptPath = path.join(repoRoot, "scripts", "export-public-main.sh");

function sourceReleaseFilesAvailable() {
  return fs.existsSync(releasepressConfigPath) && fs.existsSync(exportScriptPath);
}

function sourceReleaseOnlySkip() {
  return sourceReleaseFilesAvailable()
    ? false
    : "source release config is intentionally excluded from public exports";
}

function releasepressCliAvailable() {
  const result = spawnSync("releasepress", ["boundary", "--json"], {
    cwd: repoRoot,
    encoding: "utf8",
    shell: false
  });
  return result.error?.code !== "ENOENT";
}

function publicExportPaths(script) {
  const match = script.match(/PUBLIC_PATHS=\(\n([\s\S]*?)\n\)/);
  assert.ok(match, "export script must define PUBLIC_PATHS");
  return [...match[1].matchAll(/"([^"]+)"/g)].map((entry) => entry[1]);
}

test("GitHub CI runs generic public checks", () => {
  const workflow = fs.readFileSync(path.join(repoRoot, ".github", "workflows", "test.yml"), "utf8");

  assert.match(workflow, /node-version: '20'/);
  assert.match(workflow, /actions\/checkout@v4\.2\.2/);
  assert.match(workflow, /npm test/);
  assert.match(workflow, /NPM_CONFIG_CACHE=\/tmp\/skillpress-npm-cache npm pack --dry-run --json/);
  assert.doesNotMatch(workflow, /runlane|gitea|remogram/i);
});

test("public export script uses an explicit public source allowlist", {
  skip: sourceReleaseOnlySkip()
}, () => {
  const script = fs.readFileSync(exportScriptPath, "utf8");
  const paths = publicExportPaths(script);

  for (const rel of [
    ".github/workflows/test.yml",
    ".gitignore",
    ".remogram.json.example",
    "LICENSE",
    "README.md",
    "SECURITY.md",
    "bin",
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

test("releasepress config exports an allowlisted public source tree", {
  skip: sourceReleaseOnlySkip()
}, () => {
  const config = JSON.parse(fs.readFileSync(releasepressConfigPath, "utf8"));
  const localBinDir = path.join("/", "Users", "attebury", "Documents", "tools", "bin");
  const localStageRepo = "http://" + "localhost" + ":3000/attebury/skillpress-stage.git";

  assert.equal(config.public_repo, "https://github.com/attebury/skillpress.git");
  assert.equal(config.stage_repo, localStageRepo);
  assert.deepEqual(config.stage, {
    strategy: "replace-main",
    ref: "main"
  });
  assert.equal(Object.hasOwn(config, "package"), false);
  assert.equal(Object.hasOwn(config.surfaces, "github"), false);
  assert.equal(Object.hasOwn(config.surfaces, "npm"), false);
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
    "agent-skills/**",
    "bin/**",
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
    ".diagram/**",
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

test("releasepress config uses current public delivery objects", {
  skip: sourceReleaseOnlySkip()
}, () => {
  const config = JSON.parse(fs.readFileSync(releasepressConfigPath, "utf8"));

  assert.deepEqual(config.review_targets, [
    {
      id: "local-public-review",
      kind: "git_ref",
      repo: "file:///tmp/skillpress-public-review.git",
      visibility: "local",
      strategy: "replace-ref",
      ref: "release/stable",
      requires_human_attestation: true
    }
  ]);

  assert.deepEqual(config.artifacts, [
    {
      id: "npm-package",
      kind: "npm_pack",
      inspect_argv: ["npm", "pack", "--dry-run", "--json"],
      root: "source",
      path: ".",
      must_exclude: [
        "scripts/",
        "examples/",
        "test/",
        ".github/",
        ".runlane/",
        ".cursor/",
        ".codex/",
        ".agents/",
        ".claude/",
        ".diagram/",
        ".releasepress-report/",
        ".remogram.json",
        "agent-skills/",
        "skillpress.manifest.json",
        "skillpress.config.json",
        "releasepress.config.json"
      ]
    }
  ]);

  assert.deepEqual(config.delivery.providers, [
    {
      id: "github-public",
      kind: "git_host",
      provider: "github",
      enabled: true,
      review_target: "local-public-review",
      repo: "attebury/skillpress",
      branch: "main",
      ref: "main",
      remote_name: "origin",
      allow_force_push: false,
      launch_root: "export",
      launch_path: ".",
      launcher: {
        command_argv: [
          "git",
          "push",
          "git@github.com:attebury/skillpress.git",
          "HEAD:refs/heads/main"
        ]
      },
      release: {
        latest_policy: "beta_as_latest"
      },
      verify: {
        kind: "git_ref",
        remote: "git@github.com:attebury/skillpress.git",
        ref: "refs/heads/{branch}"
      }
    },
    {
      id: "npm-latest",
      kind: "package_registry",
      provider: "npm",
      enabled: true,
      review_target: "local-public-review",
      artifact: "npm-package",
      channel: "latest",
      dist_tag: "latest",
      workspace: false,
      launch_root: "source",
      launch_path: ".",
      launcher: {
        command_argv: [
          "npm",
          "publish"
        ]
      },
      verify: {
        kind: "argv",
        command_argv: ["npm", "view", "skillpress", "dist-tags", "--json"],
        expect: {
          latest: "{version}"
        }
      }
    }
  ]);
});

test("releasepress config passes the installed plan contract", {
  skip: sourceReleaseOnlySkip() || (releasepressCliAvailable() ? false : "releasepress CLI is not installed")
}, () => {
  const result = spawnSync("releasepress", ["plan", "--json", "--config", "releasepress.config.json"], {
    cwd: repoRoot,
    encoding: "utf8",
    shell: false
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const packet = JSON.parse(result.stdout);
  assert.equal(packet.ok, true);
  assert.equal(packet.stage.strategy, "replace-main");
  assert.equal(packet.public_review.id, "local-public-review");
  assert.equal(packet.artifacts[0].id, "npm-package");
  assert.deepEqual(packet.delivery.providers.map((provider) => [provider.id, provider.enabled]), [
    ["github-public", true],
    ["npm-latest", true]
  ]);
  assert.deepEqual(packet.delivery.providers.map((provider) => [provider.id, provider.launcher_argv]), [
    ["github-public", ["git", "push", "git@github.com:attebury/skillpress.git", "HEAD:refs/heads/main"]],
    ["npm-latest", ["npm", "publish"]]
  ]);
});

test("releasepress config scans local forge and token markers", {
  skip: sourceReleaseOnlySkip()
}, () => {
  const config = JSON.parse(fs.readFileSync(releasepressConfigPath, "utf8"));

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

test("releasepress package surface excludes non-runtime sources", {
  skip: sourceReleaseOnlySkip()
}, () => {
  const config = JSON.parse(fs.readFileSync(releasepressConfigPath, "utf8"));
  const npmPackage = config.artifacts.find((artifact) => artifact.id === "npm-package");

  assert.ok(npmPackage, "npm-package artifact must exist");

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
    ".diagram/",
    ".releasepress-report/",
    ".remogram.json",
    "agent-skills/",
    "skillpress.manifest.json",
    "skillpress.config.json",
    "releasepress.config.json"
  ]) {
    assert.ok(npmPackage.must_exclude.includes(rel), `${rel} must be excluded from npm package`);
  }
});

test("new public release files avoid exact local secret and forge markers", () => {
  const files = [
    "README.md",
    "llms.txt",
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
