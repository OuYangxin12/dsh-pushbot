#!/usr/bin/env bash
# Cron fallback supervisor. Add to crontab:
#   @reboot      $HOME/pushbot/ops/ensure.sh
#   */5 * * * *  $HOME/pushbot/ops/ensure.sh
set -euo pipefail
ROOT="${PUSHBOT_ROOT:-$HOME/pushbot}"
if [ -z "${PUSHBOT_DSH_BIN:-}" ]; then
  DSH_CMD="$(command -v dsh || true)"
  [ -n "$DSH_CMD" ] || { echo "ensure: dsh not found on PATH" >&2; exit 1; }
  export PUSHBOT_DSH_BIN="$(readlink -f "$DSH_CMD")"
fi
exec node "$ROOT/ops/ensure.mjs"
