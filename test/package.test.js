import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

test("package manifest explicitly limits published runtime files", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));

  assert.deepEqual(pkg.files, [
    "agent-skills/",
    "bin/",
    "docs/",
    "src/",
    "README.md",
    "skillpress.config.json"
  ]);
  assert.equal(pkg.files.includes("test/"), false);
  assert.equal(pkg.files.includes(".remogram.json"), false);
});
