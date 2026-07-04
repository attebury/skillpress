# Release Skillpress

Skillpress uses Releasepress for public release hygiene. Skillpress still owns
skill discovery, provider sync, manifests, and policy checks. Releasepress owns
the allowlist-first public tree, scan reports, npm package surface inspection,
local staging, and release checklist verification.

## Release Steps

1. Verify the source checkout:

   ```bash
   npm test
   NPM_CONFIG_CACHE=/tmp/skillpress-npm-cache npm pack --dry-run --json
   ```

2. Build and inspect the Releasepress plan:

   ```bash
   releasepress boundary --json
   releasepress plan --json --config releasepress.config.json
   ```

3. Export, scan, inspect package contents, stage locally, publish the local
   review ref, attest the inspected candidate, and verify the report bundle:

   ```bash
   releasepress export --json --config releasepress.config.json --out /tmp/skillpress-public-tree
   releasepress scan --json --config releasepress.config.json --path /tmp/skillpress-public-tree
   releasepress package --json --config releasepress.config.json
   releasepress stage --json --config releasepress.config.json --path /tmp/skillpress-public-tree
   releasepress public-review --json --config releasepress.config.json --path /tmp/skillpress-public-tree
   releasepress attest-review --json --config releasepress.config.json --path /tmp/skillpress-public-tree --approve-public-review --reviewer operator --reason "inspected Skillpress public review repo"
   releasepress checklist --json --config releasepress.config.json --path /tmp/skillpress-public-tree
   releasepress verify --json --config releasepress.config.json --path /tmp/skillpress-public-tree
   ```

4. Review `/tmp/skillpress-public-tree`, the local review ref configured by
   `local-public-review`, and the `.releasepress-report/` bundle. The root
   `releasepress.config.json` is source-release machinery and is intentionally
   excluded from the exported tree.

5. Promote the reviewed clean checkout to the local operator shim when local
   use should override the npm-global install:

   ```bash
   releasepress promote local --json --config releasepress.config.json --path /tmp/skillpress-public-tree --approve-local
   ```

6. Launch the reviewed providers only after the report bundle verifies and the
   operator approves the exact public surfaces:

   ```bash
   releasepress promote provider github-public --json --config releasepress.config.json --path /tmp/skillpress-public-tree --approve-public github-public
   releasepress promote provider npm-beta --json --config releasepress.config.json --path /tmp/skillpress-public-tree --approve-public npm-beta
   ```

   To launch every enabled public provider in one gated operation:

   ```bash
   releasepress promote public --json --config releasepress.config.json --path /tmp/skillpress-public-tree --approve-public public
   ```

7. Confirm GitHub Actions pass on `main`, then smoke install:

   ```bash
   npm install -g skillpress@beta
   skillpress boundary --json
   ```

## Release Rules

- Publish only from a clean, committed checkout.
- Do not include runtime forge credentials, local provider roots, generated
  manifests, lane state, or local export tooling in the exported public tree.
- Keep GitHub and npm delivery in Releasepress provider entries. Public launch
  still requires explicit `releasepress promote provider <id>` or
  `releasepress promote public` approval after review attestation and verify
  pass. Local promotion may install the clean checkout as `skillpress` in the
  operator tools bin directory.
- The configured `npm-beta` provider launcher runs `npm publish --tag beta`
  only inside the Releasepress provider gate.
- Keep the npm `files` allowlist limited to runtime package files and public
  docs.
- Use the `beta` npm tag until external install and update flows settle.
