#!/bin/bash
# Delete all log files from the logs directory

LOGS_DIR="$(dirname "$0")/../../logs"

if [ -d "$LOGS_DIR" ]; then
  count=$(ls -1 "$LOGS_DIR"/*.log 2>/dev/null | wc -l)
  if [ "$count" -gt 0 ]; then
    rm -f "$LOGS_DIR"/*.log
    echo "Deleted $count log file(s) from $LOGS_DIR"
  else
    echo "No log files found in $LOGS_DIR"
  fi
else
  echo "Logs directory not found: $LOGS_DIR"
  exit 1
fi
