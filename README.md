# Skillpress

Skillpress is the package manager for agent guidance. It installs the right
skills onto the right IDE and agent surfaces, keeps those installed caches
fresh, and reports drift.

Skillpress owns sync and availability for provider skill roots such as Codex,
Cursor, Claude Code, and agent-local skill roots. It does not author the
skills, promote CLI binaries, run lane orchestration, or own workflow proof.
It manages Agent Skills-style directories; it does not define a proprietary
skill format.

## Commands

```bash
skillpress boundary --json
skillpress status --json
skillpress doctor --json
skillpress sync --json --provider codex --tool runlane
```

`status`, `doctor`, and `sync` accept provider, tool, config, source, contract,
policy, and manifest filters:

```bash
skillpress status --json --config skillpress.config.json
skillpress status --json --manifest skillpress.manifest.json
skillpress doctor --json --provider codex --tool remogram
skillpress sync --json --provider cursor --tool runlane
skillpress sync --json --provider claude-code --tool runlane
skillpress sync --json --tool remogram --dry-run
skillpress sync --json --source-root skills --source-layout agent-skills
skillpress doctor --json --policy generic,atteway
```

By default canonical source is read from `agent-skills/src` and command
contracts are read from `agent-skills/contracts`. A `skillpress.config.json`
can override source roots, provider defaults, policy packs, and contract root.

```json
{
  "source_roots": [
    { "path": "agent-skills/src", "layout": "atteway" }
  ],
  "contract_root": "agent-skills/contracts",
  "policy_packs": ["generic", "atteway"],
  "providers": ["codex", "agents", "cursor", "claude-code"]
}
```

## Canonical Source

Author skill prose once under a repo-owned Agent Skills directory. The Atteway
convention is:

```text
agent-skills/src/{tool}/{skill}/
  SKILL.md
  scripts/
  references/
  assets/
agent-skills/contracts/{tool}.commands.json
```

Generic Agent Skills roots are also supported:

```text
skills/{skill}/SKILL.md
.claude/skills/{skill}/SKILL.md
```

Installed roots are targets only:

```text
~/.codex/skills/{skill}/
~/.agents/skills/{skill}/
~/.claude/skills/{skill}/
.cursor/rules/skillpress/{skill}.mdc
```

Directory providers receive the full skill directory. Cursor receives a rendered
project rule because Cursor's first-class project surface is `.cursor/rules`.
If a Cursor target has auxiliary skill files, `sync` and `status` warn that
Cursor cannot consume those files directly.

Each installed entrypoint is rendered with a generated header recording
`source_path`, `source_hash`, `skill_md_hash`, `source_tree_hash`,
`generated_at`, `target`, `tool`, and `skill`. Do not edit installed provider
roots as canonical source.

## Manifest Shape

The manifest is versioned. Version 2 records both entrypoint and tree facts:

```json
{
  "schema": "skillpress.install-manifest",
  "version": 2,
  "entries": [
    {
      "skill": "runlane-consumer",
      "provider": "codex",
      "source_path": "agent-skills/src/runlane/runlane-consumer/SKILL.md",
      "source_root_path": "agent-skills/src/runlane/runlane-consumer",
      "source_hash": "sha256:...",
      "skill_md_hash": "sha256:...",
      "source_tree_hash": "sha256:...",
      "source_commit": "b4c390d...",
      "source_layout": "atteway",
      "installed_path": "~/.codex/skills/runlane-consumer/SKILL.md",
      "installed_root": "~/.codex/skills/runlane-consumer",
      "files": ["SKILL.md", "scripts/verify.js"]
    }
  ]
}
```

Each entry must identify the skill, provider target, source path or source
repo, a source revision/hash, and the installed entrypoint path. Unsafe paths,
unknown providers, and paths outside the provider root fail closed. Version 1
manifests remain readable for status and doctor; the next sync writes version 2.

## Verification

`status` and `doctor` compare installed caches to canonical source and report:

- stale or missing generated headers;
- installed entrypoint or auxiliary-file drift from canonical render;
- missing manifest-managed installs;
- unmanaged installed skills when a manifest exists;
- duplicate provider installs whose skill bodies disagree;
- unsafe source paths or symlinks;
- missing or malformed Agent Skills frontmatter;
- malformed Markdown fences;
- policy drift from enabled policy packs;
- command names missing from configured `*.commands.json` contracts.

Policy packs are split:

- `generic`: Agent Skills shape, Markdown, references, duplicate/drift checks,
  and configured command contracts.
- `atteway`: dogfood missing-check waivers, lane `npm link`, hardcoded
  `origin/main`, stale `remogram cr ...` commands, and unjustified fallback
  language.

## Provider Targets

- `codex`: `~/.codex/skills/{skill}/SKILL.md`
- `agents`: `~/.agents/skills/{skill}/SKILL.md`
- `claude-code`: `~/.claude/skills/{skill}/SKILL.md`
- `cursor`: `.cursor/rules/skillpress/{skill}.mdc`

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
