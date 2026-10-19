#!/usr/bin/env bash
# Consistent backup of the dashboard's data, safe while the server is running. Usage: ./deploy/backup.sh [target-dir]
# Writes dashboard-YYYY-MM-DD.db plus the PIN files (if set) and keeps the 14 newest days.
# Set HC_PING_URL to a Healthchecks.io ping URL to report every run (see deploy/README.md → Monitoring).
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -n "${HC_PING_URL:-}" ]; then
  # On exit, always report the result (0 = ok, anything else = failed), even if the script stopped early.
  trap 'rc=$?; curl -fsS -m 10 --retry 3 -o /dev/null "$HC_PING_URL/$rc" || true' EXIT
  curl -fsS -m 10 --retry 3 -o /dev/null "$HC_PING_URL/start" || true
fi

TARGET="${1:-$HOME/homedashboard-backups}"
mkdir -p "$TARGET"
BASE="$TARGET/dashboard-$(date +%F)"

# VACUUM INTO refuses to overwrite, so write to a temp file; a failed run keeps today's earlier backup.
# Read-only, so a missing database fails instead of silently creating (and backing up) an empty one.
rm -f "$BASE.db.tmp"
node --disable-warning=ExperimentalWarning -e "const {DatabaseSync}=require('node:sqlite'); new DatabaseSync('data/dashboard.db', { readOnly: true }).exec(\"VACUUM INTO '$BASE.db.tmp'\")"
mv "$BASE.db.tmp" "$BASE.db"
# Without these, a restore would come back without the PIN and log out every device.
for f in pin.json session-secret; do
  if [ -f "data/$f" ]; then install -m 600 "data/$f" "$BASE.$f"; fi
done

ls -1t "$TARGET"/dashboard-*.db | tail -n +15 | while read -r old; do
  rm -f -- "$old" "${old%.db}.pin.json" "${old%.db}.session-secret"
done
echo "Backup written to $BASE.db"
