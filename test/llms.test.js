import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const llmsPath = path.join(repoRoot, "llms.txt");

function publicPathForLink(url) {
  const parsed = new URL(url);

  if (parsed.hostname === "raw.githubusercontent.com") {
    const prefix = "/attebury/skillpress/main/";
    assert.ok(parsed.pathname.startsWith(prefix), `${url} must target the public Skillpress repo`);
    return parsed.pathname.slice(prefix.length);
  }

  if (parsed.hostname === "github.com") {
    const prefix = "/attebury/skillpress/tree/main/";
    assert.ok(parsed.pathname.startsWith(prefix), `${url} must target the public Skillpress repo`);
    return parsed.pathname.slice(prefix.length);
  }

  assert.fail(`${url} must target github.com or raw.githubusercontent.com`);
}

test("llms.txt follows the public llms.txt shape", () => {
  const text = fs.readFileSync(llmsPath, "utf8");

  assert.match(text, /^# Skillpress\n\n> /);
  assert.equal([...text.matchAll(/^# /gm)].length, 1);
  assert.match(text, /^## Start Here$/m);
  assert.match(text, /^## Source$/m);
  assert.match(text, /^## Release$/m);
  assert.match(text, /^## Optional$/m);

  const links = [...text.matchAll(/^- \[[^\]]+\]\((https:\/\/[^)]+)\): .+$/gm)];
  assert.ok(links.length >= 10);
});

test("llms.txt links to tracked public files or directories", () => {
  const text = fs.readFileSync(llmsPath, "utf8");
  const urls = [...text.matchAll(/\[[^\]]+\]\((https:\/\/[^)]+)\)/g)].map((match) => match[1]);

  for (const url of urls) {
    const rel = publicPathForLink(url);
    assert.ok(fs.existsSync(path.join(repoRoot, rel)), `${url} must point at a tracked public path`);
  }
});

test("llms.txt avoids local-only release markers", () => {
  const text = fs.readFileSync(llmsPath, "utf8");
  const forbidden = [
    "/Users/" + "attebury",
    "localhost:" + "3000",
    "." + "runlane/forge-authority",
    "GITEA_" + "TOKEN",
    "REMOGRAM_" + "OPERATOR_CONFIG"
  ];

  for (const marker of forbidden) {
    assert.equal(text.includes(marker), false, `llms.txt contains ${marker}`);
  }
});
