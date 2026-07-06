import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

test("package manifest explicitly limits published runtime files", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));

  assert.match(pkg.version, /^\d+\.\d+\.\d+/);
  assert.equal(pkg.repository.url, "git+https://github.com/attebury/skillpress.git");
  assert.equal(pkg.bugs.url, "https://github.com/attebury/skillpress/issues");
  assert.equal(pkg.homepage, "https://github.com/attebury/skillpress#readme");
  assert.ok(pkg.keywords.includes("agent-skills"));

  assert.deepEqual(pkg.files, [
    "bin/",
    "src/",
    "README.md",
    "LICENSE",
    "SECURITY.md",
    "llms.txt"
  ]);
  assert.equal(pkg.files.includes("agent-skills/"), false);
  assert.equal(pkg.files.includes(".diagram/"), false);
  assert.equal(pkg.files.includes("examples/"), false);
  assert.equal(pkg.files.includes("test/"), false);
  assert.equal(pkg.files.includes("scripts/"), false);
  assert.equal(pkg.files.includes(".github/"), false);
  assert.equal(pkg.files.includes(".remogram.json"), false);
  assert.equal(pkg.files.includes("skillpress.config.json"), false);
});

test("npm pack dry-run excludes examples and local source caches", () => {
  const result = spawnSync("npm", ["pack", "--dry-run", "--json"], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      NPM_CONFIG_CACHE: process.env.NPM_CONFIG_CACHE ?? path.join(os.tmpdir(), "skillpress-npm-cache")
    }
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const [pack] = JSON.parse(result.stdout);
  const files = pack.files.map((entry) => entry.path);

  assert.ok(files.includes("package.json"));
  assert.ok(files.includes("README.md"));
  assert.ok(files.includes("LICENSE"));
  assert.ok(files.includes("SECURITY.md"));
  assert.ok(files.includes("llms.txt"));
  assert.equal(files.some((entry) => entry.startsWith("src/")), true);
  assert.equal(files.some((entry) => entry.startsWith("bin/")), true);
  assert.equal(files.some((entry) => entry.startsWith("docs/")), false);
  assert.equal(files.some((entry) => entry.startsWith("examples/")), false);
  assert.equal(files.some((entry) => entry.startsWith("agent-skills/")), false);
  assert.equal(files.some((entry) => entry.startsWith(".diagram/")), false);
  assert.equal(files.some((entry) => entry.startsWith("test/")), false);
  assert.equal(files.some((entry) => entry.startsWith("scripts/")), false);
  assert.equal(files.some((entry) => entry.startsWith(".github/")), false);
  assert.equal(files.includes(".remogram.json"), false);
  assert.equal(files.includes("skillpress.config.json"), false);
  assert.equal(files.includes("skillpress.manifest.json"), false);
});
