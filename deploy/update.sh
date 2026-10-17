#!/usr/bin/env bash
# Pull the latest version and restart. Data in ./data is kept.
set -euo pipefail
cd "$(dirname "$0")/.."
git pull
npm ci
npm run build
sudo systemctl restart homedashboard
echo "Updated."
