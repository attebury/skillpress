import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

test("GitHub CI runs generic public checks", () => {
  const workflow = fs.readFileSync(path.join(repoRoot, ".github", "workflows", "test.yml"), "utf8");

  assert.match(workflow, /node-version: '20'/);
  assert.match(workflow, /npm test/);
  assert.match(workflow, /NPM_CONFIG_CACHE=\/tmp\/skillpress-npm-cache npm pack --dry-run --json/);
  assert.doesNotMatch(workflow, /runlane|gitea|remogram/i);
});

test("public export script removes runtime surfaces and prints GitHub push command", () => {
  const script = fs.readFileSync(path.join(repoRoot, "scripts", "export-public-main.sh"), "utf8");

  for (const rel of [
    ".runlane",
    ".remogram.json",
    "skillpress.manifest.json",
    ".cursor",
    ".codex",
    ".agents",
    ".claude",
    ".gitea",
    ".tmp",
    "coverage",
    "node_modules"
  ]) {
    assert.match(script, new RegExp(rel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }

  assert.match(script, /git -C "\$\{ROOT\}" archive HEAD/);
  assert.match(script, /status --porcelain/);
  assert.match(script, /clean committed checkout/);
  assert.match(script, /git@github.com:attebury\/skillpress.git/);
  assert.match(script, /git push -u origin main --force/);
  assert.match(script, /npm test/);
  assert.match(script, /npm pack --dry-run --json/);
});

test("release docs describe beta export flow", () => {
  const docs = fs.readFileSync(path.join(repoRoot, "docs", "release.md"), "utf8");

  assert.match(docs, /scripts\/export-public-main\.sh/);
  assert.match(docs, /git@github.com:attebury\/skillpress.git/);
  assert.match(docs, /npm publish --tag beta/);
  assert.match(docs, /npm install -g skillpress@beta/);
  assert.match(docs, /clean, committed checkout/);
});

test("new public release files avoid exact local secret and forge markers", () => {
  const files = [
    "README.md",
    "llms.txt",
    "docs/release.md",
    "scripts/export-public-main.sh",
    ".github/workflows/test.yml"
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
