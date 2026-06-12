#!/usr/bin/env bash
set -euo pipefail

URL="${1:-https://discord-activity.up.railway.app}"

echo "Checking $URL ..."
echo ""

HEALTH=$(curl -s -o /tmp/health.json -w "%{http_code}" "$URL/health")
echo "GET /health → HTTP $HEALTH"
if [ "$HEALTH" = "200" ]; then
  cat /tmp/health.json
  echo ""
  echo "✓ Server is on the NEW Watch Together build"
else
  echo "✗ Server is still OLD — redeploy Railway (see below)"
fi

echo ""
TOKEN=$(curl -s -X POST "$URL/discord_token" -H "Content-Type: application/json" -d '{"code":"mock_code"}' | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
if [ -z "$TOKEN" ]; then
  echo "Could not get test token (mock_code disabled in production — OK)"
else
  CODE=$(curl -s -o /tmp/join.json -w "%{http_code}" -X POST "$URL/matchmake/joinOrCreate/my_room" \
    -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
    -d '{"channelId":"123456789012345678"}')
  echo "POST joinOrCreate/my_room → HTTP $CODE"
  head -c 200 /tmp/join.json
  echo ""
fi
