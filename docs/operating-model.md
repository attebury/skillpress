# Skillpress Operating Model

Skillpress is operator infrastructure for agent guidance. Product repositories
author skills; Skillpress renders and installs those skills onto provider
surfaces and reports drift.

## Source And Targets

Canonical source:

```text
agent-skills/src/{tool}/{skill}/SKILL.md
agent-skills/contracts/{tool}.commands.json
```

Install targets:

```text
~/.codex/skills/{skill}/SKILL.md
~/.agents/skills/{skill}/SKILL.md
.cursor/skills/{skill}/SKILL.md
```

Claude Code remains a modeled provider with no claimed install layout until the
layout is verified.

## Promotion Composition

Closeout should compose binaries and skills as separate boundaries:

```bash
promote-cli runlane
skillpress sync --json --tool runlane
```

Short-term compatibility may let `promote-cli --with-skills` delegate by
spawning `skillpress sync --json --tool <tool>`. Allowed reason: existing
closeout flows may still call that flag while they migrate to explicit
Skillpress sync. That delegation must remain a caller shim:

- Skillpress does not run npm link or binary promotion.
- Skillpress does not merge, close handoffs, or repair lane worktrees.
- Skillpress does not import promote-cli internals.
- promote-cli does not write Skillpress installed-skill manifests directly.

## Verification Rules

Run before and after promotion:

```bash
skillpress status --json
skillpress doctor --json
```

`sync` also verifies canonical source before mutating provider roots. It fails
closed on malformed Markdown, unsafe source paths, policy drift, and command
contract drift.

## Open-Source Constraints

The repository should stay free of machine-local credentials and private lane
state. Tests must use temp HOME/workspace roots and must not read or mutate real
installed provider roots.

The manifest schema is versioned. Changes to manifest fields, provider layouts,
or generated headers need tests that cover old bad input and the intended new
shape.
