---
name: topogram-core
description: Use for Topogram product maps, generated ownership, and proof boundaries.
---

# Topogram Core

Use Topogram records as workflow and product-structure evidence when a repo
explicitly adopts Topogram. Generic workflow skills must use the configured
`canonical_integration_ref` rather than adapter-specific branch names.

```bash
topogram work status --json
topogram work prep . --base <canonical_integration_ref> --json
```

Do not treat generated output as maintained source unless the local ownership
record says it is editable.
