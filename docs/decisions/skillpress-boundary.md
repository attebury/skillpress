# Skillpress Boundary

Skillpress owns agent skill sync and availability across providers. It is the
package manager for agent guidance: get the right skills onto the right IDE and
agent surfaces, keep them current, and report drift.

## Owns

- Install and sync skills to Agent Skills directories, agent instruction files,
  and lower-fidelity IDE rule surfaces.
- Provider-specific install layout such as `.codex/skills`, `.agents/skills`,
  `.claude/skills`, `.copilot/skills`, `.cline/skills`, `.roo/skills`,
  `.cursor/rules`, `.continue/rules`, `.devin/rules`,
  `.github/instructions`, and `AGENTS.skillpress.md`.
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
- Provider target modeling for full-fidelity skill directories, rule-directory
  adapters, and single instruction-file adapters.
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

Directory providers receive the full skill directory. Rule-directory providers
receive one rendered rule file per skill, such as
`.cursor/rules/skillpress/{skill}.mdc`, `.continue/rules/{skill}.md`, or
`.github/instructions/skillpress/{skill}.instructions.md`. Single-file
providers receive a combined instruction file such as `AGENTS.skillpress.md`.
When a provider cannot consume auxiliary Agent Skills files, Skillpress reports
`provider_auxiliary_files_omitted` instead of pretending the install has full
Agent Skills semantics.

Each sync render writes a generated header on the installed entrypoint with:

- `source_path`;
- `source_hash`;
- `skill_md_hash`;
- `source_tree_hash`;
- `generated_at`;
- `target`;
- `tool`;
- `skill`.

Manifest entries also record provider surface metadata such as `surface_id`,
`surface_kind`, `fidelity`, provider detection, and whether auxiliary files
were omitted.

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
