#!/usr/bin/env bash
# Cron fallback supervisor (use when systemd --user is unavailable).
# Add to crontab:
#   @reboot  $HOME/pushbot/ops/ensure.sh
#   */5 * * * * $HOME/pushbot/ops/ensure.sh
set -u
ROOT="${PUSHBOT_ROOT:-$HOME/pushbot}"
PATTERN="lib/node_modules/@deepseek-ai/dsh/lib/bin.js --profile pushbot"
if pgrep -f "$PATTERN" >/dev/null 2>&1; then
  exit 0
fi
mkdir -p "$ROOT/data"
setsid nohup env \
  DSH_HOME="$ROOT/home" \
  PUSHBOT_ROOT="$ROOT" \
  PUSHBOT_CONFIG="$ROOT/config.json" \
  /home/oyx/.nvm/versions/node/v22.19.0/bin/node \
  /home/oyx/.nvm/versions/node/v22.19.0/lib/node_modules/@deepseek-ai/dsh/lib/bin.js \
  --profile pushbot >> "$ROOT/data/service.log" 2>&1 < /dev/null &
echo "$(date -Is) started pid $!" >> "$ROOT/data/service.log"
