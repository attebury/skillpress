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
skillpress --version
skillpress version --json
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
  "policy_packs": ["linter"],
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
`tool-scoped` layout and enables only the `linter` policy pack.

## Commands

```bash
skillpress --version
skillpress version --json
skillpress boundary --json
skillpress repair-plan --json
skillpress status --json
skillpress doctor --json
skillpress sync --json --provider codex --tool runlane
```

Use `skillpress --version` for stable human-readable text and
`skillpress version --json` for repo-independent machine metadata suitable for
release checks, support prompts, and local promotion verification.

`status`, `doctor`, and `sync` accept provider, tool, config, source, contract,
policy, and manifest filters:

```bash
skillpress status --json --manifest skillpress.manifest.json
skillpress doctor --json --provider codex --tool remogram
skillpress sync --json --provider cursor --tool runlane
skillpress sync --json --provider claude-code --tool runlane
skillpress sync --json --tool remogram --dry-run
skillpress doctor --json --policy linter
skillpress doctor --json --config skillpress.config.json
```

Supported source layouts are `auto`, `tool-scoped`, `agent-skills`, and
`claude-skills`.

## Installed Hygiene

Use scoped doctor checks for product gates:

```bash
skillpress doctor --json --tool runlane
```

Use global repair planning for machine-wide installed-skill drift:

```bash
skillpress repair-plan --json
```

`repair-plan` is read-only. It reports resync, source-config, manifest, and
manual-review actions without deleting or rewriting provider caches. See
[docs/installed-hygiene.md](docs/installed-hygiene.md).



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

## Built-in Policy Packs

Skillpress provides core built-in policy packs to validate different aspects of agent skills:

1. **`linter`** (default; formerly named `generic`): Performs core syntax and shape checks:
   - Balances Markdown code fences.
   - Enforces frontmatter metadata structure (requires `name` and `description`).
   - Verifies safety of relative file reference paths.
   - Validates commands against `*.commands.json` contracts.
   *(Note: `"generic"` remains supported as a backward-compatible alias of `"linter"`).*

2. **`dogfood`**: Adds safety checks for repos exercising local toolchains and lane workflows:
   - Rejects missing-check waivers (e.g. `allow_missing_checks`).
   - Rejects lane `npm link` instructions.
   - Rejects hardcoded `origin/main` (requiring `canonical_integration_ref` configuration).
   - Rejects stale `remogram cr ...` commands.
   - Rejects unjustified fallback or shim language.

3. **`security`**: Ensures instruction blocks adhere to secure execution practices:
   - Rejects direct piping of curl outputs to the shell (`curl ... | sh`).
   - Rejects execution of privilege elevation commands (`sudo`).
   - Rejects hardcoded credentials, secret keys, or token assignments.

4. **`ci`**: Protects automation runner runs:
   - Rejects interactive prompts (such as `read -p` or `rm -i`) that block non-interactive runner processes.
   - Rejects arbitrary direct `node <script>.js` executions (requiring teams to declare standard npm run scripts).

5. **`performance`**: Optimizes the size and portability of skills:
   - Rejects hardcoded absolute home paths (like `/Users/username` or `/home/username`).
   - Rejects oversized code blocks containing more than 40 lines (prevents LLM context bloating).

To configure active packs inside `skillpress.config.json`:

```json
{
  "source_roots": [
    { "path": "agent-skills/src", "layout": "tool-scoped" }
  ],
  "contract_root": "agent-skills/contracts",
  "policy_packs": ["linter", "dogfood", "security", "ci"]
}
```


## Custom Policy Packs & Rules

Teams can dynamically define their own custom policy rules and group them into custom policy packs inside `skillpress.config.json` using the `"custom_policy_rules"` property:

```json
{
  "source_roots": [
    { "path": "agent-skills/src", "layout": "tool-scoped" }
  ],
  "policy_packs": ["linter", "custom-security"],
  "custom_policy_rules": [
    {
      "id": "security-no-eval",
      "pattern": "\\beval\\s*\\(",
      "message": "Do not recommend raw 'eval()' calls in instructions",
      "severity": "error",
      "pack": "custom-security"
    },
    {
      "id": "style-avoid-todos",
      "pattern": "todo:",
      "message": "Please remove temporary todo markers before publishing",
      "severity": "warning",
      "pack": "linter"
    }
  ]
}
```

