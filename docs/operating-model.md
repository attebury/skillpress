# Skillpress Operating Model

Skillpress is operator infrastructure for agent guidance. Product repositories
author skills; Skillpress renders and installs those skills onto provider
surfaces and reports drift.

## Source And Targets

Tool-scoped source:

```text
agent-skills/src/{tool}/{skill}/
  SKILL.md
  scripts/
  references/
  assets/
agent-skills/contracts/{tool}.commands.json
```

Generic Agent Skills layouts are also supported through `skillpress.config.json`
and are the public quickstart shape:

```text
skills/{skill}/SKILL.md
.claude/skills/{skill}/SKILL.md
```

Install targets:

```text
~/.codex/skills/{skill}/
~/.agents/skills/{skill}/
~/.claude/skills/{skill}/
.cursor/rules/skillpress/{skill}.mdc
```

Provider classes:

- `skill-directory`: full Agent Skills directory copy. Codex, Agents,
  Claude Code, Zed, GitHub Copilot, Cline, and Roo use this class.
- `rule-directory`: one rendered rule/custom-instruction file per skill.
  Cursor, Continue, Devin/Cascade, and Copilot custom instructions use this
  class.
- `single-instructions-file`: opt-in generated instruction file. The generic
  `agents-md` target writes `AGENTS.skillpress.md`.

Rule and single-file providers are lower fidelity than Agent Skills
directories. They render `SKILL.md` guidance and preserve generated provenance
headers, but they cannot directly consume `scripts/`, `references/`, `assets/`,
or other auxiliary files. Sync/status/doctor must report structured
`provider_auxiliary_files_omitted` warnings when that fidelity loss applies.

Some provider ids intentionally share install surfaces. `zed` and `agents`
both target `.agents/skills`. Treat shared surfaces as first-class surfaces, not
as duplicate provider roots. Sync should avoid duplicate writes for the same
surface and status should avoid false duplicate-drift reports for intentional
surface sharing.

Provider availability:

- Default providers are optional unless configured with `required: true`.
- Missing optional providers produce `provider_unavailable` warnings and are
  skipped for sync writes.
- Explicit `--provider <id>` fails closed when the provider is unavailable.
- Configured provider roots may opt into prepared installs with
  `allow_undetected: true`; manifests must record that the provider was not
  detected.
- Detection must use deterministic local filesystem facts. Do not execute IDE
  binaries or shell hooks for provider detection.

Dogfood examples enable both policy packs:

```json
{
  "policy_packs": ["generic", "dogfood"]
}
```

External users can run only `generic`.

## Verification Rules

Run before and after sync:

```bash
skillpress status --json
skillpress doctor --json
```

`sync` also verifies canonical source before mutating provider roots. It fails
closed on malformed Agent Skills frontmatter, malformed Markdown, unsafe source
paths, symlinks, dogfood policy drift when that pack is enabled, and configured
command contract drift.

## Open-Source Constraints

The repository should stay free of machine-local credentials and private lane
state. Keep machine-local forge and tool config ignored. Tracked examples may
provide `.example` templates, but runtime credentials and private forge identity
must stay outside the public package. Tests must use temp HOME/workspace roots
and must not read or mutate real installed provider roots.

The manifest schema is versioned. Version 1 remains readable; version 2 is the
write target and records installed entrypoint, installed root, copied files,
skill entrypoint hash, source tree hash, and optional source commit. Changes to
manifest fields, provider layouts, or generated headers need tests that cover
old bad input and the intended new shape.

Install manifests are local runtime receipts, not canonical source. Default
sync/status/doctor manifest discovery writes and reads Git-local state via
`git rev-parse --git-path skillpress/install-manifest.local.json`, with an XDG
state fallback outside Git worktrees. Root `skillpress.manifest.json` is a
legacy explicit path only; implicit commands warn and ignore it so provider
sync does not dirty product source checkouts.
