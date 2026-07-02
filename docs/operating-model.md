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

Directory providers receive full skill directories. Cursor receives a rendered
project rule and reports a warning when auxiliary Agent Skills files cannot be
consumed by that surface.

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
