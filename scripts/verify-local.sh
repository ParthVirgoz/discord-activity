#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "==> Unit tests"
npm test

echo "==> Production build"
npm run build

echo "==> Integration smoke (server must be running on :2567)"
if curl -sf http://localhost:2567/health >/dev/null 2>&1; then
  npm run test:smoke -w server
else
  echo "Starting temporary server for smoke test..."
  npm run start:prod -w server &
  SERVER_PID=$!
  trap 'kill $SERVER_PID 2>/dev/null || true' EXIT
  for i in $(seq 1 30); do
    if curl -sf http://localhost:2567/health >/dev/null 2>&1; then
      break
    fi
    sleep 1
  done
  npm run test:smoke -w server
fi

echo ""
echo "All local verification passed."
