#!/usr/bin/env python3
"""
Import only program_stats and recipe_stats from CSV files.
Does NOT touch time-series data (InfluxDB, kpi tables).
"""
import os
import sys
import sqlite3
import csv
from datetime import datetime

# Paths
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR = os.path.normpath(os.path.join(BASE_DIR, ".."))
SERVER_DIR = os.path.join(ROOT_DIR, "server")
OUT_DIR = os.path.join(BASE_DIR, "one_time_output")

DEFAULT_SQLITE = os.path.normpath(os.path.join(SERVER_DIR, "db", "sqlite", "batching_app.sqlite"))
PROGRAM_STATS_CSV = os.path.join(OUT_DIR, "sqlite_program_stats.csv")
RECIPE_STATS_CSV = os.path.join(OUT_DIR, "sqlite_recipe_stats.csv")

def import_program_stats(conn, csv_path):
    """Import program_stats from CSV"""
    if not os.path.exists(csv_path):
        print(f"❌ CSV not found: {csv_path}")
        return 0
    
    with open(csv_path, 'r') as f:
        reader = csv.DictReader(f)
        rows = list(reader)
    
    print(f"📊 Found {len(rows)} program stats in CSV")
    
    imported = 0
    for row in rows:
        program_id = int(row['program_id'])
        
        # Check if program exists
        exists = conn.execute("SELECT id FROM programs WHERE id=?", (program_id,)).fetchone()
        if not exists:
            print(f"⚠️  Program {program_id} not found in database, skipping")
            continue
        
        # Update program_stats (REPLACE to overwrite any existing zeros)
        conn.execute("""
            INSERT OR REPLACE INTO program_stats (
                program_id,
                total_batches,
                total_batched_weight_g,
                total_reject_weight_g,
                total_giveaway_weight_g,
                total_items_batched,
                total_items_rejected,
                start_ts,
                end_ts,
                updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        """, (
            program_id,
            int(float(row['total_batches'])),
            int(float(row['total_batched_weight_g'])),
            int(float(row['total_reject_weight_g'])),
            int(float(row['total_giveaway_weight_g'])),
            int(float(row['total_items_batched'])),
            int(float(row['total_items_rejected'])),
            str(row['start_ts']),
            str(row['end_ts'])
        ))
        imported += 1
    
    conn.commit()
    print(f"✅ Imported {imported} program stats")
    return imported

def import_recipe_stats(conn, csv_path):
    """Import recipe_stats from CSV"""
    if not os.path.exists(csv_path):
        print(f"❌ CSV not found: {csv_path}")
        return 0
    
    with open(csv_path, 'r') as f:
        reader = csv.DictReader(f)
        rows = list(reader)
    
    print(f"📊 Found {len(rows)} recipe stats in CSV")
    
    imported = 0
    skipped = 0
    for row in rows:
        program_id = int(row['program_id'])
        recipe_name = str(row['recipe_name'])
        
        # Check if program exists
        prog_exists = conn.execute("SELECT id FROM programs WHERE id=?", (program_id,)).fetchone()
        if not prog_exists:
            skipped += 1
            continue
        
        # Get recipe_id from name
        recipe_row = conn.execute("SELECT id FROM recipes WHERE name=?", (recipe_name,)).fetchone()
        if not recipe_row:
            print(f"⚠️  Recipe '{recipe_name}' not found in database, skipping")
            skipped += 1
            continue
        
        recipe_id = int(recipe_row[0])
        
        # Get gates_assigned and extract unique gates
        gates_assigned_str = str(row.get('gates_assigned', ''))
        
        # Insert or replace recipe_stats
        conn.execute("""
            INSERT OR REPLACE INTO recipe_stats (
                program_id,
                recipe_id,
                gates_assigned,
                total_batches,
                total_batched_weight_g,
                total_reject_weight_g,
                total_giveaway_weight_g,
                total_items_batched,
                total_items_rejected,
                updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        """, (
            program_id,
            recipe_id,
            gates_assigned_str,
            int(float(row['total_batches'])),
            int(float(row['total_batched_weight_g'])),
            int(float(row['total_reject_weight_g'])),
            int(float(row['total_giveaway_weight_g'])),
            int(float(row['total_items_batched'])),
            int(float(row['total_items_rejected']))
        ))
        imported += 1
    
    conn.commit()
    print(f"✅ Imported {imported} recipe stats")
    if skipped > 0:
        print(f"⚠️  Skipped {skipped} rows (program or recipe not found)")
    return imported

def main():
    print("=" * 60)
    print("📥 Import Program & Recipe Stats from CSV")
    print("=" * 60)
    print()
    
    if not os.path.exists(DEFAULT_SQLITE):
        print(f"❌ Database not found: {DEFAULT_SQLITE}")
        sys.exit(1)
    
    print(f"📂 Database: {DEFAULT_SQLITE}")
    print(f"📂 CSV directory: {OUT_DIR}")
    print()
    
    conn = sqlite3.connect(DEFAULT_SQLITE)
    conn.execute("PRAGMA foreign_keys=ON;")
    
    try:
        # Check current state
        prog_count = conn.execute("SELECT COUNT(*) FROM program_stats").fetchone()[0]
        recipe_count = conn.execute("SELECT COUNT(*) FROM recipe_stats").fetchone()[0]
        print(f"📊 Current database state:")
        print(f"   - program_stats: {prog_count} rows")
        print(f"   - recipe_stats: {recipe_count} rows")
        print()
        
        # Import
        print("🔄 Importing program stats...")
        prog_imported = import_program_stats(conn, PROGRAM_STATS_CSV)
        print()
        
        print("🔄 Importing recipe stats...")
        recipe_imported = import_recipe_stats(conn, RECIPE_STATS_CSV)
        print()
        
        # Verify
        prog_count_after = conn.execute("SELECT COUNT(*) FROM program_stats").fetchone()[0]
        recipe_count_after = conn.execute("SELECT COUNT(*) FROM recipe_stats").fetchone()[0]
        
        print("=" * 60)
        print("✅ Import Complete!")
        print("=" * 60)
        print(f"📊 Final database state:")
        print(f"   - program_stats: {prog_count_after} rows (+{prog_count_after - prog_count})")
        print(f"   - recipe_stats: {recipe_count_after} rows (+{recipe_count_after - recipe_count})")
        print()
        
        # Show sample
        print("📋 Sample program_stats (first 3):")
        sample = conn.execute("""
            SELECT p.name, ps.total_batches, ps.total_batched_weight_g, ps.start_ts, ps.end_ts
            FROM program_stats ps
            JOIN programs p ON p.id = ps.program_id
            ORDER BY ps.program_id
            LIMIT 3
        """).fetchall()
        for row in sample:
            print(f"   - {row[0]}: {row[1]} batches, {row[2]:,}g, {row[3]} to {row[4]}")
        print()
        
        print("📋 Sample recipe_stats (first 3):")
        sample = conn.execute("""
            SELECT p.name, r.name, rs.total_batches, rs.total_batched_weight_g
            FROM recipe_stats rs
            JOIN programs p ON p.id = rs.program_id
            JOIN recipes r ON r.id = rs.recipe_id
            ORDER BY rs.program_id, rs.recipe_id
            LIMIT 3
        """).fetchall()
        for row in sample:
            print(f"   - {row[0]} / {row[1]}: {row[2]} batches, {row[3]:,}g")
        
    except Exception as e:
        print(f"❌ Error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
    finally:
        conn.close()

if __name__ == "__main__":
    main()

