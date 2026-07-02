# Skillpress Boundary

Skillpress owns agent skill sync and availability across providers. It is the
package manager for agent guidance: get the right skills onto the right IDE and
agent surfaces, keep them current, and report drift.

## Owns

- Install and sync skills to Cursor, Codex, Claude Code, and agent-local roots.
- Provider-specific install layout such as `.cursor/rules`, `.codex/skills`,
  `.claude/skills`, and `.agents/skills`.
- Installed skill manifests: what is installed, from where, at what
  version or sha, and for which target.
- `sync`, `status`, and `doctor` checks for skill freshness.
- Source metadata that lets installed skills be tied back to tool versions.

## Does Not Own

- Skill authoring. Product repos own their skill prose and contracts.
- Tool binary installation.
- Lane orchestration, handoffs, or closeout. Runlane owns those.
- Workflow proof or SDLC authority. Topogram owns those.
- Evidence replay or attestation. Chronogram and Attegram own those.

## Invariants

- Never edit installed provider roots directly as source of truth.
- Canonical skill sources are rendered into provider roots.
- Installed provider roots are caches.
- Generated installs record source path, source commit or sha, entrypoint hash,
  source tree hash, render target, and generation time.
- Duplicate skill names across roots must match canonical render or fail.
- Security, ownership, readiness, and stack-routing checks fail closed.
- Provider differences live in target adapters, not divergent prose.

## Standards-Compatible Product Shape

The package-manager slice establishes:

- `skillpress boundary --json` for stable ownership data.
- Provider target modeling for Codex, agent-local roots, Claude Code, and
  Cursor project rules.
- Manifest validation for installed skills, including legacy v1 reads and v2
  writes.
- Canonical repo-owned Agent Skills directories under generic
  `skills/{skill}/`, `.claude/skills/{skill}/`, or tool-scoped
  `agent-skills/src/{tool}/{skill}/` source layouts.
- Optional command contracts under `agent-skills/contracts/{tool}.commands.json`
  or any configured `*.commands.json` file.
- `skillpress sync --json` rendering canonical skill directories into provider
  roots.
- `skillpress status --json` and `skillpress doctor --json` verification.
- `skillpress.config.json` for source roots, contract root, provider defaults,
  and policy packs.

Directory providers receive the full skill directory. Cursor receives a rendered
`.cursor/rules/skillpress/{skill}.mdc` project rule. When a Cursor target has
auxiliary Agent Skills files, Skillpress reports that the files cannot be
consumed directly by Cursor's rule surface.

Each sync render writes a generated header on the installed entrypoint with:

- `source_path`;
- `source_hash`;
- `skill_md_hash`;
- `source_tree_hash`;
- `generated_at`;
- `target`;
- `tool`;
- `skill`.

The verifier reports:

- missing manifest-managed installed skills;
- unmanaged installed skills when a manifest exists;
- duplicate skill names across provider roots;
- duplicate skill content conflicts;
- stale or missing generated headers for manifest-managed installs;
- installed-cache drift from canonical source, including auxiliary files;
- unsafe source paths or symlinks;
- missing or malformed Agent Skills frontmatter;
- malformed Markdown fences;
- policy drift from enabled policy packs;
- command-contract drift for configured command snippets.

`sync` runs the same canonical policy and command checks before writing. Bad
canonical source fails closed before provider caches are mutated.

Generic checks and dogfood checks are distinct. External users can run the
generic pack without inheriting tool-dogfood rules. Dogfood repos enable the
dogfood policy pack for missing-check waivers, lane `npm link`, hardcoded
`origin/main`, stale Remogram `cr` commands, and unjustified fallback/shim
language.

## Manifest Boundary

The install manifest records what is expected on disk per provider. It is not a
skill authoring format and does not own the source prose. Each entry records:

- skill id;
- provider target;
- source path or source repository;
- source layout;
- source commit, sha, entrypoint hash, or source tree hash;
- installed entrypoint path;
- installed root;
- copied files;
- optional version.

Manifest paths fail closed when they escape the provider root or use unsafe
segments. Provider roots are target caches, not canonical source trees.

## Runlane Profile

Skillpress uses the Runlane `compact-build-gate-v1` profile:

- `build` owns product implementation and change request creation.
- `gate` owns review, verification, and merge authority.
- No Topogram queue or SDLC records are required for bootstrap.
- Remogram is forge truth when configured.
- Runlane is handoff and authority truth.
