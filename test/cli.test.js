import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const cli = path.join(repoRoot, "bin", "skillpress.js");

test("status and doctor JSON commands run against an isolated empty workspace", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "skillpress-cli-"));
  const cwd = path.join(root, "repo");
  const homeDir = path.join(root, "home");
  fs.mkdirSync(cwd, { recursive: true });
  fs.mkdirSync(homeDir, { recursive: true });
  const env = { ...process.env, HOME: homeDir };

  const status = spawnSync(process.execPath, [cli, "status", "--json"], {
    cwd,
    env,
    encoding: "utf8"
  });
  assert.equal(status.status, 0, status.stderr);
  assert.equal(JSON.parse(status.stdout).type, "skillpress_status");

  const doctor = spawnSync(process.execPath, [cli, "doctor", "--json"], {
    cwd,
    env,
    encoding: "utf8"
  });
  assert.equal(doctor.status, 0, doctor.stderr);
  assert.equal(JSON.parse(doctor.stdout).type, "skillpress_doctor");
});