### Custom Policy Rule Properties
* `id`: A unique non-empty string identifier for the lint finding.
* `pattern`: A standard regular expression pattern matched against the skill's file content.
* `message`: The custom error or warning description reported on failure.
* `severity`: Either `"error"` (fails validation) or `"warning"` (reports drift but passes). Optional; defaults to `"error"`.
* `pack`: The name of the policy pack the rule belongs to. Optional; defaults to `"linter"`. Any custom pack name defined here is dynamically registered and can be enabled in `"policy_packs"`.

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

Default providers are `codex`, `agents`, `cursor`, `claude-code`, and `antigravity`. Tool
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
- `antigravity`: `~/.gemini/config/skills/{skill}/SKILL.md` (Antigravity global customizations)
- `agent-skills-global`: `~/.agents/skills/{skill}/SKILL.md` (default global publisher sink)
- `agent-skills-workspace`: `{workspace}/.agents/skills/{skill}/SKILL.md` (default local workspace/lane publisher sink)

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

### Config-Driven Custom Targets

If a team wants to target a custom editor, internal AI agent, or unsupported tool, they can dynamically declare a custom provider (sink) by defining its schema directly inside their local `skillpress.config.json` block:

```json
{
  "providers": [
    {
      "id": "my-team-agent",
      "title": "Custom Team Agent",
      "kind": "skill-directory",
      "root": ".custom-agent/skills",
      "layout": "{root}/{skill}/SKILL.md",
      "fidelity": "full",
      "supports_auxiliary_files": true
    }
  ]
}
```

Supported custom provider schema fields:
- `kind`: `"skill-directory"` (full skill folders), `"rule-directory"` (IDE rule engines), or `"single-instructions-file"`.
- `layout`: Destination path pattern using variables like `{root}`, `{workspace}`, and `{skill}`.
- `fidelity`: `"full"` (replicates everything), `"rule-render"` (compiles instructions), or `"summary"` (one unified markdown summary).
- `supports_auxiliary_files`: Boolean indicating if other assets/attachments are copied.
- `extension` / `entrypoint` / `title` / `surface_kind` / `surface_id`: (Optional) fields to customize file endings, main rule files, and catalog indexing.


## Publishing Skills & Scoping

Skillpress supports deploying portable Agent Skills directly to global customization directories (`~/.agents/skills`) or project-local multi-worktree environments (referred to as a forest/lane structure) using the `publish` command:

```bash
skillpress publish --json --skill <name> [--scope global|forest|tree] [--lanes <lane1,lane2>] [--dry-run]
```

### Scope Resolution Precedence
The publication target scope and destination is evaluated in the following order of priority:
1. **CLI Flags**: `--scope` and `--lanes` direct arguments.
2. **Lanes Root Configuration**: Configured overrides under `publish_rules` inside `skillpress.config.json` at the forest root.
3. **Skill Frontmatter**: Default values specified inside `SKILL.md` frontmatter (e.g. `skillpress_publish_scope: forest`).
4. **System Default**: Defaults to `forest` scope.

### Security Gates & Sandboxing
To protect against malicious code injection when working in untrusted or cloned codebases, the publish pipeline enforces several safety boundaries:
- **Global Elevation Refusal**: A skill cannot request to be published globally via its own frontmatter defaults alone. Global scopes must be explicitly authorized by a local forest configuration rule or passed as a command-line flag (`--scope global`).
- **Traversal Safeguards**: Output paths must be located within valid workspace directories or the user's home customizations folder. Writing to system-sensitive paths (like `/etc`, `/var`, `~/.ssh`) is blocked and fails closed.
- **Config Auditing**: Publishing a skill in a forest automatically generates a `skillpress.config.json` at the lanes root if missing, recording the authorized sync scope.

## Development

```bash
npm test
npm run check
```
