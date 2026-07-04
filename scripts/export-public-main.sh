#!/usr/bin/env bash
# Build a clean public Skillpress tree from the current dogfood checkout.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:-/tmp/skillpress-public}"
GITHUB_REMOTE="${GITHUB_REMOTE:-git@github.com:attebury/skillpress.git}"
NPM_CACHE="${NPM_CONFIG_CACHE:-/tmp/skillpress-npm-cache}"

PUBLIC_PATHS=(
  ".github/workflows/test.yml"
  ".gitignore"
  ".remogram.json.example"
  "LICENSE"
  "README.md"
  "SECURITY.md"
  "bin"
  "docs/decisions/skillpress-boundary.md"
  "docs/diagram-telemetry.md"
  "docs/installed-hygiene.md"
  "docs/operating-model.md"
  "docs/release.md"
  "examples"
  "llms.txt"
  "package.json"
  "src"
  "test"
)

if [ -n "$(git -C "${ROOT}" status --porcelain)" ]; then
  echo "Public export requires a clean committed checkout because it exports HEAD." >&2
  exit 1
fi

echo "Exporting public tree to ${OUT}..."
rm -rf "${OUT}"
mkdir -p "${OUT}"

git -C "${ROOT}" archive HEAD -- "${PUBLIC_PATHS[@]}" | tar -x -C "${OUT}"
cd "${OUT}"

FORBIDDEN_PATTERNS=(
  '/Users/'"attebury"
  'localhost:'"3000"
  '[.]runlane/forge-authority'
  'GITEA_'"TOKEN"
  'REMOGRAM_'"OPERATOR_CONFIG"
)

for pattern in "${FORBIDDEN_PATTERNS[@]}"; do
  if LC_ALL=C grep -R -n -E \
    --exclude-dir=.git \
    --exclude-dir=node_modules \
    --exclude-dir=coverage \
    -- "${pattern}" .; then
    echo "Public export contains forbidden local string pattern: ${pattern}" >&2
    exit 1
  fi
done

echo "Running public export checks..."
NPM_CONFIG_CACHE="${NPM_CACHE}" npm test
NPM_CONFIG_CACHE="${NPM_CACHE}" npm pack --dry-run --json >/tmp/skillpress-pack-dry-run.json

git init -b main >/dev/null
git add -A
git -c user.email='export@skillpress.local' -c user.name='skillpress-export' commit -m 'public export snapshot' >/dev/null

echo "Public export ready at ${OUT} (commit: $(git rev-parse HEAD))"
echo "To push:"
echo "  cd ${OUT} && git remote add origin ${GITHUB_REMOTE} && git push -u origin main --force"
