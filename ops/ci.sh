#!/usr/bin/env bash
# Local CI: syntax checks + unit tests. No network required.
set -euo pipefail
ROOT="${PUSHBOT_ROOT:-$HOME/pushbot}"
PKG="$ROOT/app/packages/dsh-pushbot-app"
echo "== syntax =="
node --check "$PKG/lib/core.js"
node --check "$PKG/lib/index.js"
for script in healthcheck.mjs ensure.mjs promote.mjs; do
  [ -f "$ROOT/ops/$script" ] && node --check "$ROOT/ops/$script"
done
echo "== unit tests =="
node --test "$PKG"/test/*.test.js
echo "== CI OK =="
