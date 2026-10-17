#!/usr/bin/env bash
# Consistent SQLite backup, safe while the server is running. Usage: ./deploy/backup.sh [target-dir]
set -euo pipefail
cd "$(dirname "$0")/.."
TARGET="${1:-$HOME/homedashboard-backups}"
mkdir -p "$TARGET"
FILE="$TARGET/dashboard-$(date +%F).db"
node --disable-warning=ExperimentalWarning -e "const {DatabaseSync}=require('node:sqlite'); new DatabaseSync('data/dashboard.db').exec(\"VACUUM INTO '$FILE'\")"
ls -1t "$TARGET"/dashboard-*.db | tail -n +15 | xargs -r rm --  # keep the 14 newest
echo "Backup written to $FILE"
