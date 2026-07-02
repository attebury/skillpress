import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

test("package manifest explicitly limits published runtime files", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));

  assert.deepEqual(pkg.files, [
    "bin/",
    "docs/",
    "src/",
    "README.md",
    "LICENSE",
    "SECURITY.md"
  ]);
  assert.equal(pkg.files.includes("agent-skills/"), false);
  assert.equal(pkg.files.includes("examples/"), false);
  assert.equal(pkg.files.includes("test/"), false);
  assert.equal(pkg.files.includes(".remogram.json"), false);
  assert.equal(pkg.files.includes("skillpress.config.json"), false);
});

test("npm pack dry-run excludes examples and local source caches", () => {
  const result = spawnSync("npm", ["pack", "--dry-run", "--json"], {
    cwd: repoRoot,
    encoding: "utf8"
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const [pack] = JSON.parse(result.stdout);
  const files = pack.files.map((entry) => entry.path);

  assert.ok(files.includes("package.json"));
  assert.ok(files.includes("README.md"));
  assert.ok(files.includes("LICENSE"));
  assert.ok(files.includes("SECURITY.md"));
  assert.equal(files.some((entry) => entry.startsWith("src/")), true);
  assert.equal(files.some((entry) => entry.startsWith("bin/")), true);
  assert.equal(files.some((entry) => entry.startsWith("docs/")), true);
  assert.equal(files.some((entry) => entry.startsWith("examples/")), false);
  assert.equal(files.some((entry) => entry.startsWith("agent-skills/")), false);
  assert.equal(files.some((entry) => entry.startsWith("test/")), false);
  assert.equal(files.includes(".remogram.json"), false);
  assert.equal(files.includes("skillpress.config.json"), false);
});
