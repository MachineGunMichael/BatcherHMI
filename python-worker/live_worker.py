#!/usr/bin/env python3
"""
Live Mode Worker

SIMPLIFIED ARCHITECTURE:
- Backend handles M1/M2 in JavaScript (faster, no HTTP overhead)
- This worker only handles M3/M4 KPI calculations
- Polls InfluxDB every 60 seconds for new pieces
- Calculates per-minute and cumulative KPIs
- Writes to SQLite for dashboard

Implements the complete KPI logic from one_time_import.py for live mode:
- Recipe-based giveaway calculations
- Batch detection and tracking
- Filled batch equivalents
- Per-minute and cumulative KPIs
"""

import os
import sys
import time
import json
import random
import sqlite3
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional, Tuple, Set
from collections import defaultdict
from dataclasses import dataclass, field

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from dotenv import load_dotenv
import requests

# Load environment
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
SERVER_DIR = os.path.join(BASE_DIR, "..", "server")
load_dotenv(os.path.join(SERVER_DIR, ".env"))

# --- Backend server configuration
BACKEND_URL = os.getenv("BACKEND_URL", "http://127.0.0.1:5001")
BATCHER_RESET_URL = f"{BACKEND_URL}/api/ingest/gate/reset"
PLC_SHARED_SECRET = os.getenv("PLC_SHARED_SECRET", "dev-plc-secret")

# InfluxDB 3 client
try:
    from influxdb_client_3 import InfluxDBClient3
except ImportError:
    print("❌ influxdb_client_3 not installed. Run: pip install influxdb3-python")
    sys.exit(1)

# Configuration
INFLUX_HOST = os.getenv("INFLUXDB3_HOST_URL", "http://127.0.0.1:8181")
INFLUX_TOKEN = os.getenv("INFLUXDB3_AUTH_TOKEN")
INFLUX_DB = os.getenv("INFLUXDB3_DATABASE", "batching")
SQLITE_DB = os.path.join(SERVER_DIR, "db", "sqlite", "batching_app.sqlite")

# Polling configuration (only for M3/M4, not M1/M2)
POLL_INTERVAL_SEC = 60.0  # Poll every 60 seconds for M3/M4 calculations

def notify_gate_reset(gate: int, ts_iso: str | None = None) -> None:
    """
    Tell the Node server the batch for `gate` completed so it can:
      - reset in-memory overlay to 0
      - broadcast SSE 'gate' with zeros
      - persist a 0 row to M2 (gate_state)
    """
    if ts_iso is None:
        ts_iso = datetime.now(timezone.utc).isoformat()

    payload = {"gate": int(gate), "timestamp": ts_iso}
    print(f"\n🔄 [RESET] Calling reset endpoint for Gate {gate}...")
    print(f"   URL: {BATCHER_RESET_URL}")
    print(f"   Secret: {'***' + PLC_SHARED_SECRET[-4:] if len(PLC_SHARED_SECRET) > 4 else '***'}")
    print(f"   Payload: {payload}")
    
    try:
        r = requests.post(
            BATCHER_RESET_URL,
            headers={
                "x-plc-secret": PLC_SHARED_SECRET,
                "Content-Type": "application/json",
            },
            json=payload,
            timeout=2.0,
        )
        r.raise_for_status()
        print(f"✅ [RESET] Gate {gate} → {r.status_code} {r.reason}")
    except requests.exceptions.HTTPError as e:
        print(f"❌ [RESET] HTTP Error for Gate {gate}: {e.response.status_code} {e.response.text}")
    except requests.exceptions.ConnectionError as e:
        print(f"❌ [RESET] Connection Error for Gate {gate}: {e}")
    except Exception as e:
        print(f"❌ [RESET] Failed for Gate {gate}: {e}")

# InfluxDB Line Protocol Helpers (exact copy from Node.js import-csv-to-influx.js)
def escape_tag(s):
    """Escape special characters - exact copy from Node.js escapeTag function"""
    return str(s).replace(',', '\\,').replace(' ', '\\ ').replace('=', '\\=')

def to_nanoseconds(dt):
    """Convert datetime to nanoseconds - exact copy from Node.js import script"""
    if isinstance(dt, datetime):
        seconds = dt.timestamp()
        return int(seconds * 1_000_000_000)  # nanoseconds
    return None

def to_line_protocol(measurement, tags, fields, timestamp):
    """Build InfluxDB line protocol string - exact copy from Node.js format"""
    # Tags (comma-separated key=value pairs)
    tag_pairs = ','.join(f"{escape_tag(k)}={escape_tag(v)}" 
                         for k, v in tags.items() 
                         if v is not None and v != '')
    tags_part = f",{tag_pairs}" if tag_pairs else ""
    
    # Fields that should be written as integers (with 'i' suffix) - exact copy from Node.js
    integer_fields = ['pieces_in_gate', 'total_rejects_count']
    
    field_parts = []
    for k, v in fields.items():
        if v is None:
            continue
        key = escape_tag(k)
        
        # Check if this field should be an integer (exact copy from Node.js)
        if k in integer_fields and isinstance(v, (int, float)) and (isinstance(v, int) or v.is_integer()):
            field_parts.append(f"{key}={int(v)}i")
        else:
            # Otherwise write as float (append .0 if integer value) - exact copy from Node.js
            if isinstance(v, (int, float)) and not isinstance(v, bool):
                if isinstance(v, int) or (isinstance(v, float) and v.is_integer()):
                    field_parts.append(f"{key}={int(v)}.0")
                else:
                    field_parts.append(f"{key}={v}")
            else:
                # String values (escaped and quoted)
                escaped = str(v).replace('\\', '\\\\').replace('"', '\\"')
                field_parts.append(f'{key}="{escaped}"')
    
    field_str = ','.join(field_parts)
    if not field_str:
        raise ValueError("At least one field required")
    
    # Timestamp in nanoseconds (exact copy from Node.js)
    ns = to_nanoseconds(timestamp)
    if ns:
        return f"{measurement}{tags_part} {field_str} {ns}"
    else:
        return f"{measurement}{tags_part} {field_str}"

@dataclass
class RecipeSpec:
    """Recipe specification from database"""
    recipe_id: int
    recipe_name: str
    piece_min: int
    piece_max: int
    batch_min: int  # 0 if none
    batch_max: int  # 0 if none
    bc_type: Optional[str]  # 'min'|'max'|'exact'|None
    bc_val: Optional[int]   # None if no limit
    
    @classmethod
    def from_db_row(cls, row):
        """Parse from database row"""
        # Recipe name format: R_x_y_xx_yy_xxx_yyy
        name = row['name']
        try:
            parts = name.split('_')
            piece_min = int(parts[1])
            piece_max = int(parts[2])
            batch_min = int(parts[3])
            batch_max = int(parts[4])
            bc_type = None if parts[5] == 'NA' else parts[5]
            bc_val = None if parts[6] in ('NA', '0', '') else int(parts[6])
        except:
            piece_min = piece_max = batch_min = batch_max = 0
            bc_type = None
            bc_val = None
        
        return cls(
            recipe_id=row['id'],
            recipe_name=name,
            piece_min=piece_min,
            piece_max=piece_max,
            batch_min=batch_min,
            batch_max=batch_max,
            bc_type=bc_type,
            bc_val=bc_val
        )

@dataclass
class PieceData:
    """Single piece"""
    timestamp: datetime
    weight_g: float
    gate: int
    piece_id: Optional[str] = None

@dataclass
class BatchEvent:
    """Batch completion event"""
    timestamp: datetime
    gate: int
    weight_g: float
    piece_count: int

@dataclass
class GateState:
    """Current accumulation state for a gate"""
    gate: int
    recipe_id: Optional[int] = None
    pieces: List[PieceData] = field(default_factory=list)
    total_weight: float = 0.0
    
    def reset(self):
        """Reset after batch completion"""
        self.pieces = []
        self.total_weight = 0.0

@dataclass
class MinuteAccumulator:
    """Accumulates data for a specific minute"""
    minute_start: datetime
    pieces_by_gate: Dict[int, List[PieceData]] = field(default_factory=lambda: defaultdict(list))
    batches_by_gate: Dict[int, List[BatchEvent]] = field(default_factory=lambda: defaultdict(list))
    
    def add_piece(self, piece: PieceData):
        self.pieces_by_gate[piece.gate].append(piece)
    
    def add_batch(self, batch: BatchEvent):
        self.batches_by_gate[batch.gate].append(batch)

# ========== SQLite Helper Functions for M3/M4 ==========

