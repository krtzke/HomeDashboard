#!/usr/bin/env bash
# One-time setup on the Raspberry Pi. Run from the repo root: ./deploy/install.sh
set -euo pipefail
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP_USER="$(id -un)"

npm ci
npm run build

sed -e "s|__USER__|$APP_USER|" -e "s|__APP_DIR__|$APP_DIR|" "$APP_DIR/deploy/homedashboard.service" \
  | sudo tee /etc/systemd/system/homedashboard.service > /dev/null
sudo systemctl daemon-reload
sudo systemctl enable --now homedashboard
echo "Home Dashboard running on 127.0.0.1:3000 — now configure Caddy (see deploy/README.md)."
