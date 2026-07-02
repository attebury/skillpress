# Release Skillpress

Skillpress releases use a split-forge flow. Local dogfood work stays on the
private forge checkout. GitHub receives a cleaned public export tree.

## Release Steps

1. Verify the local dogfood checkout:

   ```bash
   npm test
   runlane verify --all-lanes --json
   ```

2. Build the public export tree:

   ```bash
   scripts/export-public-main.sh
   ```

   The export script fails on a dirty checkout because it exports `HEAD`.

3. Inspect the export at `/tmp/skillpress-public`.

4. Push the export to GitHub:

   ```bash
   cd /tmp/skillpress-public
   git remote add origin git@github.com:attebury/skillpress.git
   git push -u origin main --force
   ```

5. Confirm GitHub Actions pass on `main`.

6. Publish the beta package:

   ```bash
   npm publish --tag beta
   ```

7. Smoke install:

   ```bash
   npm install -g skillpress@beta
   skillpress boundary --json
   ```

## Release Rules

- Do not repoint the dogfood `origin`.
- Run the export from a clean, committed checkout.
- Do not commit runtime forge credentials or local provider roots.
- Keep `.remogram.json`, generated manifests, and lane state out of the public
  export.
- Use the `beta` npm tag until external install and update flows settle.
