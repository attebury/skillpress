---
name: skillpress-consumer
description: Use Skillpress to sync portable Agent Skills directories, inspect provider drift, and plan install-cache repair.
skillpress_publish_scope: forest
---

# Skillpress Consumer

Skillpress installs canonical Agent Skills directories into provider targets such
as Codex, Claude Code, Cursor project rules, and agent-local skill roots.
Skillpress owns skill discovery, rendering, install manifests, status, doctor,
sync, and repair-plan output. It does not author product skills, promote CLI
binaries, run lane orchestration, or decide workflow evidence.

Start with read-only inspection:

```bash
skillpress status --json
skillpress doctor --json
skillpress repair-plan --json
```

Sync only from canonical source roots:

```bash
skillpress sync --json --tool <tool> --provider codex
skillpress sync --json --config skillpress.config.json --provider cursor
```

Publish portable Agent Skills to customization roots (global, forest, or tree scope):

```bash
skillpress publish --json --skill <name> [--scope global|forest|tree] [--lanes <lane1,lane2>] [--dry-run]
```

Use `publish` to deploy raw `SKILL.md` structures into active workspace worktrees or global customization directories.


Provider roots are install caches. Do not edit `.codex/skills`, `.agents/skills`,
`.claude/skills`, or `.cursor/rules/skillpress` as canonical source.
