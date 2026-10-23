#!/usr/bin/env bash
set -euo pipefail
UNIT_DIR="$HOME/.config/systemd/user"
systemctl --user disable --now dsh-pushbot-healthcheck.timer 2>/dev/null || true
systemctl --user disable --now dsh-pushbot.service 2>/dev/null || true
rm -f "$UNIT_DIR/dsh-pushbot.service" "$UNIT_DIR/dsh-pushbot-healthcheck.service" "$UNIT_DIR/dsh-pushbot-healthcheck.timer"
systemctl --user daemon-reload 2>/dev/null || true
echo "pushbot service removed (data kept in ~/pushbot)"
