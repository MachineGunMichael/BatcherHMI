import os, time, random
import requests
from influxdb_client import InfluxDBClient, Point, WritePrecision

INFLUX_URL = os.getenv("INFLUX_URL", "http://localhost:8181")
INFLUX_TOKEN = os.getenv("INFLUX_TOKEN", "")
INFLUX_ORG = os.getenv("INFLUX_ORG", "HMI")
INFLUX_BUCKET = os.getenv("INFLUX_BUCKET", "hmi")
NODE_URL = os.getenv("NODE_URL", "http://localhost:5001")

client = InfluxDBClient(url=INFLUX_URL, token=INFLUX_TOKEN, org=INFLUX_ORG)
write_api = client.write_api()

def compute_kpis():
    # TODO: replace with real KPI calculations
    return {
        "throughput_bpm_total": random.randint(400, 600),
        "rejects_per_min": random.randint(0, 20),
        "giveaway_pct_avg": round(random.uniform(0.8, 2.0), 2),
        "per_recipe": [
            {"program_id": 1, "recipe_id": 1, "throughput_bpm": random.randint(100,200), "giveaway_pct": round(random.uniform(0.5,2.5),2)},
            {"program_id": 1, "recipe_id": 2, "throughput_bpm": random.randint(80,160), "giveaway_pct": round(random.uniform(0.5,2.5),2)},
        ]
    }

def write_kpis_to_influx(kpis):
    p = (Point("kpi")
         .field("throughput_bpm_total", int(kpis["throughput_bpm_total"]))
         .field("rejects_per_min", int(kpis["rejects_per_min"]))
         .field("giveaway_pct_avg", float(kpis["giveaway_pct_avg"]))
         .time(time.time_ns(), WritePrecision.NS))
    write_api.write(bucket=INFLUX_BUCKET, org=INFLUX_ORG, record=p)

    for item in kpis.get("per_recipe", []):
        pr = (Point("kpi")
              .tag("program_id", str(item["program_id"]))
              .tag("recipe_id", str(item["recipe_id"]))
              .field("throughput_bpm", int(item["throughput_bpm"]))
              .field("giveaway_pct", float(item["giveaway_pct"]))
              .time(time.time_ns(), WritePrecision.NS))
        write_api.write(bucket=INFLUX_BUCKET, org=INFLUX_ORG, record=pr)

def publish_snapshot_to_node(kpis):
    try:
        requests.post(f"{NODE_URL}/api/kpi/publish", json=kpis, timeout=2.0)
    except Exception as e:
        print("publish error:", e)

def main():
    print("Python KPI worker started")
    while True:
        k = compute_kpis()
        write_kpis_to_influx(k)
        publish_snapshot_to_node(k)
        time.sleep(5)

if __name__ == "__main__":
    main()