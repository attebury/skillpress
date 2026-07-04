# Diagram Telemetry

Skillpress can optionally publish bounded sync and doctor diagnostics to
Diagram. Diagram is a local telemetry ledger only; Skillpress remains the
authority for install policy, provider readiness, manifest drift, and command
exit status.

Enable telemetry per command:

```bash
skillpress sync --json --diagram-telemetry
skillpress doctor --json --diagram-telemetry
```

Or enable it in `skillpress.config.json`:

```json
{
  "diagram": {
    "telemetry": true
  }
}
```

When diagnostics are present, Skillpress builds a
`diagram.diagnostic_event.v1` packet with `producer: "skillpress"` and
`authority: "telemetry_only"`, then records it with:

```bash
diagram event record --file <packet.json> --json
```

The Skillpress result is formed before telemetry is attempted. Diagram failures
add only a bounded `diagram_telemetry.advisories[]` entry when telemetry was
requested; they do not change `ok`, `status`, manifest writes, provider writes,
or exit-code decisions.

Telemetry packets contain issue codes, counts, severity, provider/tool/skill
names, and short deterministic samples. They do not include raw Skillpress
packets, installed skill contents, provider roots, absolute local paths, token
values, command output logs, prompts, environment dumps, or authority claims.

No-go boundaries:

- Diagram cannot approve install, sync, provider, doctor, merge, proof, or
  security readiness.
- Diagram cannot modify provider roots or manifests.
- Diagram cannot open issues, triage Runlane friction, or route lanes.
- Skillpress does not execute telemetry packet text or configurable shell hooks.
