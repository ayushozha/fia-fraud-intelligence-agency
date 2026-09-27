#!/bin/sh
set -e
cd "$(dirname "$0")/.."
lsof -nP -iTCP:7101 -sTCP:LISTEN >/dev/null 2>&1 && { echo "stop the dev stack (npm run dev) first"; exit 1; }
rm -rf data && cp -a demo-snapshot data && echo "demo data reset: Northline done through publication, Harbor fresh"
