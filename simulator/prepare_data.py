#!/usr/bin/env python3
"""
Data Preparation Script for Live Mode Simulator

Converts historical CSV data to JSON format with millisecond precision timestamps,
preparing it for real-time simulation.
"""

import os
import json
import csv
import random
from datetime import datetime, timedelta

# Paths
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
SOURCE_DIR = os.path.join(BASE_DIR, "..", "python-worker", "one_time_output")
OUTPUT_DIR = os.path.join(BASE_DIR, "data")

PIECES_CSV = os.path.join(SOURCE_DIR, "influx_m1_pieces.csv")
ASSIGNMENTS_CSV = os.path.join(SOURCE_DIR, "sqlite_assignments.csv")

PIECES_JSON = os.path.join(OUTPUT_DIR, "pieces_stream.json")
ASSIGNMENTS_JSON = os.path.join(OUTPUT_DIR, "program_assignments.json")

def parse_iso_timestamp(ts_str):
    """Parse ISO timestamp with timezone info"""
    # Handle formats like "2025-06-05T05:59:46+00:00"
    if '+' in ts_str or ts_str.endswith('Z'):
        return datetime.fromisoformat(ts_str.replace('Z', '+00:00'))
    return datetime.fromisoformat(ts_str)

def prepare_pieces_data():
    """
    Convert pieces CSV to JSON with millisecond precision.
    
    - Adds random millisecond offsets (0-999ms) to simulate realistic timing
    - Sorts by timestamp to maintain order
    - Outputs compact JSON for efficient loading
    """
    print("📥 Loading pieces data from CSV...")
    
    pieces = []
    with open(PIECES_CSV, 'r') as f:
        reader = csv.DictReader(f)
        for row in reader:
            # Parse timestamp and add random milliseconds
            ts = parse_iso_timestamp(row['ts'])
            ms_offset = random.randint(0, 999)
            ts = ts + timedelta(milliseconds=ms_offset)
            
            weight = float(row['weight_g'])
            length = round(random.gauss(weight * 0.8, weight * 0.15), 1)
            if length < 10:
                length = 10.0

            pieces.append({
                "timestamp": ts.isoformat(),
                "weight_g": weight,
                "length_mm": length,
                "gate": int(row['gate']),
                "_sort_key": ts
            })
    
    print(f"   Loaded {len(pieces):,} pieces")
    
    # Sort by timestamp (important for streaming)
    print("🔧 Sorting by timestamp...")
    pieces.sort(key=lambda x: x['_sort_key'])
    
    # Remove sort key and prepare final data
    start_time = pieces[0]['_sort_key']
    end_time = pieces[-1]['_sort_key']
    duration_seconds = (end_time - start_time).total_seconds()
    
    for p in pieces:
        del p['_sort_key']
    
    # Write JSON
    print("💾 Converting to JSON format...")
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    with open(PIECES_JSON, 'w') as f:
        json.dump({
            "metadata": {
                "total_pieces": len(pieces),
                "start_time": start_time.isoformat(),
                "end_time": end_time.isoformat(),
                "duration_seconds": duration_seconds,
                "generated_at": datetime.utcnow().isoformat()
            },
            "pieces": pieces
        }, f, indent=2)
    
    print(f"✅ Pieces data saved to: {PIECES_JSON}")
    print(f"   Total pieces: {len(pieces):,}")
    print(f"   Time range: {pieces[0]['timestamp']} to {pieces[-1]['timestamp']}")
    
    return pieces

def prepare_assignments_data():
    """
    Convert assignments CSV to structured JSON.
    
    Organizes gate assignments by program with timestamp ranges.
    """
    print("\n📥 Loading assignments data from CSV...")
    
    # Read CSV and group by (timestamp, program)
    rows = []
    with open(ASSIGNMENTS_CSV, 'r') as f:
        reader = csv.DictReader(f)
        for row in reader:
            rows.append(row)
    
    print(f"   Loaded {len(rows):,} assignment records")
    
    # Group by timestamp and program
    configs = {}
    for row in rows:
        ts = parse_iso_timestamp(row['ts'])
        program = int(row['program'])
        gate = int(row['gate'])
        recipe = str(row['recipe']).strip()
        
        key = (ts.isoformat(), program)
        if key not in configs:
            configs[key] = {}
        
        # Only add if recipe is not empty
        if recipe and recipe != '' and recipe != 'nan':
            configs[key][gate] = recipe
    
    # Convert to assignment list
    assignments = []
    seen_configs = set()
    
    for (ts, program), gate_map in sorted(configs.items()):
        # Create unique key for deduplication
        config_key = (program, tuple(sorted(gate_map.items())))
        
        if config_key not in seen_configs:
            seen_configs.add(config_key)
            assignments.append({
                "timestamp": ts,
                "program_id": program,
                "gate_assignments": gate_map
            })
    
    # Sort by timestamp
    assignments.sort(key=lambda x: x['timestamp'])
    
    # Write JSON
    with open(ASSIGNMENTS_JSON, 'w') as f:
        json.dump({
            "metadata": {
                "total_programs": len(set(a['program_id'] for a in assignments)),
                "configuration_changes": len(assignments),
                "generated_at": datetime.utcnow().isoformat()
            },
            "assignments": assignments
        }, f, indent=2)
    
    print(f"✅ Assignments data saved to: {ASSIGNMENTS_JSON}")
    print(f"   Programs: {len(set(a['program_id'] for a in assignments))}")
    print(f"   Configuration changes: {len(assignments)}")
    
    return assignments

def main():
    print("🚀 Data Preparation for Live Mode Simulator")
    print("=" * 60)
    
    # Prepare pieces data
    pieces = prepare_pieces_data()
    
    # Prepare assignments data
    assignments = prepare_assignments_data()
    
    print("\n" + "=" * 60)
    print("✅ Data preparation complete!")
    print(f"\n📁 Output directory: {OUTPUT_DIR}")
    print(f"   - {os.path.basename(PIECES_JSON)} ({len(pieces):,} pieces)")
    print(f"   - {os.path.basename(ASSIGNMENTS_JSON)} ({len(assignments)} configs)")
    print("\nYou can now run the simulator with this data.")

if __name__ == "__main__":
    main()

