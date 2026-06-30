import test from "node:test";
import assert from "node:assert/strict";
import { lintMarkdownFences, parseGeneratedHeader } from "../src/skill-lint.js";

test("markdown fence lint catches unclosed fences", () => {
  assert.deepEqual(lintMarkdownFences("```js\nconsole.log(1);\n```\n"), []);
  const findings = lintMarkdownFences("```js\nconsole.log(1);\n");
  assert.equal(findings.length, 1);
  assert.equal(findings[0].code, "markdown_fence_unbalanced");
});

test("generated header parser reads key value fields", () => {
  const header = parseGeneratedHeader([
    "<!-- skillpress",
    "source_path: agent-skills/src/runlane/runlane-consumer/SKILL.md",
    "source_hash: sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "target: codex",
    "-->",
    "# Runlane"
  ].join("\n"));

  assert.equal(header.present, true);
  assert.equal(header.fields.target, "codex");
  assert.equal(header.errors.length, 0);
});
