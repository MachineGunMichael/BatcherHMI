#!/bin/bash
cd /Users/michaelgeurtsen/Documents/Projects/Batching/hmi/server
source .influxdb3/env

# Kill any existing InfluxDB processes
pkill -f influxdb3 2>/dev/null

# Start InfluxDB completely silently
nohup influxdb3 serve \
  --object-store file \
  --data-dir "$PWD/.influxdb3" \
  --node-id mac-pro-01 \
  --http-bind 127.0.0.1:8181 \
  --query-file-limit 10000 > influx.log  > /dev/null 2>&1 &

echo "InfluxDB started silently in background"
echo "To check if it's running: ps aux | grep influxdb3"
echo "To stop it: pkill -f influxdb3"