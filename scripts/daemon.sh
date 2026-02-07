#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
RUNNER="$SCRIPT_DIR/agent-runner.ts"
PID_FILE="$PROJECT_DIR/.agent-runner.pid"
LOG_FILE="$PROJECT_DIR/.agent-runner.log"

is_running() {
  [[ -f "$PID_FILE" ]] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null
}

start() {
  if is_running; then
    echo "Already running (PID $(cat "$PID_FILE"))"
    return 1
  fi

  echo "Starting agent runner..."
  nohup "$0" _loop >> "$LOG_FILE" 2>&1 &
  echo $! > "$PID_FILE"
  echo "Started (PID $!). Logs: $LOG_FILE"
}

stop() {
  if ! is_running; then
    echo "Not running"
    rm -f "$PID_FILE"
    return 0
  fi

  local pid
  pid=$(cat "$PID_FILE")
  echo "Stopping (PID $pid)..."
  # Kill children first (the deno runner), then the loop
  pkill -P "$pid" 2>/dev/null || true
  kill "$pid" 2>/dev/null || true
  rm -f "$PID_FILE"
  echo "Stopped"
}

status() {
  if is_running; then
    echo "Running (PID $(cat "$PID_FILE"))"
  else
    echo "Not running"
    rm -f "$PID_FILE"
  fi
}

logs() {
  tail -f "$LOG_FILE"
}

_loop() {
  while true; do
    echo "[$(date)] Starting agent runner..."
    "$RUNNER" run --agents-dir "$PROJECT_DIR/agents" --db "$PROJECT_DIR/events.db" || true
    echo "[$(date)] Agent runner exited, restarting in 3s..."
    sleep 3
  done
}

case "${1:-}" in
  start)   start ;;
  stop)    stop ;;
  restart) stop; sleep 1; start ;;
  status)  status ;;
  logs)    logs ;;
  _loop)   _loop ;;
  *)
    echo "Usage: $0 {start|stop|restart|status|logs}"
    exit 1
    ;;
esac
