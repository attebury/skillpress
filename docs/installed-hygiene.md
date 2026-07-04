# Installed Skill Hygiene

Installed provider roots are caches. Canonical skill source lives in repository
source roots, and `skillpress sync` renders those sources into provider
surfaces.

Use scoped doctor checks for product closeout:

```bash
skillpress doctor --json --tool runlane
skillpress doctor --json --tool remogram
```

Use the global repair plan when provider roots drift:

```bash
skillpress repair-plan --json
```

`repair-plan` is read-only. It turns `status` diagnostics into reviewable
actions such as resyncing managed installs, inspecting unmanaged installs,
resolving duplicate conflicts, or fixing source configuration. It does not
delete files, rewrite provider roots, mutate manifests, or make `doctor` pass.

Do not hand-edit installed provider roots as canonical source. If a repair plan
points at duplicate conflicts or unmanaged installs, inspect canonical source
and rerun `skillpress sync` before considering any manual cleanup.
