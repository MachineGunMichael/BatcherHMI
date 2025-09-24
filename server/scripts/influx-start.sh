#!/usr/bin/env bash
set -euo pipefail

# ===================== EDIT THESE ONCE =====================
TOKEN="${TOKEN:-apiv3_1ZtW2zfUSYo6oGo-tz1ruZs_zJ64bieGj301QB8MG34gnK_ExQq0fD_wGZn_CLKY2PzJJdNg4RLHhOifC-JKlQ}"   # your apiv3_* token
DB_NAME="${DB_NAME:-batching}"                        # database name
HTTP_BIND="${HTTP_BIND:-127.0.0.1:8181}"              # listen address:port
LICENSE_EMAIL="${LICENSE_EMAIL:-michaelgeurtsen@protonmail.com}"  # email to verify
BIN="${BIN:-influxdb3}"                               # binary name on PATH
# ===========================================================

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SERVER_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DATA_DIR="${DATA_DIR:-$SERVER_DIR/.influxdb3}"

mkdir -p "$DATA_DIR"

# Persist token/env for convenience
echo -n "$TOKEN" > "$DATA_DIR/token"
chmod 600 "$DATA_DIR/token"

cat > "$DATA_DIR/env" <<EOF
# Source this to use your local InfluxDB 3 from any terminal
export INFLUXDB3_HOST_URL="http://$HTTP_BIND"
export INFLUXDB3_AUTH_TOKEN="$(cat "$DATA_DIR/token")"
export INFLUXDB3_DATABASE="$DB_NAME"
EOF
chmod 600 "$DATA_DIR/env"

echo "Data dir: $DATA_DIR"
echo "HTTP    : http://$HTTP_BIND"
echo "Token   : $DATA_DIR/token"
echo "Env     : source $DATA_DIR/env"
echo

wait_for_up() {
  local url="http://$HTTP_BIND/health"
  for i in {1..120}; do
    if curl -fsS "$url" >/dev/null 2>&1; then return 0; fi
    sleep 0.5
  done
  return 1
}

port_in_use() {
  # macOS-friendly
  lsof -nP -iTCP:"${HTTP_BIND##*:}" -sTCP:LISTEN | grep -q .
}

ensure_db() {
  "$BIN" create database "$DB_NAME" \
    --host "http://$HTTP_BIND" \
    --token "$TOKEN" >/dev/null 2>&1 || true
}

MODE="${1:-daemon}"

if [[ "$MODE" == "bootstrap" ]]; then
  echo "BOOTSTRAP MODE (first run):"
  echo " - Will start in FOREGROUND and email a verification link to: $LICENSE_EMAIL"
  echo " - Click the link; the server will become healthy and keep running."
  echo " - Open a new terminal to use the CLI or your app."
  echo
  echo "Press Ctrl-C to stop the server at any time."
  echo

  # Run in foreground with license email provided via env/flag
  INFLUXDB3_ENTERPRISE_LICENSE_EMAIL="$LICENSE_EMAIL" \
  exec "$BIN" serve \
    --object-store file \
    --data-dir "$DATA_DIR" \
    --cluster-id dev-cluster \
    --node-id mac-pro-01 \
    --http-bind "$HTTP_BIND"

elif [[ "$MODE" == "daemon" ]]; then
  # If something is already listening on the port, don't try to start another.
  if port_in_use; then
    echo "An InfluxDB appears to already be running on $HTTP_BIND."
    echo "Loading env only. If this is unexpected, check ${DATA_DIR}/server.log or kill the process."
    echo "To stop a background instance: kill \$(cat ${DATA_DIR}/influxdb3.pid)  (if PID file exists)"
    exit 0
  fi

  echo "Starting InfluxDB 3 in background…"
  INFLUXDB3_ENTERPRISE_LICENSE_EMAIL="$LICENSE_EMAIL" \
  nohup "$BIN" serve \
    --object-store file \
    --data-dir "$DATA_DIR" \
    --cluster-id dev-cluster \
    --node-id mac-pro-01 \
    --http-bind "$HTTP_BIND" \
    > "$DATA_DIR/server.log" 2>&1 &

  echo $! > "$DATA_DIR/influxdb3.pid"
  echo "PID   : $(cat "$DATA_DIR/influxdb3.pid")"
  echo "Logs  : $DATA_DIR/server.log"
  echo "Waiting for server to become healthy (this may pause at first run until you verify email)…"
  if ! wait_for_up; then
    echo "Server did not report healthy in time."
    echo "Check logs: $DATA_DIR/server.log"
    exit 1
  fi

  echo "Ensuring database '$DB_NAME' exists…"
  ensure_db
  echo "Ready. To load env in this shell:  source $DATA_DIR/env"

elif [[ "$MODE" == "stop" ]]; then
  if [[ -f "$DATA_DIR/influxdb3.pid" ]]; then
    kill "$(cat "$DATA_DIR/influxdb3.pid")" || true
    rm -f "$DATA_DIR/influxdb3.pid"
    echo "Stopped background server."
  else
    echo "No PID file; if server runs in foreground, stop it with Ctrl-C."
  fi

else
  echo "Usage: $0 [bootstrap|daemon|stop]"
  echo "  bootstrap : first run (foreground), completes email verification"
  echo "  daemon    : normal background start (after first verification)"
  echo "  stop      : stop background instance (if started with daemon)"
  exit 1
fi