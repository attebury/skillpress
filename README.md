# Skillpress

Skillpress is a package manager for agent guidance. It installs the right
Agent Skills onto the right IDE and agent surfaces, keeps installed caches
fresh, and reports drift.

Skillpress owns skill sync and availability for provider targets such as
Codex, Claude Code, Cursor, and agent-local skill roots. It does not author
skills, install tool binaries, run lane orchestration, or own workflow proof.
It manages Agent Skills-style directories; it does not define a proprietary
skill format.

## Install

```bash
npm install -g skillpress@beta
skillpress boundary --json
```

## Quickstart

Create a generic Agent Skills source root:

```text
skills/{skill}/
  SKILL.md
  scripts/
  references/
  assets/
```

Use a config like:

```json
{
  "source_roots": [
    { "path": "skills", "layout": "agent-skills" }
  ],
  "policy_packs": ["generic"],
  "providers": ["codex", "agents", "cursor"]
}
```

Then sync or inspect:

```bash
skillpress status --json --config skillpress.config.json
skillpress doctor --json --config skillpress.config.json
skillpress sync --json --config skillpress.config.json --provider codex
skillpress sync --json --source-root skills --source-layout agent-skills
```

With no config, Skillpress looks for `agent-skills/src` using the
`tool-scoped` layout and enables only the `generic` policy pack.

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
skillpress status --json --manifest skillpress.manifest.json
skillpress doctor --json --provider codex --tool remogram
skillpress sync --json --provider cursor --tool runlane
skillpress sync --json --provider claude-code --tool runlane
skillpress sync --json --tool remogram --dry-run
skillpress doctor --json --policy generic
```

Supported source layouts are `auto`, `tool-scoped`, `agent-skills`, and
`claude-skills`.

## Diagram Telemetry

`sync` and `doctor` can opt into local Diagram telemetry:

```bash
skillpress doctor --json --diagram-telemetry
```

Or configure:

```json
{
  "diagram": {
    "telemetry": true
  }
}
```

Skillpress emits bounded `diagram.diagnostic_event.v1` summaries only after its
own command packet is complete. Diagram is telemetry-only and cannot change
Skillpress command status, provider readiness, manifest drift, sync writes, or
exit codes. See [docs/diagram-telemetry.md](docs/diagram-telemetry.md).

## Source Layouts

Generic Agent Skills roots use one directory per skill:

```text
skills/{skill}/SKILL.md
.claude/skills/{skill}/SKILL.md
```

Tool-scoped sources support multi-tool repositories:

```text
agent-skills/src/{tool}/{skill}/
  SKILL.md
  scripts/
  references/
  assets/
