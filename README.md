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
skillpress sync --json --provider codex --tool runlane
```

`status`, `doctor`, and `sync` accept provider, tool, source, contract, and
manifest filters:

```bash
skillpress status --json --manifest skillpress.manifest.json
skillpress doctor --json --provider codex --tool remogram
skillpress sync --json --provider cursor --tool runlane
skillpress sync --json --tool remogram --dry-run
```

By default canonical source is read from `agent-skills/src` and command
contracts are read from `agent-skills/contracts`.

## Canonical Source

Author skill prose once under the repo-owned source tree:

```text
agent-skills/src/{tool}/{skill}/SKILL.md
agent-skills/contracts/{remogram,runlane,topogram}.commands.json
```

Installed roots are targets only:

```text
~/.codex/skills/{skill}/SKILL.md
~/.agents/skills/{skill}/SKILL.md
.cursor/skills/{skill}/SKILL.md
```

Each installed file is rendered with a generated header recording
`source_path`, `source_hash`, `generated_at`, `target`, `tool`, and `skill`.
Do not edit installed provider roots as canonical source.

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

## Verification

`status` and `doctor` compare installed caches to canonical source and report:

- stale or missing generated headers;
- installed body drift from canonical render;
- missing manifest-managed installs;
- unmanaged installed skills when a manifest exists;
- duplicate provider installs whose skill bodies disagree;
- malformed Markdown fences;
- policy drift such as dogfood missing-check waivers, lane `npm link`, hardcoded
  `origin/main`, stale `remogram cr ...` commands, or unjustified fallback
  language;
- command names missing from the local Remogram, Runlane, or Topogram contracts.

## Provider Targets

- `codex`: `~/.codex/skills/{skill}/SKILL.md`
- `agents`: `~/.agents/skills/{skill}/SKILL.md`
- `cursor`: `.cursor/skills/{skill}/SKILL.md`
- `claude-code`: placeholder only; Skillpress does not claim a layout yet.

## Promotion Composition

Skillpress promotes skills only. `promote-cli` promotes CLI binaries only.
Short term, `promote-cli --with-skills` may shell out to:

```bash
skillpress sync --json --tool runlane
```

Long term, closeout flows should call the two boundaries explicitly:

```bash
promote-cli runlane
skillpress sync --json --tool runlane
```

The tools may share manifest facts, but neither imports the other's internals.

## Development

```bash
npm test
npm run check
```
