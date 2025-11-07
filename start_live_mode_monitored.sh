#!/bin/bash
# Live mode startup with crash detection and automatic emergency stop
#
# This wrapper script:
# 1. Starts all live mode components
# 2. Monitors for emergency stop signals
# 3. Automatically stops simulation if crash is detected

set -e

echo "🚀 Starting Live Mode with Crash Detection"
echo "=========================================="
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
SERVER_DIR="$PROJECT_ROOT/server"
EMERGENCY_STOP_FILE="$SERVER_DIR/.emergency-stop"

# Remove any existing emergency stop signal
if [ -f "$EMERGENCY_STOP_FILE" ]; then
    echo "🧹 Removing previous emergency stop signal..."
    rm -f "$EMERGENCY_STOP_FILE"
fi

# Start monitoring for emergency stop in background
monitor_emergency_stop() {
    echo "👀 Starting crash detection monitor..."
    while true; do
        if [ -f "$EMERGENCY_STOP_FILE" ]; then
            echo ""
            echo -e "${RED}${'='.repeat(80)}${NC}"
            echo -e "${RED}🚨 EMERGENCY STOP SIGNAL DETECTED${NC}"
            echo -e "${RED}${'='.repeat(80)}${NC}"
            
            # Read stop reason
            if command -v jq &> /dev/null; then
                REASON=$(jq -r '.reason' "$EMERGENCY_STOP_FILE" 2>/dev/null || echo "Unknown")
                TIMESTAMP=$(jq -r '.timestamp' "$EMERGENCY_STOP_FILE" 2>/dev/null || echo "Unknown")
            else
                REASON="Check $EMERGENCY_STOP_FILE for details"
                TIMESTAMP="Unknown"
            fi
            
            echo -e "${RED}Timestamp: $TIMESTAMP${NC}"
            echo -e "${RED}Reason: $REASON${NC}"
            echo -e "${RED}Action: Stopping all processes...${NC}"
            echo -e "${RED}${'='.repeat(80)}${NC}"
            echo ""
            
            # Kill the main process group
            kill -TERM -$$ 2>/dev/null || true
            exit 1
        fi
        sleep 2
    done
}

# Start the monitor in background
monitor_emergency_stop &
MONITOR_PID=$!

# Cleanup function
cleanup() {
    echo ""
    echo "🛑 Cleanup in progress..."
    
    # Kill monitor
    kill $MONITOR_PID 2>/dev/null || true
    
    # Kill all background jobs
    jobs -p | xargs -r kill 2>/dev/null || true
    
    # Remove emergency stop file
    rm -f "$EMERGENCY_STOP_FILE"
    
    echo "✅ Cleanup complete"
}
trap cleanup EXIT INT TERM

# Start the actual live mode script
echo "Starting live mode components..."
echo ""

# Pass through to the main script
bash "$SCRIPT_DIR/start_live_mode.sh"

# If we reach here, script exited normally
exit 0

