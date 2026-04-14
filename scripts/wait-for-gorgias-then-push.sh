#!/usr/bin/env bash
# Poll until gorgias-backfill-since.sh is no longer running, then push aj/gorgias for review.
set -u

REPO="/Users/aj/RAD/docs"
LOG="$REPO/gorgias-backfill.log"
INTERVAL=1800
MONITOR_LOG="$REPO/gorgias-backfill-monitor.log"

log() {
  echo "[$(date -Iseconds)] $*" | tee -a "$MONITOR_LOG"
}

log "Monitor started (interval ${INTERVAL}s = 30 min). Watching for gorgias-backfill-since.sh to finish."

while pgrep -f "gorgias-backfill-since.sh" >/dev/null 2>&1; do
  log "Backfill still running. Next check in 30 minutes."
  sleep "$INTERVAL"
done

log "Backfill process no longer running."

if ! grep -q "Done. Processed" "$LOG" 2>/dev/null; then
  log "ERROR: No 'Done. Processed' line in $LOG — backfill may have crashed. Not pushing."
  exit 1
fi

cd "$REPO" || exit 1
log "Fetching and rebasing aj/gorgias, then pushing to origin."
git fetch origin
git pull --rebase origin aj/gorgias
git push origin aj/gorgias
log "Push to origin/aj/gorgias completed successfully."
