# python-worker/main.py
import os
import time
import datetime as dt
import json
import requests
from dotenv import load_dotenv

# IMPORTANT: This is the InfluxDB **3** client
from influxdb_client_3 import InfluxDBClient3, Point  # <- note the _3 module name

load_dotenv()

INFLUX_HOST = os.getenv("INFLUXDB3_HOST_URL", "http://127.0.0.1:8181")
INFLUX_TOKEN = os.getenv("INFLUXDB3_AUTH_TOKEN")
INFLUX_DB    = os.getenv("INFLUXDB3_DATABASE", "batching")

API_BASE      = os.getenv("API_BASE", "http://127.0.0.1:5001")
WORKER_SECRET = os.getenv("WORKER_SECRET", "dev-worker-secret")

def write_sample_point():
    with InfluxDBClient3(host=INFLUX_HOST, token=INFLUX_TOKEN, database=INFLUX_DB) as client:
        p = Point("kpi").tag("recipe", "A").field("giveaway_pct", 1.23).field("batches_min", 4)\
                        .time(dt.datetime.utcnow())
        client.write(p)

def push_live_kpi(payload: dict):
    # hit your Node route /api/kpi/publish guarded by x-worker-secret
    r = requests.post(
        f"{API_BASE}/api/kpi/publish",
        headers={"Content-Type": "application/json", "x-worker-secret": WORKER_SECRET},
        data=json.dumps(payload),
        timeout=5,
    )
    r.raise_for_status()

def main():
    # Example loop
    while True:
        write_sample_point()
        push_live_kpi({
            "ts": dt.datetime.utcnow().isoformat() + "Z",
            "recipe": "A",
            "giveaway_pct": 1.23,
            "batches_min": 4,
        })
        time.sleep(15)

if __name__ == "__main__":
    main()