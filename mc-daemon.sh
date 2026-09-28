#!/data/data/com.termux/files/usr/bin/bash
# Hermes Mission Control — persistent daemon launcher (WebUI venv edition)
# Usage: bash ~/hermes-mission-control/mc-daemon.sh
# Stays alive via wake-lock and auto-restarts if bridge dies

MC_DIR="/data/data/com.termux/files/home/hermes-mission-control"
WEBUI_VENV="/data/data/com.termux/files/home/hermes-webui/.venv"
LOG="$MC_DIR/daemon.log"
PIDFILE="$MC_DIR/.bridge.pid"
PORT=8000

echo "=== MC DAEMON START $(date) === v2 (WebUI venv)" >> "$LOG"

# Wake lock to keep Termux alive
command -v termux-wake-lock >/dev/null 2>&1 && termux-wake-lock
trap 'command -v termux-wake-unlock >/dev/null 2>&1; echo "=== MC DAEMON STOP $(date) ===" >> "$LOG"' EXIT

ensure_bridge() {
  if curl -sf http://127.0.0.1:$PORT/api/health >/dev/null 2>&1; then
    return 0
  fi
  if [ -f "$PIDFILE" ]; then
    local pid
    pid=$(cat "$PIDFILE")
    if kill -0 "$pid" 2>/dev/null; then
      return 0
    fi
  fi

  echo "$(date '+%H:%M:%S') — bridge dead, starting..." >> "$LOG"
  cd "$MC_DIR" || return 1

  # Use WebUI venv python — has all hermes deps
  MC_PYTHON="$WEBUI_VENV/bin/python"
  if [ ! -f "$MC_PYTHON" ]; then
    # Fallback to system python if venv missing
    MC_PYTHON="python"
  fi

  nohup "$MC_PYTHON" server/mc_bridge.py --port "$PORT" >> "$LOG" 2>&1 &
  local new_pid=$!
  echo "$new_pid" > "$PIDFILE"
  disown "$new_pid"

  command -v termux-notification >/dev/null 2>&1 && \
    termux-notification --id mc-daemon --title "☤ MC Bridge" \
      --content "Restarted (PID $new_pid) [WebUI venv]" --priority low 2>/dev/null

  echo "$(date '+%H:%M:%S') — started PID $new_pid" >> "$LOG"
}

echo "Initial start..." >> "$LOG"
ensure_bridge

while true; do
  sleep 90
  ensure_bridge
done