def write_m3_per_recipe_sqlite(sqlite_conn, timestamp, recipe_name, program_id, 
                                 batches_min, giveaway_pct, pieces_processed, 
                                 weight_processed_g, rejects_per_min=0, 
                                 total_rejects_count=0, total_rejects_weight_g=0.0):
    """Write M3 per-recipe KPI to SQLite"""
    ts_str = timestamp.isoformat()
    sqlite_conn.execute("""
        INSERT INTO kpi_minute_recipes (
            timestamp, recipe_name, program_id, batches_min, giveaway_pct,
            pieces_processed, weight_processed_g, rejects_per_min,
            total_rejects_count, total_rejects_weight_g
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (ts_str, recipe_name, program_id, batches_min, giveaway_pct,
          pieces_processed, weight_processed_g, rejects_per_min,
          total_rejects_count, total_rejects_weight_g))
    sqlite_conn.commit()

def write_m3_combined_sqlite(sqlite_conn, timestamp, batches_min, giveaway_pct,
                               pieces_processed, weight_processed_g, rejects_per_min,
                               total_rejects_count, total_rejects_weight_g):
    """Write M3 combined (total) KPI to SQLite"""
    ts_str = timestamp.isoformat()
    sqlite_conn.execute("""
        INSERT INTO kpi_minute_combined (
            timestamp, batches_min, giveaway_pct, pieces_processed,
            weight_processed_g, rejects_per_min, total_rejects_count,
            total_rejects_weight_g
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    """, (ts_str, batches_min, giveaway_pct, pieces_processed,
          weight_processed_g, rejects_per_min, total_rejects_count,
          total_rejects_weight_g))
    sqlite_conn.commit()

def write_m4_totals_sqlite(sqlite_conn, timestamp, recipe_name, program_id,
                             total_batches, giveaway_g_per_batch, giveaway_pct_avg):
    """Write M4 cumulative totals to SQLite"""
    ts_str = timestamp.isoformat()
    sqlite_conn.execute("""
        INSERT INTO kpi_totals (
            timestamp, recipe_name, program_id, total_batches,
            giveaway_g_per_batch, giveaway_pct_avg
        ) VALUES (?, ?, ?, ?, ?, ?)
    """, (ts_str, recipe_name, program_id, total_batches,
          giveaway_g_per_batch, giveaway_pct_avg))
    sqlite_conn.commit()

class LiveWorker:
    """Full-featured live mode worker - M3/M4 KPI calculations only"""
    
    def __init__(self):
        self.influx_client = None
        self.sqlite_conn = None
        self.running = False
        
        # HTTP headers for backend API calls
        self.headers = {
            "x-plc-secret": PLC_SHARED_SECRET,
            "Content-Type": "application/json"
        }
        
        # Recipe management
        self.recipes: Dict[int, RecipeSpec] = {}  # recipe_id -> spec
        self.gate_to_recipe: Dict[int, int] = {}  # gate -> recipe_id (current assignment)
        self.program_id = 1
        
        # Program assignment cycling (for live mode simulation)
        self.program_assignments = []  # List of program configs from JSON
        self.current_program_index = 0
        self.last_program_switch = None
        self.next_program_switch_delay = None  # Calculated from actual program duration
        
        # Live state
        self.gate_states: Dict[int, GateState] = {}
        self.last_processed_time = None
        self.current_minute = None
        self.minute_accumulator = None
        
        # M4 data tracking (cumulative totals per recipe)
        self.m4_cumulative: Dict[int, Dict[str, float]] = {}  # recipe_id -> {total_batches, cum_actual, cum_give}
        
        # Gate dwell time tracking (last batch timestamp per gate)
        self.last_batch_time: Dict[int, datetime] = {}  # gate -> last batch timestamp
        
        # No time shifting needed - timestamps are already current time from simulator/C# app
        
        # Statistics
        self.pieces_processed = 0
        self.batches_detected = 0
        self.kpis_written = 0
        self.total_rejects_count = 0
        self.total_rejects_weight = 0.0
        self.start_time = None
        
        # Performance monitoring
        self.m1_write_times = []  # Track M1 write latencies
        self.m2_write_times = []  # Track M2 write latencies
        self.m3_write_times = []  # Track M3 write latencies
        self.influx_errors = 0
        self.last_performance_log = None
        
    def connect(self):
        """Connect to databases"""
        print("📡 Connecting to databases...")
        
        if not INFLUX_TOKEN:
            print("❌ INFLUXDB3_AUTH_TOKEN not set")
            sys.exit(1)
        
        self.influx_client = InfluxDBClient3(
            host=INFLUX_HOST,
            token=INFLUX_TOKEN,
            database=INFLUX_DB
        )
        print(f"   ✓ InfluxDB: {INFLUX_HOST}")
        
        self.sqlite_conn = sqlite3.connect(SQLITE_DB)
        self.sqlite_conn.row_factory = sqlite3.Row
        print(f"   ✓ SQLite: {SQLITE_DB}")
    
    def recover_incomplete_programs(self):
        """
        Recover programs that were interrupted by worker crash/restart.
        Finds programs with no end_ts and completes their stats calculation.
        """
        print("\n" + "="*70)
        print("🔍 CHECKING FOR INCOMPLETE PROGRAMS")
        print("="*70)
        
        try:
            # Find programs with no end_ts (incomplete)
            incomplete = self.sqlite_conn.execute("""
                SELECT program_id, start_ts
                FROM program_stats
                WHERE end_ts IS NULL
                ORDER BY start_ts DESC
            """).fetchall()
            
            if not incomplete:
                print("✅ No incomplete programs found")
                return
            
            print(f"⚠️  Found {len(incomplete)} incomplete program(s)")
            
            for prog in incomplete:
                program_id = prog[0]
                start_ts = prog[1]
                
                print(f"\n{'─'*70}")
                print(f"Recovering Program ID: {program_id}")
                print(f"Start time: {start_ts}")
                
                # Get program name
                prog_info = self.sqlite_conn.execute("""
                    SELECT name FROM programs WHERE id = ?
                """, (program_id,)).fetchone()
                
                if not prog_info:
                    print(f"   ⚠️  Program {program_id} not found in programs table, skipping")
                    continue
                
                program_name = prog_info[0]
                print(f"Program name: {program_name}")
                
                # Find last batch completion time for this program
                last_batch = self.sqlite_conn.execute("""
                    SELECT MAX(completed_at) as last_batch_time, COUNT(*) as batch_count
                    FROM batch_completions
                    WHERE program_id = ?
                """, (program_id,)).fetchone()
                
                batch_count = last_batch[1] if last_batch else 0
                
                if batch_count == 0:
                    print(f"   ℹ️  No batches found - marking as ended without processing")
                    # Just set end_ts to start_ts (empty program)
                    end_ts = start_ts
                else:
                    last_batch_time = last_batch[0]
                    print(f"   ✓ Found {batch_count} batches, last at {last_batch_time}")
                    end_ts = last_batch_time
                
                # Now calculate and write stats using existing function
                print(f"   📊 Calculating program totals...")
                
                try:
                    self.calculate_and_write_program_totals(
                        program_id=program_id,
                        start_ts=start_ts,
                        end_ts=end_ts
                    )
                    print(f"   ✅ Successfully recovered program {program_id}")
                    
                except Exception as e:
                    print(f"   ❌ Error recovering program {program_id}: {e}")
                    import traceback
                    traceback.print_exc()
                    
                    # Still set end_ts even if calculation failed
                    self.sqlite_conn.execute("""
                        UPDATE program_stats
                        SET end_ts = ?, updated_at = CURRENT_TIMESTAMP
                        WHERE program_id = ?
                    """, (end_ts, program_id))
                    self.sqlite_conn.commit()
                    print(f"   ⚠️  Marked program as ended despite calculation error")
            
            print("\n" + "="*70)
            print("✅ RECOVERY COMPLETE")
            print("="*70 + "\n")
            
        except Exception as e:
            print(f"❌ Error in recover_incomplete_programs: {e}")
            import traceback
            traceback.print_exc()
        
    def disconnect(self):
        if self.influx_client:
            self.influx_client.close()
        if self.sqlite_conn:
            self.sqlite_conn.close()
    
    def load_recipes(self):
        """Load recipe specs from SQLite"""
        print("📋 Loading recipe specifications...")
        
        cur = self.sqlite_conn.execute("""
            SELECT id, name FROM recipes
        """)
        
        for row in cur.fetchall():
            spec = RecipeSpec.from_db_row(row)
            self.recipes[spec.recipe_id] = spec
        
        print(f"   ✓ Loaded {len(self.recipes)} recipes")
    
    def load_program_assignments_from_json(self):
        """Load program assignments from simulator JSON file with real duration calculation"""
        json_path = os.path.join(BASE_DIR, "..", "simulator", "data", "program_assignments.json")
        
        if not os.path.exists(json_path):
            print("   ⚠️  No program_assignments.json found - using static assignment")
            return False
        
        with open(json_path, 'r') as f:
            data = json.load(f)
            self.program_assignments = data.get('assignments', [])
        
        print(f"   ✓ Loaded {len(self.program_assignments)} program configurations")
        
        # Calculate real durations from timestamps
        if self.program_assignments:
            self.current_program_index = 0
            self.last_program_switch = datetime.now(timezone.utc)
            
            # Calculate duration from first program's start to second program's start
            if len(self.program_assignments) > 1:
                current_ts = datetime.fromisoformat(self.program_assignments[0]['timestamp'])
                next_ts = datetime.fromisoformat(self.program_assignments[1]['timestamp'])
                duration_seconds = (next_ts - current_ts).total_seconds()
                self.next_program_switch_delay = duration_seconds / 60.0  # Convert to minutes
            else:
                # Only one program, run indefinitely
                self.next_program_switch_delay = float('inf')
            
            print("\n" + "="*70)
            print(f"🔄 PROGRAM MANAGER INITIALIZED (REAL DURATIONS)")
            print(f"   Starting with program index {self.current_program_index}")
            if self.next_program_switch_delay != float('inf'):
                print(f"   ⏰ Real duration: {self.next_program_switch_delay:.1f} minutes")
            else:
                print(f"   ⏰ Single program mode (runs indefinitely)")
            print("="*70 + "\n")
            return True
        
        return False
    
    def _get_recipe_id_from_name(self, recipe_name: str) -> Optional[int]:
        """
        Get or create recipe by name in SQLite.
        Returns the SQLite recipe ID, creating the recipe if it doesn't exist.
        """
        if not recipe_name or not recipe_name.startswith('R_'):
            return None
        
        try:
            # Check if recipe already exists
            existing = self.sqlite_conn.execute("""
                SELECT id FROM recipes WHERE name = ?
            """, (recipe_name,)).fetchone()
            
            if existing:
                return existing[0]
            
            # Recipe doesn't exist, create it
            print(f"   ✨ Creating new recipe: {recipe_name}")
            
            # Parse recipe name: R_pieceMin_pieceMax_batchMin_batchMax_countType_countVal
            parts = recipe_name.split('_')
            if parts[0] != 'R' or len(parts) < 7:
                print(f"   ⚠️  Invalid recipe format: {recipe_name}")
                return None
            
            piece_min = int(parts[1]) if parts[1] != 'NA' else 0
            piece_max = int(parts[2]) if parts[2] != 'NA' else 0
            batch_min = int(parts[3]) if parts[3] != 'NA' else 0
            batch_max = int(parts[4]) if parts[4] != 'NA' else 0
            count_type = None if parts[5] == 'NA' else parts[5]
            count_val = None if parts[6] in ('NA', '0', '') else int(parts[6])
            
            # Insert recipe
            cur = self.sqlite_conn.execute("""
                INSERT INTO recipes (
                    name, piece_min_weight_g, piece_max_weight_g,
                    batch_min_weight_g, batch_max_weight_g,
                    min_pieces_per_batch, max_pieces_per_batch
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """, (recipe_name, piece_min, piece_max, batch_min, batch_max, count_val, None))
            
            self.sqlite_conn.commit()
            recipe_id = cur.lastrowid
            
            print(f"   ✅ Created recipe {recipe_name} (ID: {recipe_id})")
            return recipe_id
            
        except Exception as e:
            print(f"   ⚠️  Error getting/creating recipe {recipe_name}: {e}")
            import traceback
            traceback.print_exc()
            return None
    
    def apply_program_assignment(self, assignment_config):
        """Apply a program assignment to SQLite with current timestamp"""
        try:
            now = datetime.now(timezone.utc)
            gate_assignments = assignment_config['gate_assignments']
            
            # Generate unique program name based on LOCAL timestamp for live mode
            # Format: program_YYYYMMDD_HHMMSS (in local deployment timezone)
            # Auto-detects system timezone (or uses LOCAL_TIMEZONE env var if explicitly set)
            from dateutil import tz
            local_tz_name = os.getenv("LOCAL_TIMEZONE")
            if local_tz_name:
                # Use explicitly configured timezone
                local_tz = tz.gettz(local_tz_name)
            else:
                # Auto-detect system's local timezone
                local_tz = datetime.now().astimezone().tzinfo
            local_now = now.astimezone(local_tz)
            program_name = f"program_{local_now.strftime('%Y%m%d_%H%M%S')}"
            
            # Check if program exists by name (should be unique due to timestamp)
            existing_program = self.sqlite_conn.execute("""
                SELECT id FROM programs WHERE name = ?
            """, (program_name,)).fetchone()
            
            if existing_program:
                program_id = existing_program[0]
                print(f"   ℹ️  Using existing program: {program_name} (ID: {program_id})")
            else:
                # Create new program with timestamp-based name
                cur = self.sqlite_conn.execute("""
                    INSERT INTO programs (name, gates)
                    VALUES (?, ?)
                """, (program_name, 8))
                program_id = cur.lastrowid
                self.sqlite_conn.commit()
                print(f"   ✨ Created new program: {program_name} (ID: {program_id})")
            
            # Create a new config in SQLite
            config_name = f"Live_{program_name}"
            
            cur = self.sqlite_conn.execute("""
                INSERT INTO run_configs (name, source, program_id)
                VALUES (?, ?, ?)
            """, (config_name, "program", program_id))
            
            config_id = cur.lastrowid
            
            # Insert gate assignments
            for gate_str, recipe_name in gate_assignments.items():
                gate = int(gate_str)
                
                # Look up recipe ID in SQLite (recipes should already exist from replay mode import)
                recipe_id = self._get_recipe_id_from_name(recipe_name)
                
                if recipe_id:
                    self.sqlite_conn.execute("""
                        INSERT INTO run_config_assignments (config_id, gate_number, recipe_id)
                        VALUES (?, ?, ?)
                    """, (config_id, gate, recipe_id))
                    
                    # Update local mapping
                    self.gate_to_recipe[gate] = recipe_id
                    print(f"   ✓ Assigned gate {gate} to recipe {recipe_name} (SQLite ID: {recipe_id})")
                else:
                    print(f"   ⚠️  Failed to parse or create recipe {recipe_name}")
            
            # Add to settings history
            self.sqlite_conn.execute("""
                INSERT INTO settings_history (changed_at, mode, active_config_id, note, user_id)
                VALUES (?, ?, ?, ?, NULL)
            """, (now.isoformat(), "preset", config_id, f"Live mode: Program {program_id}"))
            
            # Create or update program_stats to mark program as active
            # Check if program_stats already exists for this program
            existing_stats = self.sqlite_conn.execute("""
                SELECT program_id, start_ts, end_ts FROM program_stats WHERE program_id = ?
            """, (program_id,)).fetchone()
            
            if existing_stats:
                # Program exists, start a new run period (update start_ts, clear end_ts)
                print(f"   🔄 Starting new run for program {program_id}")
                self.sqlite_conn.execute("""
                    UPDATE program_stats
                    SET start_ts = ?, end_ts = NULL, updated_at = CURRENT_TIMESTAMP
                    WHERE program_id = ?
                """, (now.isoformat(), program_id))
            else:
                # Program stats don't exist, create new entry
                print(f"   ✨ Creating new program_stats for program {program_id}")
                self.sqlite_conn.execute("""
                    INSERT INTO program_stats (
                        program_id, total_batches, total_batched_weight_g, 
                        total_reject_weight_g, total_giveaway_weight_g,
                        total_items_batched, total_items_rejected,
                        start_ts, end_ts
                    ) VALUES (?, 0, 0, 0, 0, 0, 0, ?, NULL)
                """, (program_id, now.isoformat()))
            
            self.sqlite_conn.commit()
            self.program_id = program_id
            
            # Reset M4 cumulative data for new program
            self.m4_cumulative = {}
            
            # Reset reject counters for new program
            self.total_rejects_count = 0
            self.total_rejects_weight = 0.0
            print(f"   🔄 Reset reject counters for new program")
            
            # Reset gate dwell time tracking for new program
            self.last_batch_time = {}
            print(f"   🔄 Reset gate dwell time tracking for new program")
            
            print(f"   ✅ Applied program {program_id} with {len(gate_assignments)} gate assignments")
            
            # Notify backend to reload recipe assignments
            try:
                reload_url = f"{BACKEND_URL}/api/ingest/reload-assignments"
                resp = requests.post(reload_url, headers=self.headers, timeout=2)
                if resp.status_code == 200:
                    print(f"   ✅ Backend reloaded assignments")
                else:
                    print(f"   ⚠️  Backend reload failed: {resp.status_code}")
            except Exception as e:
                print(f"   ⚠️  Failed to notify backend: {e}")
            
        except Exception as e:
            print(f"   ⚠️  Error applying program assignment: {e}")
    
    def calculate_and_write_program_totals(self, program_id: int, start_ts: str, end_ts: str):
        """
        Calculate program and recipe totals for the completed program period.
        Implements the logic from one_time_import.py compute_window_kpis().
        
        This queries the batch_completions table to get all batches for this program,
        then calculates filled batch equivalents and giveaway per recipe.
        """
        try:
            print(f"\n📊 Calculating totals for Program {program_id} ({start_ts} to {end_ts})")
            
            # Get all batches for this program from batch_completions table
            batches_query = """
                SELECT id, gate, weight_g, pieces, completed_at
                FROM batch_completions
                WHERE completed_at >= ? AND completed_at < ?
                ORDER BY completed_at
            """
            batches = self.sqlite_conn.execute(batches_query, (start_ts, end_ts)).fetchall()
            
            if not batches:
                print(f"   ℹ️  No batches found for program {program_id}")
                return
            
            print(f"   📦 Processing {len(batches)} batches")
            
            # Build a mapping of gates to recipes for this program
            # Try method 1: Get from run_configs directly for this program
            config_row = self.sqlite_conn.execute("""
                SELECT id FROM run_configs 
                WHERE program_id = ? 
                ORDER BY id DESC 
                LIMIT 1
            """, (program_id,)).fetchone()
            
            if config_row:
                config_id = config_row[0]
                print(f"   ✓ Found run_config {config_id} for program {program_id}")
            else:
                # Method 2: For live programs without run_configs (crash before config creation),
                # try to reconstruct assignments from batch_completions.recipe_id
                print(f"   ⚠️  No run_config found for program {program_id}, attempting reconstruction...")
                
                # Get unique recipe_id and gate combinations from batch_completions
                recon_query = """
                    SELECT DISTINCT gate, recipe_id
                    FROM batch_completions
                    WHERE program_id = ? AND recipe_id IS NOT NULL
                    ORDER BY gate
                """
                recon_rows = self.sqlite_conn.execute(recon_query, (program_id,)).fetchall()
                
                if not recon_rows:
                    print(f"   ❌ Cannot reconstruct - no batch completions with recipe_id found")
                    print(f"   ⚠️  Marking program {program_id} as ended without stats")
                    # Just set end_ts and return
                    self.sqlite_conn.execute("""
                        UPDATE program_stats
                        SET end_ts = ?, updated_at = CURRENT_TIMESTAMP
                        WHERE program_id = ?
                    """, (end_ts, program_id))
                    self.sqlite_conn.commit()
                    return
                
                # Create temporary config from reconstructed data
                print(f"   ℹ️  Reconstructed {len(recon_rows)} gate assignments from batches:")
                config_id = None  # Will use reconstructed mapping directly
                
                # Build mappings from reconstructed data
                gate_to_recipe_id = {}
                gate_to_recipe_name = {}
                recipe_id_to_gates = defaultdict(list)
                
                for gate_num, recipe_id in recon_rows:
                    # Get recipe name
                    recipe_row = self.sqlite_conn.execute("SELECT name FROM recipes WHERE id = ?", (recipe_id,)).fetchone()
                    recipe_name = recipe_row[0] if recipe_row else f"Unknown_{recipe_id}"
                    
                    gate_to_recipe_id[gate_num] = recipe_id
                    gate_to_recipe_name[gate_num] = recipe_name
                    recipe_id_to_gates[recipe_id].append(gate_num)
                    print(f"      Gate {gate_num} → {recipe_name} (ID: {recipe_id}) [reconstructed]")
            
            # Get gate assignments from config (if config_id exists)
            if config_id is not None:
                assignments_query = """
                    SELECT rca.gate_number, rca.recipe_id, r.name
                    FROM run_config_assignments rca
                    JOIN recipes r ON r.id = rca.recipe_id
                    WHERE rca.config_id = ?
                """
                assignments_rows = self.sqlite_conn.execute(assignments_query, (config_id,)).fetchall()
                
                gate_to_recipe_id = {}
                gate_to_recipe_name = {}
                recipe_id_to_gates = defaultdict(list)
                
                print(f"   🔍 Found {len(assignments_rows)} gate assignments at {start_ts}")
                for gate_num, recipe_id, recipe_name in assignments_rows:
                    gate_to_recipe_id[gate_num] = recipe_id
                    gate_to_recipe_name[gate_num] = recipe_name
                    recipe_id_to_gates[recipe_id].append(gate_num)
                    print(f"      Gate {gate_num} → {recipe_name} (ID: {recipe_id})")
            
            if not gate_to_recipe_id:
                print(f"   ⚠️  No recipe assignments found for program {program_id}")
                return
            
            # Show which gates are assigned
            assigned_gates = set(gate_to_recipe_id.keys())
            batch_gates = set(b[1] for b in batches)
            unassigned_gates = batch_gates - assigned_gates
            if unassigned_gates:
                unassigned_count = sum(1 for b in batches if b[1] in unassigned_gates)
                print(f"   ℹ️  Skipping {unassigned_count} batches from unassigned gates: {sorted(unassigned_gates)}")
            
            # Calculate per-recipe totals using filled batch equivalent logic
            per_recipe_totals = {}
            total_filled = 0.0
            total_w_batched = 0.0
            total_w_give = 0.0
            
            for recipe_id, gates in recipe_id_to_gates.items():
                recipe_name = gate_to_recipe_name[gates[0]]
                
                # Parse recipe spec from name
                try:
                    _, x, y, xx, yy, xxx, yyy = recipe_name.split('_', 6)
                    lo_p, hi_p = int(x), int(y)
                    lo_b, hi_b = int(xx), int(yy)
                    bc_type = None if xxx == 'NA' else xxx
                    bc_val = None if yyy in ('NA', '', None) else int(float(yyy))
                except Exception:
                    lo_p = hi_p = lo_b = hi_b = 0
                    bc_type = None
                    bc_val = None
                
                # Filter batches for this recipe's gates
                recipe_batches = [b for b in batches if b[1] in gates]
                
                if not recipe_batches:
                    continue
                
                filled_equiv = 0.0
                w_target_sum = 0.0
                w_actual_sum = sum(float(b[2]) for b in recipe_batches)
                
                for batch in recipe_batches:
                    weight = float(batch[2])
                    piece_count = int(batch[3])
                    
                    # Apply filled batch equivalent logic (from one_time_import.py)
                    if bc_type in ('exact', 'min') and bc_val:
                        if bc_type == 'exact':
                            this_fill = 1.0 if piece_count == bc_val else (piece_count / float(bc_val))
                        else:  # 'min'
                            this_fill = 1.0 if piece_count >= bc_val else (piece_count / float(bc_val))
                        this_target = this_fill * (bc_val * lo_p if bc_val else 0.0)
                    else:
                        # Weight-based recipe
                        if lo_b <= 0:
                            this_fill = 1.0
                            this_target = weight
                        else:
                            this_fill = 1.0 if weight >= lo_b else weight / float(lo_b)
                            this_target = this_fill * lo_b
                    
                    filled_equiv += this_fill
                    w_target_sum += this_target
                
                w_give = max(0.0, w_actual_sum - w_target_sum)
                
                # Calculate per-recipe rejects: pieces eligible by weight but sent to gate 0
                # Query InfluxDB for all pieces within this recipe's weight bounds
                w_rej = 0.0
                i_rej = 0
                
                try:
                    # Get pieces that match this recipe's piece weight bounds
                    eligible_query = f"""
                        SELECT gate, weight_g
                        FROM pieces
                        WHERE time >= '{start_ts}' 
                          AND time <= '{end_ts}'
                          AND weight_g >= {lo_p}
                          AND weight_g <= {hi_p}
                    """
                    table = self.influx_client.query(eligible_query)
                    
                    if table is not None:
                        # Convert PyArrow table to dict for easier access
                        reader = table.to_reader()
                        for batch in reader:
                            data_dict = batch.to_pydict()
                            num_rows = len(data_dict['gate'])
                            
                            for i in range(num_rows):
                                gate = int(data_dict['gate'][i]) if data_dict['gate'][i] is not None else 0
                                weight = float(data_dict['weight_g'][i]) if data_dict['weight_g'][i] is not None else 0.0
                                
                                # Reject = eligible piece that didn't go to this recipe's gates
                                if gate not in gates:
                                    w_rej += weight
                                    i_rej += 1
                    
                    print(f"      Rejects: {i_rej} pieces, {w_rej:.1f}g (eligible but not assigned to gates {sorted(gates)})")
                
                except Exception as e:
                    print(f"      ⚠️  Could not query reject data for recipe {recipe_id}: {e}")
                    import traceback
                    traceback.print_exc()
                    w_rej = 0.0
                    i_rej = 0
                
                i_bat = sum(int(b[3]) for b in recipe_batches)
                
                # Create gates_assigned string (comma-separated, sorted)
                gates_str = ','.join(str(g) for g in sorted(gates))
                
                per_recipe_totals[recipe_id] = {
                    "total_batches": float(filled_equiv),
                    "total_batched_weight_g": int(w_target_sum),
                    "total_reject_weight_g": int(w_rej),
                    "total_giveaway_weight_g": int(round(w_give)),
                    "total_items_batched": i_bat,
                    "total_items_rejected": i_rej,
                    "gates_assigned": gates_str
                }
                
                total_filled += filled_equiv
                total_w_batched += w_target_sum
                total_w_give += w_give
                
                print(f"   ✅ {recipe_name}: {filled_equiv:.1f} batches, {int(w_target_sum):,}g batched, {int(round(w_give)):,}g giveaway")
            
            # Calculate program totals
            # Query reject totals from SQLite (M3 combined) or InfluxDB
            reject_count = 0
            reject_weight = 0.0
            
            try:
                # Try to get from kpi_minute_combined (cumulative totals)
                reject_query = self.sqlite_conn.execute("""
                    SELECT MAX(total_rejects_count) as max_count, 
                           MAX(total_rejects_weight_g) as max_weight
                    FROM kpi_minute_combined
                    WHERE timestamp >= ? AND timestamp <= ?
                """, (start_ts, end_ts)).fetchone()
                
                if reject_query and reject_query[0]:
                    reject_count = int(reject_query[0])
                    reject_weight = float(reject_query[1])
                    print(f"   ✓ Found reject data from SQLite: {reject_count} pieces, {reject_weight:.1f}g")
                else:
                    # Fallback: Query InfluxDB for gate 0 pieces
                    try:
                        query = f"""
                            SELECT COUNT(*) as count, SUM(weight_g) as weight
                            FROM pieces
                            WHERE gate = 0 
                              AND time >= '{start_ts}' 
                              AND time <= '{end_ts}'
                        """
                        table = self.influx_client.query(query)
                        if table is not None:
                            reader = table.to_reader()
                            for batch in reader:
                                data_dict = batch.to_pydict()
                                if data_dict and 'count' in data_dict and 'weight' in data_dict:
                                    reject_count = int(data_dict['count'][0]) if data_dict['count'][0] else 0
                                    reject_weight = float(data_dict['weight'][0]) if data_dict['weight'][0] else 0.0
                                    print(f"   ✓ Found reject data from InfluxDB: {reject_count} pieces, {reject_weight:.1f}g")
                                    break
                    except Exception as e:
                        print(f"   ⚠️  Could not query InfluxDB for rejects: {e}")
                        import traceback
                        traceback.print_exc()
            except Exception as e:
                print(f"   ⚠️  Error querying reject data: {e}")
            
            program_totals = {
                "total_batches": float(total_filled),
                "total_batched_weight_g": int(total_w_batched),
                "total_reject_weight_g": int(reject_weight),
                "total_giveaway_weight_g": int(round(total_w_give)),
                "total_items_batched": sum(rt["total_items_batched"] for rt in per_recipe_totals.values()),
                "total_items_rejected": reject_count
            }
            
            # Write program_stats
            self.sqlite_conn.execute("""
                UPDATE program_stats
                SET total_batches = ?,
                    total_batched_weight_g = ?,
                    total_reject_weight_g = ?,
                    total_giveaway_weight_g = ?,
                    total_items_batched = ?,
                    total_items_rejected = ?,
                    start_ts = ?,
                    end_ts = ?,
                    updated_at = CURRENT_TIMESTAMP
                WHERE program_id = ?
            """, (
                program_totals["total_batches"],
                program_totals["total_batched_weight_g"],
                program_totals["total_reject_weight_g"],
                program_totals["total_giveaway_weight_g"],
                program_totals["total_items_batched"],
                program_totals["total_items_rejected"],
                start_ts,
                end_ts,
                program_id
            ))
            
            # Write recipe_stats
            for recipe_id, totals in per_recipe_totals.items():
                self.sqlite_conn.execute("""
                    INSERT INTO recipe_stats (
                        program_id, recipe_id, gates_assigned,
                        total_batches, total_batched_weight_g,
                        total_reject_weight_g, total_giveaway_weight_g,
                        total_items_batched, total_items_rejected,
                        updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                    ON CONFLICT(program_id, recipe_id) DO UPDATE SET
                        gates_assigned = excluded.gates_assigned,
                        total_batches = excluded.total_batches,
                        total_batched_weight_g = excluded.total_batched_weight_g,
                        total_reject_weight_g = excluded.total_reject_weight_g,
                        total_giveaway_weight_g = excluded.total_giveaway_weight_g,
                        total_items_batched = excluded.total_items_batched,
                        total_items_rejected = excluded.total_items_rejected,
                        updated_at = CURRENT_TIMESTAMP
                """, (
                    program_id, recipe_id, totals["gates_assigned"],
                    totals["total_batches"],
                    totals["total_batched_weight_g"],
                    totals["total_reject_weight_g"],
                    totals["total_giveaway_weight_g"],
                    totals["total_items_batched"],
                    totals["total_items_rejected"]
                ))
            
            self.sqlite_conn.commit()
            
            print(f"   ✅ Program totals: {program_totals['total_batches']:.1f} batches, " +
                  f"{program_totals['total_batched_weight_g']:,}g batched, " +
                  f"{program_totals['total_giveaway_weight_g']:,}g giveaway, " +
                  f"{program_totals['total_items_rejected']} rejects")
            print(f"   ✅ Written stats for {len(per_recipe_totals)} recipes")
            
        except Exception as e:
            print(f"\n" + "="*70)
            print(f"❌ ERROR in calculate_and_write_program_totals")
            print(f"   Program ID: {program_id}")
            print(f"   Start: {start_ts}")
            print(f"   End: {end_ts}")
            print(f"   Error: {e}")
            print("="*70)
            import traceback
            traceback.print_exc()
            print("="*70 + "\n")
    
    def check_and_switch_program(self):
        """Check if it's time to switch to next program, and do so if needed"""
        if not self.program_assignments or self.last_program_switch is None:
            return
        
        now = datetime.now(timezone.utc)
        elapsed_minutes = (now - self.last_program_switch).total_seconds() / 60
        
        if elapsed_minutes >= self.next_program_switch_delay:
            # Calculate and write program totals before ending
            if self.program_id:
                try:
                    # Get start_ts for this program
                    stats_row = self.sqlite_conn.execute("""
                        SELECT start_ts FROM program_stats WHERE program_id = ? AND end_ts IS NULL
                    """, (self.program_id,)).fetchone()
                    
                    if stats_row:
                        start_ts = stats_row[0]
                        end_ts = now.isoformat()
                        
                        # Calculate filled batch equivalents and write stats
                        self.calculate_and_write_program_totals(self.program_id, start_ts, end_ts)
                        
                        print(f"   ⏹  Ended program {self.program_id}")
                    else:
                        print(f"   ⚠️  No active program_stats found for program {self.program_id}")
                except Exception as e:
                    print(f"   ⚠️  Error ending program {self.program_id}: {e}")
            
            # Switch to next program
            self.current_program_index = (self.current_program_index + 1) % len(self.program_assignments)
            assignment = self.program_assignments[self.current_program_index]
            
            print("\n" + "="*70)
            print(f"🔄 PROGRAM SWITCH")
            print(f"   New program: {assignment['program_id']} (config {self.current_program_index + 1}/{len(self.program_assignments)})")
            self.apply_program_assignment(assignment)
            
            # Calculate next duration from program timestamps
            self.last_program_switch = now
            next_index = (self.current_program_index + 1) % len(self.program_assignments)
            
            if next_index != 0:  # Not looping back to start
                current_ts = datetime.fromisoformat(self.program_assignments[self.current_program_index]['timestamp'])
                next_ts = datetime.fromisoformat(self.program_assignments[next_index]['timestamp'])
                duration_seconds = (next_ts - current_ts).total_seconds()
                self.next_program_switch_delay = duration_seconds / 60.0
                print(f"   ⏰ Real duration: {self.next_program_switch_delay:.1f} minutes")
            else:
                # Looping back - use duration from last to first
                current_ts = datetime.fromisoformat(self.program_assignments[self.current_program_index]['timestamp'])
                first_ts = datetime.fromisoformat(self.program_assignments[0]['timestamp'])
                # This would be negative, so just use a reasonable default
                self.next_program_switch_delay = 180.0  # 3 hours
                print(f"   ⏰ Looping back - using default: {self.next_program_switch_delay:.1f} minutes")
            
            print("="*70 + "\n")
    
    def load_current_assignments(self):
        """
        Load current gate-to-recipe assignments.
        TODO: In production, this should listen for changes from the UI
        """
        print("🔧 Loading gate assignments...")
        
        # Get most recent assignment from settings_history
        cur = self.sqlite_conn.execute("""
            SELECT sh.active_config_id
            FROM settings_history sh
            WHERE sh.active_config_id IS NOT NULL
            ORDER BY sh.changed_at DESC
            LIMIT 1
        """)
        
        row = cur.fetchone()
        if not row:
            print("   ⚠️  No active configuration found")
            return
        
        config_id = row['active_config_id']
        
        # Get assignments for this config
        cur = self.sqlite_conn.execute("""
            SELECT gate_number, recipe_id
            FROM run_config_assignments
            WHERE config_id = ?
        """, (config_id,))
        
        for row in cur.fetchall():
            gate = row['gate_number']
            recipe_id = row['recipe_id']
            if recipe_id:
                self.gate_to_recipe[gate] = recipe_id
        
        print(f"   ✓ Loaded assignments for {len(self.gate_to_recipe)} gates")
        for gate, recipe_id in sorted(self.gate_to_recipe.items()):
            recipe_name = self.recipes[recipe_id].recipe_name if recipe_id in self.recipes else "unknown"
            print(f"      Gate {gate} → {recipe_name}")
    
    
    def poll_completed_batches(self) -> List[Dict]:
        """Poll SQLite for completed batches since last check"""
        try:
            if not hasattr(self, 'last_batch_id_processed'):
                self.last_batch_id_processed = 0
            
            cur = self.sqlite_conn.execute("""
                SELECT id, gate, completed_at, pieces, weight_g, recipe_id
                FROM batch_completions
                WHERE id > ?
                ORDER BY id ASC
            """, (self.last_batch_id_processed,))
            
            batches = []
            for row in cur.fetchall():
                batch_id, gate, completed_at, pieces, weight_g, recipe_id = row
                batches.append({
                    'id': batch_id,
                    'gate': gate,
                    'completed_at': completed_at,
                    'pieces': pieces,
                    'weight_g': weight_g,
                    'recipe_id': recipe_id
                })
                self.last_batch_id_processed = batch_id
            
            # Batch polling logging disabled for cleaner output
            # if batches:
            #     print(f"   📦 Found {len(batches)} completed batches from backend (IDs {batches[0]['id']}-{batches[-1]['id']})")
            
            return batches
        except Exception as e:
            print(f"   ❌ Error polling completed batches: {e}")
            return []
    
    def poll_new_pieces(self) -> List[PieceData]:
        """Poll InfluxDB for new pieces"""
        try:
            if self.last_processed_time is None:
                from_time = datetime.now(timezone.utc) - timedelta(seconds=1)
            else:
                from_time = self.last_processed_time
            
            to_time = datetime.now(timezone.utc)
            
            sql = f"""
                SELECT time, weight_g, gate, piece_id
                FROM pieces
                WHERE time >= '{from_time.isoformat()}'
                  AND time < '{to_time.isoformat()}'
                ORDER BY time ASC
            """
            
            table = self.influx_client.query(sql)
            pieces = []
            
            # Process PyArrow table directly
            if table is not None and len(table) > 0:
                # Convert to Python dictionary for easier access
                data_dict = table.to_pydict()
                num_rows = len(data_dict['time'])
                
                for i in range(num_rows):
                    timestamp = data_dict['time'][i]
                    if isinstance(timestamp, str):
                        timestamp = datetime.fromisoformat(timestamp.replace('Z', '+00:00'))
                    elif hasattr(timestamp, 'to_pydatetime'):
                        timestamp = timestamp.to_pydatetime()
                    elif not isinstance(timestamp, datetime):
                        timestamp = datetime.fromisoformat(str(timestamp).replace('Z', '+00:00'))
                    
                    # Ensure timestamp is timezone-aware
                    if isinstance(timestamp, datetime) and timestamp.tzinfo is None:
                        timestamp = timestamp.replace(tzinfo=timezone.utc)
                    
                    gate_val = data_dict.get('gate', [0] * num_rows)[i]
                    piece_id_val = data_dict.get('piece_id', [None] * num_rows)[i]
                    
                    pieces.append(PieceData(
                        timestamp=timestamp,
                        weight_g=float(data_dict['weight_g'][i]),
                        gate=int(gate_val) if gate_val is not None else 0,
                        piece_id=str(piece_id_val) if piece_id_val is not None else None
                    ))
            
            self.last_processed_time = to_time
            return pieces
            
        except Exception as e:
            import traceback
            print(f"⚠️  Error polling pieces: {e}")
            traceback.print_exc()
            return []
    
    # ✅ REMOVED: detect_batch() - Batch detection now handled by backend JavaScript
    # Backend writes to batch_completions table, Python worker reads from it
    
    # ✅ REMOVED: write_m2() - M2 (gate_state) is now written by backend JavaScript in real-time
    # This worker only handles M3/M4 KPI calculations
    
    def process_piece(self, piece: PieceData):
        """Process a single piece - update gates, detect batches, accumulate"""
        gate = piece.gate
        
        # Initialize gate state if needed
        if gate not in self.gate_states:
            recipe_id = self.gate_to_recipe.get(gate)
            self.gate_states[gate] = GateState(gate=gate, recipe_id=recipe_id)
        
        state = self.gate_states[gate]
        
        # Validate piece weight against recipe specifications
        if gate != 0 and state.recipe_id and state.recipe_id in self.recipes:
            recipe = self.recipes[state.recipe_id]
            weight = piece.weight_g
            
            # Check if piece weight is within allowed range
            # Piece weight validation logging disabled for cleaner output
            # if recipe.piece_min > 0 and weight < recipe.piece_min:
            #     print(f"   ⚠️  Gate {gate}: Piece weight {weight}g below minimum {recipe.piece_min}g (recipe: {recipe.recipe_name})")
            # elif recipe.piece_max > 0 and weight > recipe.piece_max:
            #     print(f"   ⚠️  Gate {gate}: Piece weight {weight}g above maximum {recipe.piece_max}g (recipe: {recipe.recipe_name})")
            # else:
            #     print(f"   ✅ Gate {gate}: Piece weight {weight}g within range {recipe.piece_min}-{recipe.piece_max}g (recipe: {recipe.recipe_name})")
            pass
        
        # Accumulate piece for M3/M4 calculations
        # (Batch detection is handled by backend - we'll read completed batches from SQLite)
        self.accumulate_for_minute(piece, None)
        self.pieces_processed += 1
    
    def update_gate_dwell_accumulator(self, gate: int, dwell_time_sec: float):
        """Update Welford accumulator for gate dwell statistics"""
        try:
            # Fetch current accumulator state
            row = self.sqlite_conn.execute("""
                SELECT sample_count, mean_sec, m2_sec, min_sec, max_sec
                FROM gate_dwell_accumulators 
                WHERE program_id = ? AND gate_number = ?
            """, (self.program_id, gate)).fetchone()
            
            if row:
                n, mean, m2, min_sec, max_sec = row
                n = int(n)
                mean = float(mean)
                m2 = float(m2)
            else:
                n, mean, m2, min_sec, max_sec = 0, 0.0, 0.0, None, None
            
            # Welford's online algorithm
            n += 1
            delta = dwell_time_sec - mean
            mean += delta / n
            delta2 = dwell_time_sec - mean
            m2 += delta * delta2
            
            min_sec = dwell_time_sec if min_sec is None else min(min_sec, dwell_time_sec)
            max_sec = dwell_time_sec if max_sec is None else max(max_sec, dwell_time_sec)
            
            # Update accumulator
            self.sqlite_conn.execute("""
                INSERT INTO gate_dwell_accumulators 
                (program_id, gate_number, sample_count, mean_sec, m2_sec, min_sec, max_sec, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT(program_id, gate_number) DO UPDATE SET
                    sample_count = excluded.sample_count,
                    mean_sec = excluded.mean_sec,
                    m2_sec = excluded.m2_sec,
                    min_sec = excluded.min_sec,
                    max_sec = excluded.max_sec,
                    updated_at = CURRENT_TIMESTAMP
            """, (self.program_id, gate, n, mean, m2, min_sec, max_sec))
        except Exception as e:
            print(f"   ⚠️  Error updating gate dwell accumulator: {e}")
    
    def process_completed_batch(self, batch: Dict):
        """Process a completed batch from backend for M3/M4 calculations"""
        try:
            # Parse timestamp
            batch_time = datetime.fromisoformat(batch['completed_at'].replace('Z', '+00:00'))
            minute_bucket = batch_time.replace(second=0, microsecond=0)
            gate = batch['gate']
            
            # Track gate dwell time
            if gate != 0:  # Don't track reject gate
                if gate in self.last_batch_time:
                    # Calculate dwell time (time since last batch on this gate)
                    dwell_time_sec = (batch_time - self.last_batch_time[gate]).total_seconds()
                    
                    # Write to database
                    try:
                        self.sqlite_conn.execute("""
                            INSERT INTO gate_dwell_times (program_id, gate_number, dwell_time_sec, batch_timestamp)
                            VALUES (?, ?, ?, ?)
                        """, (self.program_id, gate, dwell_time_sec, batch_time.isoformat()))
                        
                        # Also update accumulator for summary stats
                        self.update_gate_dwell_accumulator(gate, dwell_time_sec)
                        
                        self.sqlite_conn.commit()
                    except Exception as e:
                        print(f"   ⚠️  Error writing gate dwell time: {e}")
                
                # Update last batch time for this gate
                self.last_batch_time[gate] = batch_time
            
            # Create BatchEvent for M4 tracking
            batch_event = BatchEvent(
                timestamp=batch_time,
                gate=gate,
                weight_g=batch['weight_g'],
                piece_count=batch['pieces']
            )
            
            # Initialize new minute if needed (or re-initialize if None after processing)
            if self.minute_accumulator is None or minute_bucket > self.current_minute:
                self.current_minute = minute_bucket
                self.minute_accumulator = MinuteAccumulator(minute_start=minute_bucket)
            
            # Add batch to minute accumulator
            self.minute_accumulator.add_batch(batch_event)
            
            self.batches_detected += 1
            # Batch logging disabled for cleaner output
            # print(f"   📦 Batch #{batch['id']}: Gate {batch['gate']}, {batch['pieces']} pieces, {batch['weight_g']:.1f}g → minute {minute_bucket.strftime('%H:%M')}")
        except Exception as e:
            print(f"   ❌ Error processing completed batch: {e}")
            import traceback
            traceback.print_exc()
    
    def accumulate_for_minute(self, piece: PieceData, batch: Optional[BatchEvent]):
        """Add to minute accumulator"""
        minute_bucket = piece.timestamp.replace(second=0, microsecond=0)
        
        # Initialize new minute (or re-initialize if None after processing)
        if self.minute_accumulator is None or minute_bucket > self.current_minute:
            self.current_minute = minute_bucket
            self.minute_accumulator = MinuteAccumulator(minute_start=minute_bucket)
        
        # Add piece
        self.minute_accumulator.add_piece(piece)
        
        # Add batch if present
        if batch:
            self.minute_accumulator.add_batch(batch)
    
    def process_minute_kpis(self):
        """
        Calculate M3/M4 KPIs for completed minute.
        Delegates to separate M3 and M4 functions.
        Called ONLY from main loop (once per minute) to prevent duplicates.
        """
        if not self.minute_accumulator:
            return
        
        minute_time = self.minute_accumulator.minute_start
        print(f"📊 Processing KPIs for {minute_time.strftime('%H:%M')}")
        
        try:
            # Process M3 per-minute KPIs
            self.process_m3_kpis(minute_time)
            
            # Process M4 cumulative totals
            self.process_m4_totals(minute_time)
            
        except Exception as e:
            print(f"⚠️  Error processing KPIs: {e}")
            import traceback
            traceback.print_exc()
        
        # Clear accumulator for next minute
        self.minute_accumulator = None
    
    def process_m3_kpis(self, minute_time: datetime):
        """
        Calculate M3 per-minute KPIs (per-recipe and combined).
        
        M3 tracks:
        - Pieces processed per minute (all pieces to this gate)
        - Weight processed per minute (all pieces to this gate)
        - Batches completed per minute
        - Giveaway percentage (only for gates with batches)
        """
        m3_start = time.time()
        acc = self.minute_accumulator
        
        try:
            # Calculate M3 per-recipe KPIs using proper filled batch equivalent logic
            minute_accum_extra = {}  # For combined giveaway calculation
            
            # Build a set of unique recipe IDs that are currently active
            active_recipe_ids = set()
            for gate, recipe_id in self.gate_to_recipe.items():
                if gate != 0 and recipe_id and recipe_id in self.recipes:
                    active_recipe_ids.add(recipe_id)
            
            # Process each unique recipe (not per-gate to avoid duplicates)
            for recipe_id in active_recipe_ids:
                recipe = self.recipes[recipe_id]
                recipe_name = recipe.recipe_name
                
                # Find all gates assigned to this recipe
                gates_with_this_recipe = [g for g, rid in self.gate_to_recipe.items() if rid == recipe_id and g != 0]
                
                # Collect ALL pieces and batches for this recipe across all its gates
                pieces_for_recipe = []
                batches_for_recipe = []
                for gate in gates_with_this_recipe:
                    pieces_for_recipe.extend(acc.pieces_by_gate.get(gate, []))
                    batches_for_recipe.extend(acc.batches_by_gate.get(gate, []))
                
                # Count metrics (always track, even without batches)
                pieces_count = len(pieces_for_recipe)
                weight_sum = sum(p.weight_g for p in pieces_for_recipe)
                batch_count = len(batches_for_recipe)
                
                # Calculate giveaway only if we have batches
                giveaway_pct = 0.0
                if batches_for_recipe:
                    w_target = 0.0
                    w_actual = sum(b.weight_g for b in batches_for_recipe)
                    
                    for batch in batches_for_recipe:
                        weight = batch.weight_g
                        
                        # Count-based recipe (exact or min)
                        if recipe.bc_type in ('exact', 'min') and recipe.bc_val:
                            actual_count = batch.piece_count
                            
                            if recipe.bc_type == 'exact':
                                fill = 1.0 if actual_count == recipe.bc_val else (actual_count / float(recipe.bc_val))
                            else:  # 'min'
                                fill = 1.0 if actual_count >= recipe.bc_val else (actual_count / float(recipe.bc_val))
                            
                            this_target = fill * (recipe.bc_val * recipe.piece_min if recipe.bc_val else 0.0)
                        else:
                            # Weight-based recipe
                            if recipe.batch_min <= 0:
                                fill = 1.0
                                this_target = weight
                            else:
                                fill = 1.0 if weight >= recipe.batch_min else (weight / float(recipe.batch_min))
                                this_target = fill * recipe.batch_min
                        
                        w_target += this_target
                    
                    # Calculate giveaway
                    w_give = max(0.0, w_actual - w_target)
                    denom = w_actual + w_give
                    giveaway_pct = (w_give / denom * 100.0) if denom > 0 else 0.0
                    
                    # Accumulate for combined giveaway
                    minute_accum_extra[recipe_id] = {
                        'w_give': w_give,
                        'denom': denom
                    }
                
                # Write M3 per-recipe to SQLite (once per recipe, not per gate)
                try:
                    write_m3_per_recipe_sqlite(
                        self.sqlite_conn,
                        minute_time,
                        recipe_name,
                        self.program_id,
                        batch_count,
                        giveaway_pct,
                        pieces_count,
                        weight_sum,
                        0,   # rejects_per_min (per-recipe, always 0)
                        0,   # total_rejects_count (per-recipe, always 0)
                        0.0  # total_rejects_weight_g (per-recipe, always 0)
                    )
                    print(f"   ✅ M3 per-recipe: {recipe_name} → {pieces_count}pcs, {weight_sum:.0f}g, {batch_count}batches, {giveaway_pct:.2f}%")
                except Exception as e:
                    print(f"   ⚠️  Error writing M3 for {recipe_name}: {e}")
            
            # Calculate combined M3 (sum across all recipes)
            total_pieces = sum(len(p) for g, p in acc.pieces_by_gate.items() if g != 0)
            total_weight = sum(sum(p.weight_g for p in pieces) for g, pieces in acc.pieces_by_gate.items() if g != 0)
            
            # Count total batches (across all gates)
            total_batches = sum(len(batches) for g, batches in acc.batches_by_gate.items() if g != 0)
            
            # Combined giveaway (weighted by denominator, only for gates with batches)
            if minute_accum_extra:
                w_give_sum = sum(v['w_give'] for v in minute_accum_extra.values())
                denom_sum = sum(v['denom'] for v in minute_accum_extra.values())
                combined_giveaway_pct = (w_give_sum / denom_sum * 100.0) if denom_sum > 0 else 0.0
            else:
                combined_giveaway_pct = 0.0
            
            # Total rejects this minute (gate 0, all pieces)
            reject_pieces_min = len(acc.pieces_by_gate.get(0, []))
            reject_weight_min = sum(p.weight_g for p in acc.pieces_by_gate.get(0, []))
            
            # Cumulative rejects (across program lifetime)
            self.total_rejects_count += reject_pieces_min
            self.total_rejects_weight += reject_weight_min
            
            # Write combined M3 to SQLite
            try:
                write_m3_combined_sqlite(
                    self.sqlite_conn,
                    minute_time,
                    total_batches,
                    combined_giveaway_pct,
                    total_pieces,
                    total_weight,
                    reject_pieces_min,
                    self.total_rejects_count,
                    self.total_rejects_weight
                )
                self.kpis_written += 1
            except Exception as e:
                print(f"   ⚠️  Error writing combined M3: {e}")
            
            # Track M3 write performance (for monitoring)
            m3_duration = (time.time() - m3_start) * 1000  # Convert to milliseconds
            self.m3_write_times.append(m3_duration)
            if len(self.m3_write_times) > 100:
                self.m3_write_times = self.m3_write_times[-100:]  # Keep only last 100
            
        except Exception as e:
            print(f"⚠️  Error processing M3: {e}")
            import traceback
            traceback.print_exc()
    
    def process_m4_totals(self, minute_time: datetime):
        """
        Process M4 cumulative totals per recipe.
        M4 tracks cumulative stats across the entire program lifetime.
        
        Note: Processes by recipe_id (not by gate) to avoid duplicates when
        a recipe is assigned to multiple gates.
        """
        if not self.minute_accumulator:
            return
        
        try:
            acc = self.minute_accumulator
            
            # Build a set of unique recipe IDs that are currently active
            active_recipe_ids = set()
            for gate, recipe_id in self.gate_to_recipe.items():
                if gate != 0 and recipe_id and recipe_id in self.recipes:
                    active_recipe_ids.add(recipe_id)
            
            # Process each unique recipe (not per-gate to avoid duplicates)
            for recipe_id in active_recipe_ids:
                recipe = self.recipes[recipe_id]
                recipe_name = recipe.recipe_name
                
                # Find all gates assigned to this recipe
                gates_with_this_recipe = [g for g, rid in self.gate_to_recipe.items() if rid == recipe_id and g != 0]
                
                # Collect all batches for this recipe across all its gates
                batches_for_recipe = []
                for gate in gates_with_this_recipe:
                    batches_for_recipe.extend(acc.batches_by_gate.get(gate, []))
                
                if not batches_for_recipe:
                    # No batches this minute for this recipe - still write M4 with current cumulative
                    if recipe_id in self.m4_cumulative:
                        cum = self.m4_cumulative[recipe_id]
                        giveaway_g_per_batch = cum['cum_give'] / max(1.0, cum['total_batches'])
                        denom = cum['cum_actual'] + cum['cum_give']
                        giveaway_pct_avg = (cum['cum_give'] / denom * 100.0) if denom > 0 else 0.0
                        
                        try:
                            write_m4_totals_sqlite(
                                self.sqlite_conn,
                                minute_time,
                                recipe_name,
                                self.program_id,
                                int(cum['total_batches']),
                                giveaway_g_per_batch,
                                giveaway_pct_avg
                            )
                        except Exception as e:
                            print(f"   ⚠️  Error writing M4 for {recipe_name} (no new batches): {e}")
                    continue
                
                # Calculate filled batch equivalents and target weight for this minute's batches
                filled_equiv_min = 0.0
                w_actual_min = 0.0
                w_target_min = 0.0
                
                for batch in batches_for_recipe:
                    weight = batch.weight_g
                    w_actual_min += weight
                    
                    # Count-based recipe (exact or min)
                    if recipe.bc_type in ('exact', 'min') and recipe.bc_val:
                        actual_count = batch.piece_count
                        
                        if recipe.bc_type == 'exact':
                            fill = 1.0 if actual_count == recipe.bc_val else (actual_count / float(recipe.bc_val))
                        else:  # 'min'
                            fill = 1.0 if actual_count >= recipe.bc_val else (actual_count / float(recipe.bc_val))
                        
                        filled_equiv_min += fill
                        w_target_min += fill * (recipe.bc_val * recipe.piece_min if recipe.bc_val else 0.0)
                    else:
                        # Weight-based recipe
                        if recipe.batch_min <= 0:
                            fill = 1.0
                            this_target = weight
                        else:
                            fill = 1.0 if weight >= recipe.batch_min else (weight / float(recipe.batch_min))
                            this_target = fill * recipe.batch_min
                        
                        filled_equiv_min += fill
                        w_target_min += this_target
                
                # Calculate giveaway for this minute
                w_give_min = max(0.0, w_actual_min - w_target_min)
                
                # Initialize cumulative if not exists
                if recipe_id not in self.m4_cumulative:
                    self.m4_cumulative[recipe_id] = {
                        'total_batches': 0.0,
                        'cum_actual': 0.0,
                        'cum_give': 0.0
                    }
                
                # Update cumulative totals
                self.m4_cumulative[recipe_id]['total_batches'] += filled_equiv_min
                self.m4_cumulative[recipe_id]['cum_actual'] += w_actual_min
                self.m4_cumulative[recipe_id]['cum_give'] += w_give_min
                
                # Calculate M4 metrics (cumulative)
                cum_filled = self.m4_cumulative[recipe_id]['total_batches']
                cum_actual = self.m4_cumulative[recipe_id]['cum_actual']
                cum_give = self.m4_cumulative[recipe_id]['cum_give']
                
                # M4 metrics
                giveaway_g_per_batch = cum_give / max(1.0, cum_filled)
                denom = cum_actual + cum_give
                giveaway_pct_avg = (cum_give / denom * 100.0) if denom > 0 else 0.0
                
                # Write M4 to SQLite (once per recipe, not per gate)
                try:
                    write_m4_totals_sqlite(
                        self.sqlite_conn,
                        minute_time,
                        recipe_name,
                        self.program_id,
                        int(cum_filled),
                        giveaway_g_per_batch,
                        giveaway_pct_avg
                    )
                    print(f"   ✅ M4 cumulative: {recipe_name} → {int(cum_filled)} batches, {giveaway_pct_avg:.2f}% avg")
                except Exception as e:
                    print(f"   ⚠️  Error writing M4 for {recipe_name}: {e}")
                    
        except Exception as e:
            print(f"⚠️  Error processing M4 totals: {e}")
            import traceback
            traceback.print_exc()
    
    def log_performance(self):
        """Log performance metrics every minute"""
        now = datetime.now(timezone.utc)
        
        if self.last_performance_log is None or (now - self.last_performance_log).total_seconds() >= 60:
            print("\n" + "="*60)
            print("📊 PERFORMANCE METRICS (last 60 seconds)")
            print("="*60)
            
            # M1 metrics (pieces written)
            if self.m1_write_times:
                avg_m1 = sum(self.m1_write_times) / len(self.m1_write_times)
                max_m1 = max(self.m1_write_times)
                print(f"M1 (Pieces):  Avg: {avg_m1:.2f}ms  Max: {max_m1:.2f}ms  Count: {len(self.m1_write_times)}")
            
            # M2 metrics (gate state - per piece)
            if self.m2_write_times:
                avg_m2 = sum(self.m2_write_times) / len(self.m2_write_times)
                max_m2 = max(self.m2_write_times)
                print(f"M2 (Gates):   Avg: {avg_m2:.2f}ms  Max: {max_m2:.2f}ms  Count: {len(self.m2_write_times)}")
            
            # M3 metrics (KPIs - per minute)
            if self.m3_write_times:
                avg_m3 = sum(self.m3_write_times) / len(self.m3_write_times)
                max_m3 = max(self.m3_write_times)
                print(f"M3 (KPIs):    Avg: {avg_m3:.2f}ms  Max: {max_m3:.2f}ms  Count: {len(self.m3_write_times)}")
            
            # Error rate
            total_writes = len(self.m1_write_times) + len(self.m2_write_times) + len(self.m3_write_times)
            error_rate = (self.influx_errors / max(1, total_writes)) * 100
            print(f"\nInfluxDB Errors: {self.influx_errors} ({error_rate:.2f}%)")
            
            # Processing rate
            if self.start_time:
                elapsed = time.time() - self.start_time
                pieces_per_sec = self.pieces_processed / max(1, elapsed)
                print(f"Processing Rate: {pieces_per_sec:.2f} pieces/sec")
            
            print("="*60 + "\n")
            
            # Reset counters for next interval
            self.m1_write_times = []
            self.m2_write_times = []
            self.m3_write_times = []
            self.influx_errors = 0
            self.last_performance_log = now
    
    def print_stats(self):
        """Print statistics"""
        if not self.start_time:
            return
        
        elapsed = time.time() - self.start_time
        rate = self.pieces_processed / elapsed if elapsed > 0 else 0
        
        # Calculate time until next program switch
        if self.last_program_switch and self.next_program_switch_delay:
            elapsed_since_switch = (datetime.now(timezone.utc) - self.last_program_switch).total_seconds() / 60.0
            time_until_switch = self.next_program_switch_delay - elapsed_since_switch
            switch_info = f" | ⏰ Switch in: {max(0, time_until_switch):.1f}m"
        else:
            switch_info = ""
        
        print(f"\r📈 Pieces: {self.pieces_processed:,} | "
              f"Batches: {self.batches_detected} | "
              f"KPIs: {self.kpis_written} | "
              f"Rate: {rate:.1f}/s | "
              f"Time: {elapsed:.0f}s{switch_info}", end='', flush=True)
    
    def run(self):
        """Main loop - polls for new pieces and processes KPIs every minute"""
        print("\n" + "=" * 70)
        print("🚀 Live Mode Worker v3 (M3/M4 KPIs only)")
        print("=" * 70 + "\n")
        
        self.connect()
        self.load_recipes()
        
        # ✨ NEW: Recover any incomplete programs from previous crashes
        self.recover_incomplete_programs()
        
        # Load and apply program assignments
        print("🔧 Loading program assignments...")
        if self.load_program_assignments_from_json():
            first_assignment = self.program_assignments[0]
            print(f"   Applying initial program {first_assignment['program_id']}...")
            self.apply_program_assignment(first_assignment)
        else:
            self.load_current_assignments()
        
        self.running = True
        self.start_time = time.time()
        last_stats = time.time()
        last_minute_check = None
        
        print("\n⏳ Polling for M3/M4 KPI calculations every 60 seconds...")
        print("   (M1/M2 and batch detection handled by backend JavaScript)")
        print("=" * 70 + "\n")
        
        try:
            while self.running:
                # Poll for new pieces for M3/M4 calculations only
                # Batch detection now happens in real-time in the backend!
                pieces = self.poll_new_pieces()
                
                for piece in pieces:
                    self.process_piece(piece)
                
                # Poll for completed batches from backend (single source of truth)
                completed_batches = self.poll_completed_batches()
                
                # Process completed batches for M3/M4 calculations
                for batch in completed_batches:
                    self.process_completed_batch(batch)
                
                # Check if minute rolled over - process KPIs if so
                now = datetime.now(timezone.utc)
                current_minute_bucket = now.replace(second=0, microsecond=0)
                
                if last_minute_check is None:
                    last_minute_check = current_minute_bucket
                elif current_minute_bucket > last_minute_check:
                    # Minute rolled over - process KPIs for completed minute
                    if self.minute_accumulator:
                        self.process_minute_kpis()
                    last_minute_check = current_minute_bucket
                
                # Check if it's time to switch to next program
                try:
                    self.check_and_switch_program()
                except Exception as e:
                    print(f"\n{'='*70}")
                    print(f"❌ ERROR in check_and_switch_program")
                    print(f"   Error: {e}")
                    print(f"{'='*70}")
                    import traceback
                    traceback.print_exc()
                    print(f"{'='*70}\n")
                    # Don't crash, just continue
                
                # Print stats every 2 seconds
                if time.time() - last_stats > 2.0:
                    self.print_stats()
                    self.log_performance()
                    last_stats = time.time()
                
                # M3/M4 calculations happen per-minute, so 60-second polling is fine
                time.sleep(60.0)  # Backend handles real-time batch detection now!
                
        except KeyboardInterrupt:
            print("\n\n⚠️  Interrupted by user")
        finally:
            if self.minute_accumulator:
                self.process_minute_kpis()
            
            self.print_stats()
            print("\n\n✅ Worker stopped")
            self.disconnect()

def main():
    worker = LiveWorker()
    worker.run()

if __name__ == "__main__":
    main()

