#!/bin/bash
# Stop All Mode-Specific Processes
# 
# Stops live mode processes (simulator + worker)
# Safe to run in both replay and live modes
# 
# Does NOT stop:
# - Backend server (npm run dev)
# - InfluxDB
# - Frontend (npm start)

echo "🛑 Stopping Mode-Specific Processes"
echo "====================================="
echo ""

# Stop simulator (live mode only)
if pgrep -f "stream_simulator.py" > /dev/null; then
    pkill -f "stream_simulator.py"
    echo "✅ Stopped stream simulator (live mode)"
else
    echo "ℹ️  Stream simulator not running"
fi

# Stop worker (live mode only)
if pgrep -f "live_worker.py" > /dev/null; then
    pkill -f "live_worker.py"
    echo "✅ Stopped live worker (live mode)"
else
    echo "ℹ️  Live worker not running"
fi

echo ""

# Clear live mode data from database
SQLITE_DB="server/db/sqlite/batching_app.sqlite"
if [ -f "$SQLITE_DB" ]; then
    echo "🗑️  Clearing live mode data..."
    sqlite3 "$SQLITE_DB" "DELETE FROM batch_completions;"
    sqlite3 "$SQLITE_DB" "DELETE FROM settings_history WHERE note LIKE 'Live mode:%';"
    sqlite3 "$SQLITE_DB" "DELETE FROM run_configs WHERE source = 'program';"
    echo "✅ Cleared batch completions and live mode configs"
fi

echo ""

# Clear runtime config
CONFIG_FILE="server/.runtime-config.json"
if [ -f "$CONFIG_FILE" ]; then
    rm "$CONFIG_FILE"
    echo "✅ Cleared runtime configuration"
else
    echo "ℹ️  No runtime configuration to clear"
fi

echo ""
echo "All mode-specific processes stopped and config cleared."
echo ""
echo "Still running:"
echo "  • Backend server (if started)"
echo "  • InfluxDB (if started)"
echo "  • Frontend (if started)"
echo ""
echo "Dashboard will show 'Waiting for configuration...'"
echo ""
echo "To activate a mode, run:"
echo "  • Replay mode: ./start_replay_mode.sh"
echo "  • Live mode:   ./start_live_mode_simple.sh"

