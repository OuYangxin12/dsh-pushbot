#!/usr/bin/env bash
# Run exactly one fetch/dedup/push cycle and print the outcome.
set -euo pipefail
ROOT="${PUSHBOT_ROOT:-$HOME/pushbot}"
cd "$ROOT"
DSH_HOME="$ROOT/home" PUSHBOT_ROOT="$ROOT" PUSHBOT_CONFIG="${PUSHBOT_CONFIG:-$ROOT/config.json}" \
  PUSHBOT_RUN_ONCE=1 dsh --profile pushbot
echo
echo "---- 心跳 ----"
node -e 'const h=require(process.argv[1]);console.log(JSON.stringify({phase:h.phase,version:h.version,sources:h.sources,deliveries:h.deliveries,deliveryFailures:h.deliveryFailures,outboxPending:h.outboxPending},null,1))' "$ROOT/data/health.json"
