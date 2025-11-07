#!/bin/bash
# Start Live Mode (Automated)
# 
# Assumes you've already started:
# 1. InfluxDB (./server/scripts/influx-start-quiet.sh)
# 2. Backend server (cd server && npm run dev)
# 3. Frontend (npm start)
#
# This script:
# - Sets MODE=live for dashboard
# - Starts the live worker
# - Automatically starts the simulator with continuous streaming

set -e

BACKEND_URL="http://localhost:5001"
SIMULATOR_FREQUENCY=${SIMULATOR_FREQUENCY:-3.0}  # Pieces per second (default: 3 for smooth visuals)
SIMULATOR_MAX_PIECES=${SIMULATOR_MAX_PIECES:-}  # Empty = all pieces (continuous loop)

echo "🔴 Starting LIVE MODE"
echo "============================"
echo ""

# Check if backend is running
if ! curl -s "${BACKEND_URL}/api/ts/health" > /dev/null 2>&1; then
    echo "❌ Backend server is not running!"
    echo "Start it with: cd server && npm run dev"
    exit 1
fi

# Set mode via API
echo "1️⃣  Configuring dashboard for live mode..."
RESPONSE=$(curl -s -X POST "${BACKEND_URL}/api/config/mode" \
  -H "Content-Type: application/json" \
  -d '{"mode":"live"}')

if echo "$RESPONSE" | grep -q '"success":true'; then
    echo "   ✓ MODE=live set via API"
else
    echo "   ❌ Failed to set live mode: $RESPONSE"
    exit 1
fi
echo ""

# Start live worker (v2 with recipe logic)
echo "2️⃣  Starting live worker..."
cd python-worker
export PLC_SHARED_SECRET=${PLC_SHARED_SECRET:-dev-plc-secret}
python3 live_worker.py &
WORKER_PID=$!
cd ..
echo "   ✓ Live worker started (PID: $WORKER_PID)"
echo ""

# Give worker a moment to initialize
sleep 2

# Start simulator automatically
echo "3️⃣  Starting simulator..."
cd simulator
MAX_ARG=""
if [ ! -z "$SIMULATOR_MAX_PIECES" ]; then
    MAX_ARG="--max $SIMULATOR_MAX_PIECES"
    echo "   ⚙️  Frequency: ${SIMULATOR_FREQUENCY} pieces/sec | Max pieces: ${SIMULATOR_MAX_PIECES}"
else
    echo "   ⚙️  Frequency: ${SIMULATOR_FREQUENCY} pieces/sec | Max pieces: all (continuous)"
fi
echo ""

# Function to cleanup on exit
cleanup() {
    echo ""
    echo "🛑 Stopping live mode components..."
    kill $WORKER_PID 2>/dev/null || true
    echo "   ✓ Worker stopped"
    echo "   ✓ Simulator stopped"
    echo "✅ Live mode shutdown complete"
}
trap cleanup EXIT INT TERM

export PLC_SHARED_SECRET=${PLC_SHARED_SECRET:-dev-plc-secret}

echo "======================================================================"
echo "🎬 LIVE MODE ACTIVE - Data pool streaming"
echo "======================================================================"
echo ""
echo "📊 Dashboard: http://localhost:3000"
echo ""
echo "The simulator pulls pieces from the data pool at ${SIMULATOR_FREQUENCY} pieces/sec"
echo "and assigns current timestamps when sending to the backend."
echo ""
echo "To adjust frequency: SIMULATOR_FREQUENCY=50 ./start_live_mode_simple.sh"
echo ""
echo "Press Ctrl+C to stop everything"
echo "======================================================================"
echo ""

# Run simulator in foreground (will show progress)
python3 stream_simulator.py --frequency $SIMULATOR_FREQUENCY $MAX_ARG

