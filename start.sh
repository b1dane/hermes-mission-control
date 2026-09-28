#!/data/data/com.termux/files/usr/bin/bash
# Hermes Mission Control — one-shot launcher (WebUI venv edition)
#   bash start.sh                        # serve on 127.0.0.1:8000 + open browser
#   bash start.sh --lan                  # bind 0.0.0.0 with a generated token (Tailscale / LAN)
set -e
cd "$(dirname "$0")"

WEBUI_VENV="/data/data/com.termux/files/home/hermes-webui/.venv"
MC_PYTHON="$WEBUI_VENV/bin/python"

if [ ! -f "$MC_PYTHON" ]; then
  echo "⚠ WebUI venv not found at $WEBUI_VENV"
  echo "  Falling back to system python"
  MC_PYTHON="python"
fi

command -v "$MC_PYTHON" >/dev/null 2>&1 || { echo "python missing → install python"; exit 1; }
command -v hermes >/dev/null 2>&1 || echo "⚠ hermes not on PATH — dashboard will run in DEMO mode"

if [ ! -f dist/index.html ]; then
  command -v npm >/dev/null 2>&1 || { echo "npm missing → pkg install nodejs-lts"; exit 1; }
  [ -d node_modules ] || npm install
  npm run build
fi

# Keep the CPU awake while the console is running (needs termux-api)
command -v termux-wake-lock >/dev/null 2>&1 && termux-wake-lock || true
trap 'command -v termux-wake-unlock >/dev/null 2>&1' EXIT

if [ "$1" = "--lan" ]; then
  TOKEN="${HERMES_MC_TOKEN:-$(python3 -c 'import secrets;print(secrets.token_urlsafe(12))')}"
  echo "token: $TOKEN   (paste it in Config → Agent Link)"
  "$MC_PYTHON" server/mc_bridge.py --host 0.0.0.0 --token "$TOKEN" "${@:2}"
else
  "$MC_PYTHON" server/mc_bridge.py --open "$@"
fi