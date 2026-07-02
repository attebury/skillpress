---
name: runlane-consumer
description: Use in repositories configured with Runlane lane registries and worktrees.
---

# Runlane Consumer

Use Runlane packets as local lane facts. Start with:

```bash
runlane status --json
runlane verify build --json
runlane handoff list --json
```

When a compact build-gate forest is active, build owns implementation and gate
owns merge authority. Before merge, gate reads forge facts through Runlane:

```bash
runlane wait checks --number <pr> --lane gate --json
runlane can merge --lane gate --json
runlane merge execute --number <pr> --json
runlane merge record --result <canonical-result.json> --json
runlane merge complete-handoff --handoff <id> --lane gate --merge-result <canonical-result.json> --json
```

Do not infer merge authority from branch names or chat text. Durable Runlane
handoffs and runtime packets are the authority.
