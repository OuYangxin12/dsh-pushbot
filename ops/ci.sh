#!/usr/bin/env bash
# Local CI: syntax checks + unit tests. No network required.
set -euo pipefail
ROOT="${PUSHBOT_ROOT:-$HOME/pushbot}"
PKG="$ROOT/app/packages/dsh-pushbot-app"
echo "== syntax =="
node --check "$PKG/lib/core.js"
node --check "$PKG/lib/index.js"
node --check "$ROOT/ops/healthcheck.mjs"
[ -f "$ROOT/ops/promote.mjs" ] && node --check "$ROOT/ops/promote.mjs"
echo "== unit tests =="
node --test "$PKG"/test/*.test.js
echo "== CI OK =="
