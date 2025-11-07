#!/bin/bash
cd /Users/michaelgeurtsen/Documents/Projects/Batching/hmi/server
source .influxdb3/env

# Kill any existing InfluxDB processes
pkill -f influxdb3 2>/dev/null
sleep 1

# Start InfluxDB with proper logging and resource limits
# Increased query-file-limit and wal-max-write-buffer-size for better performance
nohup influxdb3 serve \
  --object-store file \
  --data-dir "$PWD/.influxdb3" \
  --node-id mac-pro-01 \
  --http-bind 127.0.0.1:8181 \
  --query-file-limit 50000 \
  --wal-max-write-buffer-size 100000000 >> influx.log 2>&1 &

echo "InfluxDB started in background with logging to influx.log"
echo "To check if it's running: ps aux | grep influxdb3"
echo "To view logs: tail -f $PWD/influx.log"
echo "To stop it: pkill -f influxdb3"