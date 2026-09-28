#!/data/data/com.termux/files/usr/bin/bash
# Hermes Mission Control watchdog — keeps the bridge alive (WebUI venv edition)
# Cron-safe: checks port 8000, starts bridge if dead

MC_DIR="/data/data/com.termux/files/home/hermes-mission-control"
WEBUI_VENV="/data/data/com.termux/files/home/hermes-webui/.venv"
LOG="$MC_DIR/watchdog.log"
PORT=8000

# Check if bridge is running by testing the port
if ! ss -tlnp 2>/dev/null | grep -q ":$PORT " && ! curl -sf http://127.0.0.1:$PORT/api/health >/dev/null 2>&1; then
  echo "$(date '+%Y-%m-%d %H:%M:%S') — bridge dead, restarting" >> "$LOG"
  cd "$MC_DIR" || exit 1

  MC_PYTHON="$WEBUI_VENV/bin/python"
  [ -f "$MC_PYTHON" ] || MC_PYTHON="python"

  nohup "$MC_PYTHON" server/mc_bridge.py >> "$LOG" 2>&1 &
  disown
  echo "$(date '+%Y-%m-%d %H:%M:%S') — started PID $!" >> "$LOG"
else
  :  # bridge healthy, nothing to do
fi