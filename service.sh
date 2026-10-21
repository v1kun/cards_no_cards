#!/usr/bin/env bash
# Start/stop the Cards No Cards server in the background.
#
#   ./service.sh start [--dev]   migrate, build if needed, start (prod by default)
#   ./service.sh stop
#   ./service.sh restart [--dev]
#   ./service.sh status
#   ./service.sh logs            follow the server log
#
# Environment: PORT (default 3000), HOST (default 0.0.0.0, reachable on the LAN).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

PORT="${PORT:-3000}"
HOST="${HOST:-0.0.0.0}"
RUN_DIR="$ROOT/.run"
PID_FILE="$RUN_DIR/server.pid"
LOG_FILE="$RUN_DIR/server.log"
NEXT="$ROOT/node_modules/.bin/next"

mkdir -p "$RUN_DIR"

is_running() {
  [[ -f "$PID_FILE" ]] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null
}

port_pid() {
  lsof -ti "tcp:$PORT" -sTCP:LISTEN 2>/dev/null | head -1 || true
}

lan_ip() {
  ipconfig getifaddr en0 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}' || true
}

needs_build() {
  [[ ! -f .next/BUILD_ID ]] && return 0
  # The dev server writes into .next too, so a prod build must not be reused after it.
  [[ "$(cat "$RUN_DIR/last-mode" 2>/dev/null)" == "dev" ]] && return 0
  [[ -n "$(find src public package.json next.config.ts -newer .next/BUILD_ID -print -quit 2>/dev/null)" ]]
}

start() {
  local mode="prod"
  [[ "${1:-}" == "--dev" ]] && mode="dev"

  if is_running; then
    echo "Already running (pid $(cat "$PID_FILE")). Use: $0 restart"
    exit 0
  fi
  if [[ -n "$(port_pid)" ]]; then
    echo "Port $PORT is busy (pid $(port_pid)). Stop that process or set PORT=..." >&2
    exit 1
  fi
  [[ -x "$NEXT" ]] || { echo "Dependencies missing, running npm install..."; npm install; }
  [[ -f .env.local ]] || echo "Note: .env.local not found; defaults are used (see .env.example)."

  echo "Applying migrations..."
  npm run -s db:migrate

  if [[ "$mode" == "prod" ]]; then
    if needs_build; then
      echo "Building (sources changed)..."
      rm -rf .next
      "$NEXT" build
    fi
    nohup "$NEXT" start -H "$HOST" -p "$PORT" >"$LOG_FILE" 2>&1 &
  else
    nohup "$NEXT" dev -H "$HOST" -p "$PORT" >"$LOG_FILE" 2>&1 &
  fi
  echo $! >"$PID_FILE"
  echo "$mode" >"$RUN_DIR/last-mode"

  printf "Starting (%s)" "$mode"
  for _ in $(seq 1 60); do
    if curl -sf "http://localhost:$PORT/api/health" >/dev/null 2>&1; then
      echo
      echo "Running (pid $(cat "$PID_FILE")): http://localhost:$PORT"
      local ip
      ip="$(lan_ip)"
      [[ -n "$ip" && "$HOST" == "0.0.0.0" ]] && echo "On the LAN:  http://$ip:$PORT"
      echo "Log: $LOG_FILE"
      echo "Users: admin/admin, admin1/admin1 (create them with: npm run users:seed)"
      return 0
    fi
    if ! is_running; then
      echo
      echo "Server exited. Last log lines:" >&2
      tail -20 "$LOG_FILE" >&2
      rm -f "$PID_FILE"
      exit 1
    fi
    printf "."
    sleep 1
  done
  echo
  echo "Started, but the health check did not respond yet. See: $0 logs"
}

stop() {
  local pid=""
  if is_running; then
    pid="$(cat "$PID_FILE")"
  fi
  if [[ -z "$pid" ]]; then
    rm -f "$PID_FILE"
    echo "Not running."
    return 0
  fi

  echo "Stopping pid $pid..."
  pkill -TERM -P "$pid" 2>/dev/null || true
  kill -TERM "$pid" 2>/dev/null || true
  for _ in $(seq 1 10); do
    kill -0 "$pid" 2>/dev/null || break
    sleep 1
  done
  kill -0 "$pid" 2>/dev/null && kill -KILL "$pid" 2>/dev/null || true

  # Next may leave a worker holding the port; it belongs to this server.
  local leftover
  leftover="$(port_pid)"
  if [[ -n "$leftover" ]] && ps -o command= -p "$leftover" | grep -q "next"; then
    kill -TERM "$leftover" 2>/dev/null || true
  fi
  rm -f "$PID_FILE"
  echo "Stopped."
}

status() {
  if is_running; then
    echo "Running (pid $(cat "$PID_FILE")) on port $PORT."
  else
    echo "Not running."
    [[ -n "$(port_pid)" ]] && echo "Port $PORT is used by another process (pid $(port_pid))."
  fi
  return 0
}

case "${1:-}" in
  start) start "${2:-}" ;;
  stop) stop ;;
  restart)
    stop
    start "${2:-}"
    ;;
  status) status ;;
  logs) tail -n 50 -f "$LOG_FILE" ;;
  *)
    echo "Usage: $0 {start [--dev]|stop|restart [--dev]|status|logs}" >&2
    exit 1
    ;;
esac
