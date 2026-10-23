#!/usr/bin/env bash
# Install the pushbot as a systemd user service, plus the nightly
# self-improvement timer. Run this OUTSIDE the DSH sandbox (a normal login
# shell), because sandboxed sessions cannot reach the user systemd manager.
#
# Paths are resolved from the current environment, so this works on any machine
# where `node` and `dsh` are on PATH.
set -euo pipefail
ROOT="${PUSHBOT_ROOT:-$HOME/pushbot}"
UNIT_DIR="$HOME/.config/systemd/user"
NODE_BIN="$(command -v node || true)"
DSH_CMD="$(command -v dsh || true)"

if [ -z "$NODE_BIN" ]; then echo "找不到 node，请先在 PATH 里配置" >&2; exit 1; fi
if [ -z "$DSH_CMD" ]; then echo "找不到 dsh，请先 npm i -g @deepseek-ai/dsh" >&2; exit 1; fi
NODE_DIR="$(dirname "$NODE_BIN")"
DSH_BIN="$(readlink -f "$DSH_CMD")"

render() {
  local template="$1" target="$2"
  sed -e "s|@NODE_DIR@|$NODE_DIR|g" \
      -e "s|@NODE@|$NODE_BIN|g" \
      -e "s|@DSH_BIN@|$DSH_BIN|g" \
      "$template" > "$target"
  chmod 644 "$target"
}

mkdir -p "$UNIT_DIR"
render "$ROOT/ops/systemd/dsh-pushbot.service.in"           "$UNIT_DIR/dsh-pushbot.service"
render "$ROOT/ops/systemd/dsh-pushbot-healthcheck.service.in" "$UNIT_DIR/dsh-pushbot-healthcheck.service"
render "$ROOT/ops/systemd/dsh-pushbot-improve.service.in"  "$UNIT_DIR/dsh-pushbot-improve.service"
install -m 644 "$ROOT/ops/systemd/dsh-pushbot-healthcheck.timer" "$UNIT_DIR/"
install -m 644 "$ROOT/ops/systemd/dsh-pushbot-improve.timer" "$UNIT_DIR/"

systemctl --user daemon-reload
systemctl --user enable --now dsh-pushbot.service
systemctl --user enable --now dsh-pushbot-healthcheck.timer
if [ -f "$ROOT/home/improve.env" ]; then
  systemctl --user enable --now dsh-pushbot-improve.timer
  echo "self-improvement timer enabled (nightly 03:00)"
else
  echo "skipped self-improvement timer: create $ROOT/home/improve.env first"
fi
loginctl enable-linger "$USER" 2>/dev/null || true
sleep 3
systemctl --user --no-pager status dsh-pushbot.service || true
echo
echo "logs: journalctl --user -u dsh-pushbot -f"
