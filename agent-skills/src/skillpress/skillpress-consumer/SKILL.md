---
name: skillpress-consumer
description: Use Skillpress to sync portable Agent Skills directories, inspect provider drift, plan install-cache repair, and record bounded Diagram telemetry for Skillpress diagnostics.
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

Provider roots are install caches. Do not edit `.codex/skills`, `.agents/skills`,
`.claude/skills`, or `.cursor/rules/skillpress` as canonical source.

## Diagram Telemetry

Diagram is telemetry only. It does not approve installs, suppress Skillpress
diagnostics, satisfy doctor, satisfy release gates, route lanes, or open issues.

Use field-based emission when a Skillpress diagnostic is worth recording:

```bash
diagram event emit --producer skillpress --event-kind friction \
  --classification resource_failure --impact advisory \
  --scope repo=<repo> --scope tool=<tool> \
  --scope command="skillpress doctor --json --tool <tool>" \
  --expected "installed provider caches match canonical Skillpress sources and manifests" \
  --actual "Skillpress doctor reported installed skill drift" \
  --evidence-ref command="skillpress doctor --json --tool <tool>" \
  --evidence-snippet summary="installed_skill_drift count=1" \
  --suggested-owner skillpress \
  --suggested-next-action "run skillpress repair-plan --json --tool <tool>" \
  --json
```

For command contract gaps:

```bash
diagram event emit --producer skillpress --event-kind friction \
  --classification cli_contract_gap --impact blocking \
  --scope repo=<repo> --scope tool=<tool> \
  --scope command="skillpress doctor --json" \
  --expected "skill command references match loaded command contracts" \
  --actual "Skillpress reported command_contract_unknown" \
  --evidence-ref command="skillpress doctor --json" \
  --evidence-snippet summary="command_contract_unknown count=1" \
  --suggested-owner skillpress \
  --suggested-next-action "update the command contract or the skill command reference" \
  --json
```

Never emit raw `SKILL.md` content, generated headers, local absolute paths, home
paths, temp paths, credential URLs, token values, environment dumps, prompts,
provider-private payloads, raw logs, or shell-control command refs.

Native emission is opt-in:

```bash
skillpress doctor --json --diagram-telemetry
skillpress status --json --diagram-telemetry
skillpress sync --json --tool <tool> --provider codex --diagram-telemetry
```

If Diagram is unavailable or rejects an event, Skillpress command outcomes remain
based only on Skillpress diagnostics.
