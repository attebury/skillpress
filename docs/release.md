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

3. Export, scan, inspect package contents, stage locally, and verify the report
   bundle:

   ```bash
   releasepress export --json --config releasepress.config.json --out /tmp/skillpress-public-tree
   releasepress scan --json --config releasepress.config.json --path /tmp/skillpress-public-tree
   releasepress package --json --config releasepress.config.json
   releasepress stage --json --config releasepress.config.json --path /tmp/skillpress-public-tree
   releasepress checklist --json --config releasepress.config.json --path /tmp/skillpress-public-tree
   releasepress verify --json --config releasepress.config.json --path /tmp/skillpress-public-tree
   ```

4. Review `/tmp/skillpress-public-tree` and its `.releasepress-report/`
   bundle. The root `releasepress.config.json` is source-release machinery and
   is intentionally excluded from the exported tree.

5. Promote the reviewed clean checkout to the local operator shim when local
   use should override the npm-global install:

   ```bash
   releasepress promote local --json --config releasepress.config.json --path /tmp/skillpress-public-tree --approve-local
   ```

6. Push the reviewed exported tree to GitHub and confirm GitHub Actions pass on
   `main`.

7. Publish the beta package only after the exported tree and package surface
   are accepted:

   ```bash
   npm publish --tag beta
   ```

8. Smoke install:

   ```bash
   npm install -g skillpress@beta
   skillpress boundary --json
   ```

## Release Rules

- Publish only from a clean, committed checkout.
- Do not include runtime forge credentials, local provider roots, generated
  manifests, lane state, or local export tooling in the exported public tree.
- Keep public GitHub and npm promotion disabled in `releasepress.config.json`
  unless the operator explicitly enables and approves those surfaces. Local
  promotion may install the clean checkout as `skillpress` in the operator
  tools bin directory.
- Keep the npm `files` allowlist limited to runtime package files and public
  docs.
- Use the `beta` npm tag until external install and update flows settle.
