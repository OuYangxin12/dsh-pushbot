#!/usr/bin/env bash
# Self-improvement orchestration.
#
#   1. verify the frozen bootstrap
#   2. run the creation-mode improver (headless, one shot)
#   3. gate the resulting commits (deterministic rules)
#   4. pass -> build + promote;  approval -> queue for a human;  blocked -> record
#
# PUSHBOT_IMPROVE_DRY_RUN=1 skips step 2 so the rest of the pipeline is testable.
set -uo pipefail
ROOT="${PUSHBOT_ROOT:-$HOME/pushbot}"
LOG="$ROOT/data/improve.log"
mkdir -p "$ROOT/data" "$ROOT/proposals"
log() { printf '%s [improve] %s\n' "$(date -Is)" "$*" | tee -a "$LOG"; }

# credentials for the improver live outside git
if [ -f "$ROOT/home/improve.env" ]; then
  # shellcheck disable=SC1091
  set -a; . "$ROOT/home/improve.env"; set +a
fi

cd "$ROOT" || exit 1

if ! node ops/freeze.mjs --verify >>"$LOG" 2>&1; then
  log "aborted: bootstrap drift detected (ops/ was modified)"
  exit 1
fi

BASE=$(git rev-parse HEAD)
log "base commit $BASE"

if [ "${PUSHBOT_IMPROVE_DRY_RUN:-0}" != "1" ]; then
  if [ -z "${DEEPSEEK_API_KEY:-}" ]; then
    log "aborted: DEEPSEEK_API_KEY missing (put it in ~/pushbot/home/improve.env)"
    exit 1
  fi
  log "running the improver…"
  DSH_HOME="$ROOT/home" DSH_TELEMETRY_DISABLED=1 \
    timeout "${PUSHBOT_IMPROVE_TIMEOUT:-1800}" \
    dsh --profile pushbot-improver "$(cat ops/improve-prompt.md)" >>"$LOG" 2>&1
  log "improver finished with exit $?"
else
  log "dry run: skipping the improver"
fi

HEAD=$(git rev-parse HEAD)
if [ "$BASE" = "$HEAD" ]; then
  log "no commits produced; nothing to gate"
  exit 0
fi

STAMP=$(date +%Y%m%dT%H%M%S)
PATCH="$ROOT/data/improvements/$STAMP.patch"
mkdir -p "$ROOT/data/improvements"
git diff "$BASE..$HEAD" > "$PATCH"
FILES=$(git diff --numstat "$BASE..$HEAD" | awk '{print $3}' | paste -sd, -)
log "candidate $BASE..$HEAD files=$FILES"

GATE_JSON=$(node ops/gate.mjs --diff-base "$BASE" --json)
GATE_EXIT=$?
printf '%s\n' "$GATE_JSON" >>"$LOG"
VERDICT=$(printf '%s' "$GATE_JSON" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).verdict)}catch{console.log("unknown")}})')
log "gate verdict=$VERDICT exit=$GATE_EXIT"

record() {
  GATE_JSON="$GATE_JSON" FILES="$FILES" DEPLOYED="$1" APPROVAL_ID="${2:-}" \
    node ops/record-improvement.mjs >>"$LOG" 2>&1
}

case "$VERDICT" in
  pass)
    log "gate passed: building and deploying"
    if bash ops/build.sh >>"$LOG" 2>&1 && node ops/promote.mjs >>"$LOG" 2>&1; then
      log "deployed successfully"
      record 1 ""
    else
      log "build/deploy failed; promote already rolled back on health failure"
      record 0 ""
      exit 1
    fi
    ;;
  approval)
    ID="imp-$STAMP"
    DETAIL=$(git log --format='%s' "$BASE..$HEAD" | head -5)
    node ops/approve.mjs request --id "$ID" --title "pushbot 自改进待批" \
      --detail "$DETAIL" --risk high --diff "$PATCH" | tee -a "$LOG"
    record 0 "$ID"
    log "queued for human approval as $ID"
    ;;
  *)
    log "gate blocked; change was not deployed"
    record 0 ""
    ;;
esac
