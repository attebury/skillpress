# Skillpress Boundary

Skillpress owns agent skill sync and availability across providers. It is the
package manager for agent guidance: get the right skills onto the right IDE and
agent surfaces, keep them current, and report drift.

## Owns

- Install and sync skills to Cursor, Codex, Claude Code, and agent-local roots.
- Provider-specific install layout such as `.cursor/skills`, `.codex/skills`,
  and `.agents/skills`.
- Installed skill manifests: what is installed, from where, at what
  version or sha, and for which target.
- `sync`, `status`, and `doctor` checks for skill freshness.
- Pins from installed skills to promoted tool versions.

## Does Not Own

- Skill authoring. Product repos own their skill prose and contracts.
- CLI binary promotion. `promote-cli` owns binary promotion and npm/link flows.
- Lane orchestration, handoffs, or closeout. Runlane owns those.
- Workflow proof or SDLC authority. Topogram owns those.
- Evidence replay or attestation. Chronogram and Attegram own those.

## Invariants

- Never edit installed provider roots directly as source of truth.
- Canonical skill sources are rendered into provider roots.
- Installed provider roots are caches.
- Generated installs record source path, source commit or sha, source hash,
  render target, and generation time.
- Duplicate skill names across roots must match canonical render or fail.
- Security, ownership, readiness, and stack-routing checks fail closed.
- Provider differences live in target adapters, not divergent prose.

## V1 Product Shape

The v1 package-manager slice establishes:

- `skillpress boundary --json` for stable ownership data.
- Provider target modeling for Codex, agent-local roots, Cursor, and a
  deliberately unknown Claude Code placeholder.
- Manifest validation for installed skills.
- Canonical repo-owned skill source under `agent-skills/src/{tool}/{skill}/SKILL.md`.
- Command contracts under `agent-skills/contracts/{tool}.commands.json`.
- `skillpress sync --json` rendering canonical skills into provider roots.
- `skillpress status --json` and `skillpress doctor --json` verification.

Each sync render writes a generated header with:

- `source_path`;
- `source_hash`;
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
- installed-cache drift from canonical source;
- malformed Markdown fences;
- policy drift for known dangerous skill guidance;
- command-contract drift for Remogram, Runlane, and Topogram command snippets.

`sync` runs the same canonical policy and command checks before writing. Bad
canonical source fails closed before provider caches are mutated.

## Manifest Boundary

The install manifest records what is expected on disk per provider. It is not a
skill authoring format and does not own the source prose. Each entry records:

- skill id;
- provider target;
- source path or source repository;
- source commit, sha, or content hash;
- installed `SKILL.md` path;
- optional version.

Manifest paths fail closed when they escape the provider root or use unsafe
segments. Provider roots are target caches, not canonical source trees.

## Promote-CLI Delegation

Short term, `promote-cli --with-skills` may delegate to Skillpress:

```bash
skillpress sync --json --tool runlane
```

Long term, closeout should compose two explicit steps:

```bash
promote-cli runlane
skillpress sync --json --tool runlane
```

The tools share manifests, not internals. `promote-cli` writes tool integration
state. Skillpress writes installed skill state. Runlane can read both for
status and doctor output without becoming the owner of either boundary.

Compatibility note: the `--with-skills` delegation is only a caller-side shim.
Allowed reason: existing closeout flows may still call that flag while they
migrate to explicit Skillpress sync. It must not make Skillpress responsible
for npm linking, binary promotion, Runlane closeout, or forge lifecycle.

## Runlane Profile

Skillpress uses the Runlane `compact-build-gate-v1` profile:

- `build` owns product implementation and change request creation.
- `gate` owns review, verification, and merge authority.
- No Topogram queue or SDLC records are required for bootstrap.
- Remogram is forge truth when configured.
- Runlane is handoff and authority truth.
