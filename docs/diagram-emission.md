# Diagram Emission

Skillpress can emit bounded Diagram telemetry for selected sync, status, and
doctor diagnostics. Emission is opt-in with `--diagram-telemetry` and happens
after Skillpress has already computed the command packet.

Diagram is a ledger, not an authority. A Diagram event cannot approve installs,
make `doctor` pass, suppress policy findings, satisfy release checks, route
Runlane handoffs, or write forge state.

## Commands

```bash
skillpress status --json --diagram-telemetry
skillpress doctor --json --diagram-telemetry
skillpress sync --json --tool <tool> --provider codex --diagram-telemetry
```

Skillpress calls `diagram event emit` with scalar and repeated field flags. It
does not build Diagram JSON event files.

## Emitted Diagnostics

Skillpress emits only selected diagnostics:

- installed skill drift and missing managed installs
- manifest hash or source-tree staleness
- duplicate skill content conflicts
- command contract gaps
- sync errors
- provider unavailable and auxiliary-file fidelity warnings

Large diagnostic sets are grouped by command, code, severity, provider, and
tool. Evidence contains counts and small stable samples, not raw skill content.

## Safety Rules

Skillpress does not send raw `SKILL.md` content, generated headers, raw command
packets, logs, prompts, environment dumps, provider-private payloads, credential
URLs, token values, home paths, temp paths, provider roots, or shell-control
command refs.

If the Diagram CLI is missing, exits non-zero, rejects fields, or returns
malformed JSON, Skillpress adds bounded advisory metadata under
`diagram_telemetry`. The original command `ok`, `status`, findings, writes, and
exit behavior remain Skillpress-owned.
