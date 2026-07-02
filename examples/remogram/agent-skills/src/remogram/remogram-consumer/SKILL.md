---
name: remogram-consumer
description: Use Remogram for forge facts such as PR state, checks, and merge plans.
---

# Remogram Consumer

Remogram provides normalized forge facts. Use packet fields instead of forge UI
prose or branch-name guesses.

```bash
remogram repo status --json
remogram pr view --number <pr> --json
remogram pr checks --number <pr> --json
remogram merge plan --number <pr> --json
```

`merge plan` is read-only. It does not authorize merge. Mutating forge commands
require configured write policy.
