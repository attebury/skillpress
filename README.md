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

The bootstrap slice implements read-only `boundary`, `status`, and `doctor`
JSON commands. `sync` is intentionally not implemented until the verifier is
trustworthy.

`status` and `doctor` accept an optional manifest:

```bash
skillpress status --json --manifest skillpress.manifest.json
skillpress doctor --json --provider codex
```

## Manifest Shape

The first manifest contract is deliberately small:

```json
{
  "schema": "skillpress.install-manifest",
  "version": 1,
  "entries": [
    {
      "skill": "runlane-consumer",
      "provider": "codex",
      "source_path": "agent-skills/src/runlane/runlane-consumer/SKILL.md",
      "source_hash": "sha256:...",
      "installed_path": "~/.codex/skills/runlane-consumer/SKILL.md",
      "version": "0.1.0"
    }
  ]
}
```

Each entry must identify the skill, provider target, source path or source
repo, a source revision/hash, and the installed `SKILL.md` path. Unsafe paths,
unknown providers, and paths outside the provider root fail closed.

## Provider Targets

- `codex`: `~/.codex/skills/{skill}/SKILL.md`
- `agents`: `~/.agents/skills/{skill}/SKILL.md`
- `cursor`: `.cursor/skills/{skill}/SKILL.md`
- `claude-code`: placeholder only; Skillpress does not claim a layout yet.

## Development

```bash
npm test
```
