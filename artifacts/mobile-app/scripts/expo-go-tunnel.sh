#!/usr/bin/env bash
# Runs a Cloudflare quick tunnel to Metro's port, then starts Expo with
# EXPO_PACKAGER_PROXY_URL pointed at the public tunnel URL so Expo Go
# (on a real phone, off the Replit network) can load the app.
set -uo pipefail
cd "$(dirname "$0")/.."

LOGFILE=/tmp/cloudflared-tunnel.log
rm -f "$LOGFILE"

cloudflared tunnel --url http://localhost:8081 > "$LOGFILE" 2>&1 &
CF_PID=$!
trap 'kill $CF_PID 2>/dev/null' EXIT

URL=""
for i in $(seq 1 40); do
  URL=$(grep -oE 'https://[a-zA-Z0-9-]+\.trycloudflare\.com' "$LOGFILE" | head -1)
  if [ -n "$URL" ]; then
    break
  fi
  sleep 1
done

if [ -z "$URL" ]; then
  echo "=================================================="
  echo " Failed to establish the Cloudflare tunnel. Log:"
  echo "=================================================="
  cat "$LOGFILE"
  exit 1
fi

echo "===================================================================="
echo " Expo Go tunnel is ready. In the Expo Go app, tap 'Enter URL manually'"
echo " and paste this address (or scan the QR code Metro prints below):"
echo ""
echo "   $URL"
echo ""
echo "===================================================================="

export EXPO_PACKAGER_PROXY_URL="$URL"
export EXPO_NO_TELEMETRY=1
# EXPO_PUBLIC_API_URL intentionally not set here — the app shows the
# server-setup screen so the user can enter their own deployed API URL.

# Pipe a simulated "down arrow + Enter" after 3 seconds to auto-select
# "Proceed anonymously" if Expo shows the login prompt, then keep stdin
# open indefinitely so Metro can keep running.
# --clear forces a fresh bundle so EXPO_PUBLIC_API_URL from the web
# workflow's Metro cache is not reused here.
{ sleep 3; printf '\x1b[B\r'; sleep 86400; } | npx expo start --clear
