export const SKILLPRESS_BOUNDARY = Object.freeze({
  schema: "skillpress.boundary",
  version: 1,
  product: "skillpress",
  summary: "Agent skill sync and availability across providers.",
  owns: [
    "Install and sync skills to provider surfaces",
    "Provider-specific install layout and render fidelity",
    "Installed skill manifest with source path, source tree hash, version, sha, and target",
    "Skill freshness status and drift doctor",
    "Source metadata that ties installed skills back to tool versions"
  ],
  provider_targets: [
    "codex",
    "agents",
    "cursor",
    "claude-code",
    "zed",
    "github-copilot",
    "cline",
    "roo",
    "continue",
    "devin",
    "github-copilot-instructions",
    "agents-md"
  ],
  does_not_own: [
    "Skill authoring",
    "A proprietary skill format",
    "Tool binary installation",
    "Lane orchestration, handoffs, or closeout",
    "Workflow proof or SDLC authority",
    "Evidence replay or attestation"
  ],
  invariants: [
    "Canonical skill sources are not installed provider roots",
    "Installed provider roots are caches",
    "Agent Skills directories remain the canonical portable skill shape",
    "Skill drift and security policy checks fail closed",
    "Provider differences live in target adapters, not divergent prose",
    "Skillpress composes with external operator workflows without importing their internals"
  ],
  initial_commands: [
    "skillpress --version",
    "skillpress version --json",
    "skillpress boundary --json",
    "skillpress status --json",
    "skillpress doctor --json",
    "skillpress sync --json [--provider codex|agents|cursor|claude-code|zed|github-copilot|cline|roo|continue|devin|github-copilot-instructions|agents-md] [--tool <tool>]"
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
