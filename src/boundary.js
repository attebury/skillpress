export const SKILLPRESS_BOUNDARY = Object.freeze({
  schema: "skillpress.boundary",
  version: 1,
  product: "skillpress",
  summary: "Agent skill sync and availability across providers.",
  owns: [
    "Install and sync skills to provider surfaces",
    "Provider-specific install layout",
    "Installed skill manifest with source, version, sha, and target",
    "Skill freshness status and drift doctor",
    "Pins from skills to promoted tool versions"
  ],
  provider_targets: [
    "codex",
    "cursor",
    "claude-code",
    "agents"
  ],
  does_not_own: [
    "Skill authoring",
    "CLI binary promotion",
    "Lane orchestration, handoffs, or closeout",
    "Workflow proof or SDLC authority",
    "Evidence replay or attestation"
  ],
  invariants: [
    "Canonical skill sources are not installed provider roots",
    "Installed provider roots are caches",
    "Skill drift and security policy checks fail closed",
    "Provider differences live in target adapters, not divergent prose",
    "Skillpress composes with promote-cli and Runlane without importing their internals"
  ],
  initial_commands: [
    "skillpress boundary --json",
    "skillpress status --json",
    "skillpress doctor --json",
    "skillpress sync --json [--provider codex|agents|cursor] [--tool <tool>]"
  ]
});

export function boundaryPacket() {
  return {
    ok: true,
    type: "skillpress_boundary",
    schema_version: 1,
    boundary: SKILLPRESS_BOUNDARY
  };
}
