#!/bin/bash
# Start Replay Mode
# 
# Assumes you've already started:
# 1. InfluxDB (./server/scripts/influx-start-quiet.sh)
# 2. Backend server (cd server && npm run dev)
# 3. Frontend (npm start)
#
# This script sets the runtime mode via the API

BACKEND_URL="http://localhost:5001"

echo "🔄 Switching to REPLAY MODE"
echo "============================"
echo ""

# Check if backend is running
if ! curl -s "${BACKEND_URL}/api/ts/health" > /dev/null 2>&1; then
    echo "❌ Backend server is not running!"
    echo "Start it with: cd server && npm run dev"
    exit 1
fi

# Set mode via API
echo "Setting MODE=replay via API..."
RESPONSE=$(curl -s -X POST "${BACKEND_URL}/api/config/mode" \
  -H "Content-Type: application/json" \
  -d '{"mode":"replay"}')

if echo "$RESPONSE" | grep -q '"success":true'; then
    echo ""
    echo "✅ Replay mode activated!"
    echo ""
    echo "Dashboard will automatically switch to REPLAY mode"
    echo "Open: http://localhost:3000"
    echo ""
    echo "In Replay mode:"
    echo "  ✓ Use the time slider to navigate historical data"
    echo "  ✓ Data is fetched from InfluxDB historical ranges"
    echo "  ✓ No live worker needed"
    echo ""
else
    echo ""
    echo "❌ Failed to set replay mode"
    echo "Response: $RESPONSE"
    exit 1
fi

