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

## Promote-CLI Delegation

Short term, `promote-cli --with-skills` may delegate to Skillpress:

```bash
skillpress sync --tool runlane
```

Long term, closeout should compose two explicit steps:

```bash
promote-cli runlane
skillpress sync --tool runlane
```

The tools share manifests, not internals. `promote-cli` writes tool integration
state. Skillpress writes installed skill state. Runlane can read both for
status and doctor output without becoming the owner of either boundary.

## Runlane Profile

Skillpress uses the Runlane `compact-build-gate-v1` profile:

- `build` owns product implementation and change request creation.
- `gate` owns review, verification, and merge authority.
- No Topogram queue or SDLC records are required for bootstrap.
- Remogram is forge truth when configured.
- Runlane is handoff and authority truth.

