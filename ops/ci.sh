#!/usr/bin/env bash
# Local CI: syntax checks + unit tests. No network required.
set -euo pipefail
ROOT="${PUSHBOT_ROOT:-$HOME/pushbot}"
PKG="$ROOT/app/packages/dsh-pushbot-app"
echo "== syntax =="
for file in "$PKG"/lib/*.js; do node --check "$file"; done
for script in healthcheck.mjs ensure.mjs promote.mjs gate.mjs approve.mjs freeze.mjs record-improvement.mjs; do
  [ -f "$ROOT/ops/$script" ] && node --check "$ROOT/ops/$script"
done
echo "== unit tests =="
FILES=("$PKG"/test/*.test.js)
[ -d "$ROOT/ops/test" ] && FILES+=("$ROOT"/ops/test/*.test.js)
node --test "${FILES[@]}"
echo "== CI OK =="
