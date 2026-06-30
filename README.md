# Skillpress

Skillpress is the package manager for agent guidance. It installs the right
skills onto the right IDE and agent surfaces, keeps those installed caches
fresh, and reports drift.

Skillpress owns sync and availability for provider skill roots such as Codex,
Cursor, Claude Code, and agent-local skill roots. It does not author the
skills, promote CLI binaries, run lane orchestration, or own workflow proof.

## Commands

```bash
skillpress boundary --json
skillpress status --json
skillpress doctor --json
skillpress sync --provider codex --tool runlane
```

Only `boundary --json` is implemented in the bootstrap slice.

## Development

```bash
npm test
```