agent-skills/contracts/{tool}.commands.json
```

`auto` maps `.claude/skills` to `claude-skills`, maps `agent-skills/src` to
`tool-scoped`, and otherwise uses `agent-skills`.

Installed roots are targets only:

```text
~/.codex/skills/{skill}/
~/.agents/skills/{skill}/
~/.claude/skills/{skill}/
.cursor/rules/skillpress/{skill}.mdc
```

Skillpress models provider surfaces by fidelity:

- `skill-directory`: full Agent Skills directory copy, including auxiliary
  files.
- `rule-directory`: one rendered rule or instruction file per skill; auxiliary
  files are omitted with a warning.
- `single-instructions-file`: an opt-in generated instruction file; auxiliary
  files are omitted with a warning.

Directory providers receive the full skill directory. Rule providers receive a
rendered view of `SKILL.md` because their native surfaces are rules or custom
instructions. If a rule target has auxiliary skill files, `sync` and `status`
warn that the provider cannot consume those files directly.

Each installed entrypoint is rendered with a generated header recording
`source_path`, `source_hash`, `skill_md_hash`, `source_tree_hash`,
`generated_at`, `target`, `tool`, and `skill`. Do not edit installed provider
roots as canonical source.

## Dogfood Policy Pack

The optional `dogfood` policy pack is not a source layout. It adds safety
checks for repos exercising local toolchains and lane workflows:

```json
{
  "source_roots": [
    { "path": "agent-skills/src", "layout": "tool-scoped" }
  ],
  "contract_root": "agent-skills/contracts",
  "policy_packs": ["generic", "dogfood"]
}
```

The pack rejects missing-check waivers, lane `npm link`, hardcoded
`origin/main`, stale `remogram cr ...` commands, and unjustified fallback or
shim language. External users can run the `generic` pack without inheriting
dogfood rules.

## Examples

Runlane and Remogram example projects live under `examples/runlane` and
`examples/remogram`. They demonstrate tool-scoped sources, command contracts,
and the optional dogfood policy pack. Examples are repo documentation and test
fixtures; they are excluded from the npm package.

Dogfood forge identity is local runtime config. Keep machine-local forge and
tool config ignored. Tracked examples may provide `.example` templates, but
runtime credentials and private forge identity must stay outside the public
package.

## Manifest Shape

The install manifest is local provider state. By default, Skillpress writes it
outside the source checkout:

- inside Git worktrees: `git rev-parse --git-path skillpress/install-manifest.local.json`;
- outside Git worktrees: `${XDG_STATE_HOME:-~/.local/state}/skillpress/install-manifests/<cwd-hash>/install-manifest.local.json`.

Use `--manifest <path>` or config `{"manifest":{"path":"..."}}` only when you
intentionally want a specific local manifest path. A root
`skillpress.manifest.json` is treated as a legacy explicit install manifest;
implicit `sync`, `status`, and `doctor` warn and ignore it. Pass
`--manifest skillpress.manifest.json` to inspect or migrate one deliberately.

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
      "source_layout": "tool-scoped",
      "installed_path": "~/.codex/skills/runlane-consumer/SKILL.md",
      "installed_root": "~/.codex/skills/runlane-consumer",
      "files": ["SKILL.md", "scripts/verify.js"]
    }
  ]
}
```

Version 1 manifests remain readable for status and doctor; the next sync writes
version 2. Historical `source_layout` metadata remains readable, but Skillpress
validates configured source layouts against the current public layout list.

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

## Provider Targets

Default providers are `codex`, `agents`, `cursor`, and `claude-code`. Tool
specific home providers such as Codex and Claude Code are optional by default:
if their local config directory is absent, default sync/status/doctor reports a
`provider_unavailable` warning and skips that target. Explicit
`--provider <id>` and configured `required: true` providers fail closed when
the provider is unavailable.

Full Agent Skills directory providers:

- `codex`: `~/.codex/skills/{skill}/SKILL.md`
- `agents`: `~/.agents/skills/{skill}/SKILL.md`
- `claude-code`: `~/.claude/skills/{skill}/SKILL.md`
- `zed`: `~/.agents/skills/{skill}/SKILL.md`
- `github-copilot`: `~/.copilot/skills/{skill}/SKILL.md`
- `cline`: `~/.cline/skills/{skill}/SKILL.md`
- `roo`: `~/.roo/skills/{skill}/SKILL.md`

Rule and instruction render providers:

- `cursor`: `.cursor/rules/skillpress/{skill}.mdc`
- `continue`: `.continue/rules/{skill}.md`
- `devin`: `.devin/rules/{skill}.md`
- `github-copilot-instructions`: `.github/instructions/skillpress/{skill}.instructions.md`
- `agents-md`: `AGENTS.skillpress.md`

Provider config entries can be strings or objects:

```json
{
  "providers": [
    "agents",
    { "id": "claude-code", "required": true },
    { "id": "codex", "root": ".skillpress/codex-skills", "allow_undetected": true }
  ]
}
```

Custom roots are validated as local paths. Skillpress does not execute provider
binaries for detection and does not install IDEs or CLIs.

## Development

```bash
npm test
npm run check
```
