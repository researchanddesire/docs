#!/usr/bin/env bash
# Backfill Gorgias docs analysis one ticket at a time (sequential).
# Cutoff: closed_datetime >= Feb 25, 2026 01:15 Asia/Bangkok (GMT+7).
# Requires: Documentation/.env.local with GORGIAS_API_KEY, CURSOR_API_KEY; `agent` on PATH.
#
# By default this does NOT use GORGIAS_CLOSED_VIEW_ID: the workflow's default view (1465345)
# returned 0 tickets in API tests, while listing with --view-id "" finds all closed tickets.
# To use the saved view: USE_DEFAULT_CLOSED_VIEW=1 ./scripts/gorgias-backfill-since.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DOCS="$ROOT/Documentation"
SINCE="${GORGIAS_SINCE:-2026-02-25T01:15:00+07:00}"

VIEW_ARGS=(--view-id "")
if [[ "${USE_DEFAULT_CLOSED_VIEW:-}" == "1" ]]; then
  VIEW_ARGS=()
fi

cd "$DOCS"

echo "Listing closed tickets since: $SINCE (use GORGIAS_SINCE to override)"
LIST_TMP="$(mktemp)"
trap 'rm -f "$LIST_TMP"' EXIT
pnpm -s ossm gorgias-tickets --max-pages 0 --since "$SINCE" --list-only "${VIEW_ARGS[@]}" >"$LIST_TMP" || exit 1

IDS=()
while IFS= read -r line || [[ -n "$line" ]]; do
  if [[ "$line" =~ ^[0-9]+$ ]]; then
    IDS+=("$line")
  fi
done <"$LIST_TMP"

N="${#IDS[@]}"
echo "Tickets to process (loops): $N"
if [[ "$N" -eq 0 ]]; then
  echo "Nothing to do."
  exit 0
fi

i=0
for id in "${IDS[@]}"; do
  i=$((i + 1))
  echo ""
  echo "========== [$i/$N] ticket #$id =========="
  pnpm ossm gorgias-tickets --analyze --ticket-id "$id"
done

echo "Done. Processed $N ticket(s)."
