#!/usr/bin/env bash
# Install the pushbot as a systemd user service. Run this OUTSIDE the DSH
# sandbox (a normal login shell), because sandboxed sessions cannot reach the
# user systemd manager.
set -euo pipefail
ROOT="${PUSHBOT_ROOT:-$HOME/pushbot}"
UNIT_DIR="$HOME/.config/systemd/user"
mkdir -p "$UNIT_DIR"
install -m 644 "$ROOT/ops/dsh-pushbot.service" "$UNIT_DIR/"
install -m 644 "$ROOT/ops/dsh-pushbot-healthcheck.service" "$UNIT_DIR/"
install -m 644 "$ROOT/ops/dsh-pushbot-healthcheck.timer" "$UNIT_DIR/"
systemctl --user daemon-reload
systemctl --user enable --now dsh-pushbot.service
systemctl --user enable --now dsh-pushbot-healthcheck.timer
loginctl enable-linger "$USER" 2>/dev/null || true
sleep 3
systemctl --user --no-pager status dsh-pushbot.service || true
echo
echo "logs: journalctl --user -u dsh-pushbot -f"
