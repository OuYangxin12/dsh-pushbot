#!/usr/bin/env bash
# Cron fallback supervisor. Add to crontab:
#   @reboot      $HOME/pushbot/ops/ensure.sh
#   */5 * * * *  $HOME/pushbot/ops/ensure.sh
set -euo pipefail
ROOT="${PUSHBOT_ROOT:-$HOME/pushbot}"
export PUSHBOT_DSH_BIN="${PUSHBOT_DSH_BIN:-/home/oyx/.nvm/versions/node/v22.19.0/lib/node_modules/@deepseek-ai/dsh/lib/bin.js}"
exec /home/oyx/.nvm/versions/node/v22.19.0/bin/node "$ROOT/ops/ensure.mjs"
