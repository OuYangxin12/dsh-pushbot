#!/usr/bin/env bash
set -euo pipefail
UNIT_DIR="$HOME/.config/systemd/user"
for unit in dsh-pushbot-improve.timer dsh-pushbot-improve.service \
            dsh-pushbot-healthcheck.timer dsh-pushbot-healthcheck.service \
            dsh-pushbot.service; do
  systemctl --user disable --now "$unit" 2>/dev/null || true
  rm -f "$UNIT_DIR/$unit"
done
systemctl --user daemon-reload 2>/dev/null || true
echo "pushbot services removed (data kept in ~/pushbot)"
