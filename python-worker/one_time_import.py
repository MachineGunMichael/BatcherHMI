#!/usr/bin/env python3
import os, sys, math, re, sqlite3, argparse, warnings
from dataclasses import dataclass
from datetime import datetime, timezone, timedelta
from typing import Dict, List, Optional, Tuple, Any

import pandas as pd
import numpy as np
from dateutil import tz
from dotenv import load_dotenv

# Resolve everything relative to this file, not the process cwd
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR = os.path.normpath(os.path.join(BASE_DIR, ".."))
SERVER_DIR = os.path.join(ROOT_DIR, "server")
OUT_DIR = os.path.join(BASE_DIR, "one_time_output")
DENSE_INFLUX_MINUTES = bool(int(os.getenv("DENSE_INFLUX_MINUTES", "1")))

def _load_shell_env_file(path: str):
    """
    Load KEY=VAL or 'export KEY=VAL' lines into os.environ (VS Code can't 'source' bash files).
    """
    if not os.path.isfile(path):
        return
    with open(path, "r") as f:
        for line in f:
            s = line.strip()
            if not s or s.startswith("#"):
                continue
            if s.startswith("export "):
                s = s[len("export "):]
            if "=" in s:
                k, v = s.split("=", 1)
                k = k.strip()
                v = v.strip().strip('"').strip("'")
                os.environ.setdefault(k, v)
                os.environ[k] = v

# Load .env files explicitly from both locations
load_dotenv(os.path.join(BASE_DIR, ".env"), override=True)
load_dotenv(os.path.join(SERVER_DIR, ".env"), override=True)
# Load Influx bash-style env file
_load_shell_env_file(os.path.join(SERVER_DIR, ".influxdb3", "env"))

# Default SQLite path relative to the repo layout
DEFAULT_SQLITE = os.path.normpath(os.path.join(SERVER_DIR, "db", "sqlite", "batching_app.sqlite"))

SQLITE_DB   = os.getenv("SQLITE_DB", DEFAULT_SQLITE)
INFLUX_HOST = os.getenv("INFLUXDB3_HOST_URL", "http://127.0.0.1:8181")
INFLUX_TOKEN= os.getenv("INFLUXDB3_AUTH_TOKEN")
INFLUX_DB   = os.getenv("INFLUXDB3_DATABASE", "batching")
PLANT_TZ    = os.getenv("TZ_EUROPE", "Europe/Amsterdam")

HAS_INFLUX = bool(INFLUX_TOKEN and INFLUX_HOST and INFLUX_DB)

if HAS_INFLUX:
    try:
        from influxdb_client_3 import InfluxDBClient3, Point
    except Exception as e:
        print("InfluxDB client not available; please pip install influxdb-client", file=sys.stderr)
        HAS_INFLUX = False

warnings.simplefilter("ignore", category=FutureWarning)

# CSV collectors (append rows as dicts while you process)
CSV_ROWS_INFLUX_M3_RECIPE: List[dict]   = []   # per-minute per-recipe KPI (batches_min, giveaway_pct, rejects_per_min)
CSV_ROWS_INFLUX_M3_COMBINED: List[dict] = []   # per-minute combined KPI
CSV_ROWS_INFLUX_M4_TOTALS: List[dict]   = []   # per-recipe totals (end of window)
CSV_ROWS_INFLUX_M2_GATE: List[dict]     = []   # per-minute gate_state
CSV_ROWS_INFLUX_M1_PIECES: List[dict]   = []   # raw pieces stream (optional; handy for sanity)
CSV_ROWS_INFLUX_M5_ASSIGNMENTS: List[dict] = []   # gate assignments at window start

# --------------------- TZ HELPERS ---------------------
UTC = tz.UTC

def utc_iso(ts) -> str:
    t = pd.Timestamp(ts)
    if t.tzinfo is None:
        t = t.tz_localize('UTC')
    else:
        t = t.tz_convert('UTC')
    return t.isoformat()

def to_utc(ts):
    # Series
    if isinstance(ts, pd.Series):
        t = pd.to_datetime(ts, errors='coerce')
        if t.dt.tz is None:
            return t.dt.tz_localize('UTC')
        return t.dt.tz_convert('UTC')
    # DatetimeIndex
    if isinstance(ts, (pd.DatetimeIndex, pd.Index)):
        t = pd.to_datetime(ts, errors='coerce')
        if t.tz is None:
            return t.tz_localize('UTC')
        return t.tz_convert('UTC')
    # scalar
    t = pd.Timestamp(ts)
    if t.tzinfo is None:
        return t.tz_localize('UTC')
    return t.tz_convert('UTC')

def minute_bucket_utc(dt: pd.Timestamp) -> pd.Timestamp:
    dt = to_utc(pd.Timestamp(dt))
    return dt.floor("T")

def iso_minute_z(dt: pd.Timestamp) -> str:
    dt = minute_bucket_utc(dt)
    return dt.strftime("%Y-%m-%dT%H:%M:00Z")

# --------------------- USER HELPERS (YOUR VERSIONS) ---------------------
def fix_window_slice(df_slice: pd.DataFrame) -> pd.DataFrame:
    """
    Trim off head/tail partial batches for each gate:
      - drop the first Batch row and any Pieces on-or-before it
      - drop the last Batch row and any Pieces on-or-after the second-to-last Batch
    Returns the cleaned slice (both Piece and Batch rows), ready for stats.
    """
    df = df_slice.copy()
    to_drop = set()

    # 1) head/tail trimming per gate
    batch_events = df[df['Type']=='Batch']
    for gate, grp in batch_events.groupby('Gate'):
        b = grp.sort_values('Timestamp')
        first_idx = b.index[0]
        last_idx  = b.index[-1]

        # 1) head: drop first batch + any piece ≤ first_ts
        first_ts = b.at[first_idx, 'Timestamp']
        to_drop.add(first_idx)
        head_mask = (
            (df['Type']=='Piece') &
            (df['Gate']==gate) &
            (df['Timestamp'] < first_ts)
        )
        to_drop.update(df[head_mask].index)

        # 2) tail: find penultimate batch time
        if len(b) >= 2:
            pen_idx = b.index[-2]
            pen_ts  = b.at[pen_idx, 'Timestamp']
        else:
            # if only one batch, everything on-or-after first_ts gets dropped
            pen_ts = first_ts
        # drop last batch row
        to_drop.add(last_idx)
        # drop any piece on-or-after penultimate timestamp
        tail_mask = (
            (df['Type']=='Piece') &
            (df['Gate']==gate) &
            (df['Timestamp'] >= pen_ts)
        )
        to_drop.update(df[tail_mask].index)

    # apply all drops at once
    cleaned = df.drop(index=to_drop, errors='ignore')

    # 2) drop any gates that now have zero Batch rows
    remaining = cleaned
    gates_with_batch = set(remaining[remaining['Type']=='Batch']['Gate'])
    # for gates not in that set, drop all their Piece rows
    mask_orphan_pieces = (
        (remaining['Type']=='Piece') &
        (~remaining['Gate'].isin(gates_with_batch))
    )
    cleaned = remaining.drop(index=remaining[mask_orphan_pieces].index)

    return cleaned.sort_values('Timestamp').reset_index(drop=True)

# --------------------- DATA CLASSES ---------------------
@dataclass(frozen=True)
class RecipeSpec:
    piece_min: int
    piece_max: int
    batch_min: int  # 0 if none
    batch_max: int  # 0 if none
    bc_type: Optional[str]  # 'min'|'max'|'exact'|None
    bc_val: Optional[int]   # None if no limit

    def sqlite_tuple(self) -> Tuple[Optional[int], Optional[int], Optional[int], Optional[int], Optional[int], Optional[int]]:
        """
        Map to your 'recipes' table columns:
        (piece_min_weight_g, piece_max_weight_g, batch_min_weight_g, batch_max_weight_g, min_pieces_per_batch, max_pieces_per_batch)
        We encode 'exact' as min=max=bc_val. NA => None.
        """
        min_pieces = None
        max_pieces = None
        if self.bc_type == 'exact' and self.bc_val is not None:
            min_pieces = self.bc_val
            max_pieces = self.bc_val
        elif self.bc_type == 'min' and self.bc_val is not None:
            min_pieces = self.bc_val
            max_pieces = None
        elif self.bc_type == 'max' and self.bc_val is not None:
            min_pieces = None
            max_pieces = self.bc_val

        bm = None if (self.batch_min or 0) <= 0 else int(self.batch_min)
        bM = None if (self.batch_max or 0) <= 0 else int(self.batch_max)

        return (int(self.piece_min), int(self.piece_max), bm, bM, min_pieces, max_pieces)

    def recipe_name(self) -> str:
        """Match your R_x_y_xx_yy_xxx_yyy pattern."""
        xxx = self.bc_type if self.bc_type else "NA"
        yyy = self.bc_val if (self.bc_val is not None and not math.isnan(self.bc_val)) else 0
        return f"R_{self.piece_min}_{self.piece_max}_{self.batch_min}_{self.batch_max}_{xxx}_{yyy}"

# --------------------- SQLITE WRITER ---------------------
class SqliteWriter:
    def __init__(self, path: str):
        db_dir = os.path.dirname(os.path.abspath(path))
        os.makedirs(db_dir, exist_ok=True)  # or raise if you prefer
        self.conn = sqlite3.connect(path, detect_types=sqlite3.PARSE_DECLTYPES)
        self.conn.execute("PRAGMA foreign_keys=ON;")
        self._ensure_views()
        self._reset_sequences_if_empty()

    def _reset_sequences_if_empty(self):
        # If programs table is empty, reset autoincrement so first insert becomes 1
        row = self.conn.execute("SELECT COUNT(*) FROM programs").fetchone()
        if row and int(row[0]) == 0:
            try:
                self.conn.execute("DELETE FROM sqlite_sequence WHERE name IN ('programs','recipes','run_configs')")
                self.conn.commit()
            except sqlite3.Error:
                pass

    def _ensure_views(self):
        # A view that exposes recipe name for minute throughput
        self.conn.execute("""
            CREATE VIEW IF NOT EXISTS recipe_throughput_minute_named AS
            SELECT rtm.program_id,
                r.name AS recipe_name,
                rtm.ts_minute,
                rtm.batches_created,
                rtm.pieces_processed,
                rtm.weight_processed_g
            FROM recipe_throughput_minute rtm
            JOIN recipes r ON r.id = rtm.recipe_id
        """)
        self.conn.commit()

    def close(self):
        self.conn.commit()
        self.conn.close()

    # --- lookups / upserts ---
    def get_or_create_program(self, name: str, gates: int = 9) -> int:
        row = self.conn.execute("SELECT id FROM programs WHERE name=?", (name,)).fetchone()
        if row: return int(row[0])
        cur = self.conn.execute("INSERT INTO programs (name, gates) VALUES (?, ?)", (name, gates))
        return int(cur.lastrowid)

    def get_or_create_recipe(self, spec: RecipeSpec) -> int:
        nm = spec.recipe_name()
        row = self.conn.execute("SELECT id FROM recipes WHERE name=?", (nm,)).fetchone()
        if row: return int(row[0])
        tup = spec.sqlite_tuple()
        cur = self.conn.execute("""
            INSERT INTO recipes
              (name, piece_min_weight_g, piece_max_weight_g, batch_min_weight_g, batch_max_weight_g, min_pieces_per_batch, max_pieces_per_batch)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        """, (nm, *tup))
        return int(cur.lastrowid)

    def create_run_config(self, program_id: int, name: str) -> int:
        cur = self.conn.execute(
            "INSERT INTO run_configs (name, source, program_id) VALUES (?, 'program', ?)",
            (name, program_id)
        )
        return int(cur.lastrowid)

    def upsert_assignment(self, config_id: int, gate_number: int, maybe_recipe_id: Optional[int]):
        # run_config_assignments allows NULL recipe (empty gate)
        self.conn.execute("""
            INSERT INTO run_config_assignments (config_id, gate_number, recipe_id)
            VALUES (?, ?, ?)
            ON CONFLICT(config_id, gate_number) DO UPDATE SET recipe_id=excluded.recipe_id
        """, (config_id, gate_number, maybe_recipe_id))

    def settings_history_mark(self, when_ts_utc: pd.Timestamp, active_config_id: Optional[int], note: str):
        self.conn.execute("""
            INSERT INTO settings_history (changed_at, user_id, mode, active_config_id, note)
            VALUES (?, NULL, 'preset', ?, ?)
        """, (when_ts_utc.strftime("%Y-%m-%d %H:%M:%S"), active_config_id, note))

    # --- KPI WRITES ---
    def bump_program_totals(self, program_id: int, totals: Dict[str, float]):
        self.conn.execute("""
            INSERT INTO program_stats
              (program_id, total_batches, total_batched_weight_g, total_reject_weight_g,
               total_giveaway_weight_g, total_items_batched, total_items_rejected, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(program_id) DO UPDATE SET
              total_batches            = total_batches + excluded.total_batches,
              total_batched_weight_g   = total_batched_weight_g + excluded.total_batched_weight_g,
              total_reject_weight_g    = total_reject_weight_g + excluded.total_reject_weight_g,
              total_giveaway_weight_g  = total_giveaway_weight_g + excluded.total_giveaway_weight_g,
              total_items_batched      = total_items_batched + excluded.total_items_batched,
              total_items_rejected     = total_items_rejected + excluded.total_items_rejected,
              updated_at               = CURRENT_TIMESTAMP
        """, (program_id,
              int(totals.get("total_batches", 0)),
              int(totals.get("total_batched_weight_g", 0)),
              int(totals.get("total_reject_weight_g", 0)),
              int(totals.get("total_giveaway_weight_g", 0)),
              int(totals.get("total_items_batched", 0)),
              int(totals.get("total_items_rejected", 0))
        ))

    def bump_recipe_totals(self, program_id: int, recipe_id: int, totals: Dict[str, float]):
        self.conn.execute("""
            INSERT INTO recipe_stats
              (program_id, recipe_id, total_batches, total_batched_weight_g, total_reject_weight_g,
               total_giveaway_weight_g, total_items_batched, total_items_rejected, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(program_id, recipe_id) DO UPDATE SET
              total_batches            = total_batches + excluded.total_batches,
              total_batched_weight_g   = total_batched_weight_g + excluded.total_batched_weight_g,
              total_reject_weight_g    = total_reject_weight_g + excluded.total_reject_weight_g,
              total_giveaway_weight_g  = total_giveaway_weight_g + excluded.total_giveaway_weight_g,
              total_items_batched      = total_items_batched + excluded.total_items_batched,
              total_items_rejected     = total_items_rejected + excluded.total_items_rejected,
              updated_at               = CURRENT_TIMESTAMP
        """, (program_id, recipe_id,
              int(totals.get("total_batches", 0)),
              int(totals.get("total_batched_weight_g", 0)),
              int(totals.get("total_reject_weight_g", 0)),
              int(totals.get("total_giveaway_weight_g", 0)),
              int(totals.get("total_items_batched", 0)),
              int(totals.get("total_items_rejected", 0))
        ))

    def upsert_program_minute(self, program_id: int, ts_minute_z: str, v: Dict[str, float]):
        self.conn.execute("""
            INSERT INTO program_throughput_minute
              (program_id, ts_minute, batches_created, pieces_processed, weight_processed_g)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(program_id, ts_minute) DO UPDATE SET
              batches_created    = batches_created    + excluded.batches_created,
              pieces_processed   = pieces_processed   + excluded.pieces_processed,
              weight_processed_g = weight_processed_g + excluded.weight_processed_g
        """, (program_id, ts_minute_z,
              int(v.get("batches_created", 0)),
              int(v.get("pieces_processed", 0)),
              int(v.get("weight_processed_g", 0))
        ))

    def write_program_totals(self, program_id: int, totals: Dict[str, float],
                            start_utc: pd.Timestamp, end_utc: pd.Timestamp):
        self.conn.execute("""
            INSERT INTO program_stats
            (program_id,
            total_batches,
            total_batched_weight_g,
            total_reject_weight_g,
            total_giveaway_weight_g,
            total_items_batched,
            total_items_rejected,
            start_ts,
            end_ts,
            updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(program_id) DO UPDATE SET
            total_batches            = excluded.total_batches,
            total_batched_weight_g   = excluded.total_batched_weight_g,
            total_reject_weight_g    = excluded.total_reject_weight_g,
            total_giveaway_weight_g  = excluded.total_giveaway_weight_g,
            total_items_batched      = excluded.total_items_batched,
            total_items_rejected     = excluded.total_items_rejected,
            start_ts                 = excluded.start_ts,
            end_ts                   = excluded.end_ts,
            updated_at               = CURRENT_TIMESTAMP
        """, (
            program_id,
            int(totals.get("total_batches", 0)),
            int(totals.get("total_batched_weight_g", 0)),
            int(totals.get("total_reject_weight_g", 0)),
            int(totals.get("total_giveaway_weight_g", 0)),
            int(totals.get("total_items_batched", 0)),
            int(totals.get("total_items_rejected", 0)),
            start_utc.strftime("%Y-%m-%dT%H:%M:00Z"),
            end_utc.strftime("%Y-%m-%dT%H:%M:00Z"),
        ))

    def upsert_recipe_minute(self, program_id: int, recipe_id: int, ts_minute_z: str, v: Dict[str, float]):
        self.conn.execute("""
            INSERT INTO recipe_throughput_minute
              (program_id, recipe_id, ts_minute, batches_created, pieces_processed, weight_processed_g)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(program_id, recipe_id, ts_minute) DO UPDATE SET
              batches_created    = batches_created    + excluded.batches_created,
              pieces_processed   = pieces_processed   + excluded.pieces_processed,
              weight_processed_g = weight_processed_g + excluded.weight_processed_g
        """, (program_id, recipe_id, ts_minute_z,
              int(v.get("batches_created", 0)),
              int(v.get("pieces_processed", 0)),
              int(v.get("weight_processed_g", 0))
        ))

    def update_gate_dwell(self, program_id: int, gate_number: int, durations_sec: List[float]):
        # Welford online accumulation; but we can accumulate batch-wise for simplicity
        if not durations_sec: return
        # fetch current
        row = self.conn.execute("""
            SELECT sample_count, mean_sec, m2_sec, min_sec, max_sec
            FROM gate_dwell_accumulators WHERE program_id=? AND gate_number=?
        """, (program_id, gate_number)).fetchone()
        n0, mean0, m20, min0, max0 = (0, 0.0, 0.0, None, None) if not row else row
        n = int(n0); mean = float(mean0); m2 = float(m20)
        mn = min0; mx = max0
        for x in durations_sec:
            n += 1
            delta = x - mean
            mean += delta / n
            delta2 = x - mean
            m2 += delta * delta2
            mn = x if mn is None else min(mn, x)
            mx = x if mx is None else max(mx, x)
        self.conn.execute("""
            INSERT INTO gate_dwell_accumulators (program_id, gate_number, sample_count, mean_sec, m2_sec, min_sec, max_sec, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(program_id, gate_number) DO UPDATE SET
              sample_count = excluded.sample_count,
              mean_sec     = excluded.mean_sec,
              m2_sec       = excluded.m2_sec,
              min_sec      = excluded.min_sec,
              max_sec      = excluded.max_sec,
              updated_at   = CURRENT_TIMESTAMP
        """, (program_id, gate_number, n, mean, m2, mn, mx))


@dataclass
class WindowAssignments:
    """Gates -> recipe_id and recipe_name mapping for this window (exclude empties)"""
    gate_to_recipe_id: Dict[int, Optional[int]]
    gate_to_recipe_name: Dict[int, Optional[str]]
    recipe_id_to_gates: Dict[int, List[int]]

# --------------------- INFLUX WRITER ---------------------
class InfluxWriter:
    """
    Shapes aligned with server/services/influx.js:
      M1  writePiece          -> measurement 'pieces',   tags: {piece_id?}, fields: {weight_g}
      M2  writeGateState      -> measurement 'gate_state', tags: {gate},   fields: {pieces_in_gate, weight_sum_g}
      M3  writeKpiMinute      -> measurement 'kpi_minute', tags: {recipe}, fields: {batches_min, giveaway_pct, rejects_per_min?}
          writeKpiMinuteCombined -> same as M3 with recipe="__combined"
      M4  writeKpiTotals      -> measurement 'kpi_totals', tags: {recipe}, fields: {total_batches, giveaway_g_per_batch, giveaway_pct_avg}
      M5  writeAssignment     -> measurement 'assignments', tags: {piece_id?, gate?, recipe?}, fields: {assigned:1}
    """
    def __init__(self):
        if not HAS_INFLUX:
            self.client = None
            return
        self.client = InfluxDBClient3(host=INFLUX_HOST, token=INFLUX_TOKEN, database=INFLUX_DB)

    def close(self):
        if self.client:
            self.client.close()

    @staticmethod
    def _to_dt(ts_utc: pd.Timestamp):
        # client expects a python datetime; ensure tz-aware UTC
        t = pd.Timestamp(ts_utc)
        if t.tzinfo is None:
            t = t.tz_localize('UTC')
        else:
            t = t.tz_convert('UTC')
        return t.to_pydatetime()

    # --------- M1
    def writePiece(self, t_utc: pd.Timestamp, piece_id: Optional[str], weight_g: float):
        if not self.client: return
        p = Point("pieces").time(self._to_dt(t_utc)) \
                           .field("weight_g", float(weight_g))
        if piece_id:
            p = p.tag("piece_id", str(piece_id))
        self.client.write(p)

    # --------- M1 (fast paths)
    def writePiecesDataFrame(self, df: pd.DataFrame):
        """
        Fast path for M1 with piece_id + gate tags.
        Expects df columns: Timestamp (tz-aware UTC), Weight, piece_id (str), Gate (int)
        """
        if not self.client or df.empty:
            return

        tmp = df[['Timestamp', 'Weight', 'piece_id', 'Gate']].copy()

        t = pd.to_datetime(tmp['Timestamp'], errors='coerce')
        if t.dt.tz is None:
            t = t.dt.tz_localize('UTC')
        else:
            t = t.dt.tz_convert('UTC')
        tmp['_time'] = t

        tmp['weight_g'] = pd.to_numeric(tmp['Weight'], errors='coerce').astype('float64')
        tmp['piece_id'] = tmp['piece_id'].astype(str)
        tmp['gate']     = tmp['Gate'].astype(str)

        tmp = tmp[['_time', 'weight_g', 'piece_id', 'gate']]

        self.client.write(
            tmp,
            data_frame_measurement_name='pieces',
            data_frame_timestamp_column='_time',
            data_frame_tag_columns=['piece_id','gate'],
        )

    def writePiecesChunked(self, df: pd.DataFrame, chunk_size: int = 5000):
        """
        Fallback: chunked list-of-Points (if DataFrame write ever misbehaves).
        """
        if not self.client or df.empty:
            return
        buf = []
        ct = 0
        for _, row in df.iterrows():
            ts = self._to_dt(row['Timestamp'])
            w  = float(row['Weight'])
            p = Point("pieces").time(ts).field("weight_g", w)
            buf.append(p)
            if len(buf) >= chunk_size:
                self.client.write(buf)
                ct += len(buf)
                buf.clear()
                # light progress
                if ct % (chunk_size * 2) == 0:
                    print(f"[M1] wrote {ct} pieces…")
        if buf:
            self.client.write(buf)

    # --------- M2
    def writeGateState(self, t_utc: pd.Timestamp, gate: int, pieces_in_gate: int, weight_sum_g: float):
        if not self.client: return
        p = Point("gate_state").time(self._to_dt(t_utc)) \
                               .tag("gate", str(int(gate))) \
                               .field("pieces_in_gate", int(pieces_in_gate)) \
                               .field("weight_sum_g", float(weight_sum_g))
        self.client.write(p)

    def writeGateStateFromPieces(self, pieces_df: pd.DataFrame):
        """
        Derive per-minute/per-gate aggregates from pieces_df and write
        to measurement 'gate_state' in one call.

        Fields:
        pieces_in_gate -> INT
        weight_sum_g   -> FLOAT
        Tag:
        gate           -> string
        """
        import numpy as np
        if not self.client or pieces_df.empty:
            return pd.DataFrame(columns=['_time', 'gate', 'pieces_in_gate', 'weight_sum_g'])

        grp = (
            pieces_df
            .assign(_time=pieces_df['Timestamp'].dt.floor('T'))
            .groupby(['Gate', '_time'])['Weight']
            .agg(pieces_in_gate='count', weight_sum_g='sum')
            .reset_index()
        )

        # types
        grp['_time'] = pd.to_datetime(grp['_time'], errors='coerce')
        if grp['_time'].dt.tz is None:
            grp['_time'] = grp['_time'].dt.tz_localize('UTC')
        else:
            grp['_time'] = grp['_time'].dt.tz_convert('UTC')

        grp['gate'] = grp['Gate'].astype(str)
        grp['pieces_in_gate'] = pd.to_numeric(grp['pieces_in_gate'], errors='coerce').astype('int64')   # <-- INT
        grp['weight_sum_g']   = pd.to_numeric(grp['weight_sum_g'],   errors='coerce').astype('float64') # <-- FLOAT

        out = grp[['_time', 'gate', 'pieces_in_gate', 'weight_sum_g']].copy()

        self.client.write(
            out,
            data_frame_measurement_name='gate_state',
            data_frame_timestamp_column='_time',
            data_frame_tag_columns=['gate'],
        )

        return out

    def writeGateStateLP(self, per_min_df: pd.DataFrame, chunk: int = 10000):
        """
        Fallback LP writer.
        Expects columns: _time (tz-aware), gate (str), pieces_in_gate (int), weight_sum_g (float)
        """
        import numpy as np
        if not self.client or per_min_df.empty:
            return

        df = per_min_df.copy()

        # normalize
        t = pd.to_datetime(df['_time'], errors='coerce')
        if t.dt.tz is None:
            t = t.dt.tz_localize('UTC')
        else:
            t = t.dt.tz_convert('UTC')
        ns = t.view('int64')

        gate = df['gate'].astype(str)
        cnt  = pd.to_numeric(df['pieces_in_gate'], errors='coerce').astype('int64')    # INT
        sumw = pd.to_numeric(df['weight_sum_g'],   errors='coerce').astype('float64')  # FLOAT

        def esc_tag(s: str):
            return s.replace(' ', r'\ ').replace(',', r'\,').replace('=', r'\=')

        # NOTE the 'i' suffix for integer fields
        lines = [
            f"gate_state,gate={esc_tag(gate.iat[i])} "
            f"pieces_in_gate={int(cnt.iat[i])}i,weight_sum_g={float(sumw.iat[i])} {ns[i]}"
            for i in range(len(df))
            if np.isfinite(sumw.iat[i])
        ]

        for i in range(0, len(lines), chunk):
            self.client.write("\n".join(lines[i:i+chunk]))

    def writeGateStateCumulativeFromSlice(self, df_slice: pd.DataFrame):
        """
        M2 (redefined): cumulative state per gate at *each piece time*.
        - Resets to 0 at each Batch event for that gate.
        - Emits only rows at Piece timestamps (after applying the increment).
        Returns DataFrame with columns: _time, gate, pieces_in_gate, weight_sum_g
        """
        if not self.client or df_slice.empty:
            return pd.DataFrame(columns=['_time','gate','pieces_in_gate','weight_sum_g'])

        # Work only with gates 1..8 (gate 0 is reject stream)
        gate_events = df_slice[df_slice['Gate'] != 0].copy()

        # Order so Batch rows at same timestamp come BEFORE Piece rows
        type_rank = gate_events['Type'].map({'Batch':0, 'Piece':1}).fillna(1).astype(int)
        gate_events = gate_events.assign(_type_rank=type_rank) \
                                .sort_values(['Gate','Timestamp','_type_rank','file_order'],
                                            ascending=[True, True, True, False],
                                            kind='mergesort') \
                                .drop(columns=['_type_rank'])

        # For each gate, create a running "bucket" that increments at each Batch
        def per_gate(df_g: pd.DataFrame) -> pd.DataFrame:
            # bucket: increases by 1 at each Batch
            bucket = (df_g['Type'].eq('Batch')).cumsum()
            df_g = df_g.assign(_bucket=bucket)

            # keep only Pieces for output rows
            pieces = df_g[df_g['Type'] == 'Piece'].copy()

            # cumulative count/weight within the bucket
            pieces['pieces_in_gate'] = pieces.groupby('_bucket').cumcount() + 1
            pieces['weight_sum_g']   = pieces.groupby('_bucket')['Weight'].cumsum().astype('float64')

            pieces['_time'] = to_utc(pieces['Timestamp'])
            pieces['gate']  = pieces['Gate'].astype(str)

            return pieces[['_time','gate','pieces_in_gate','weight_sum_g']]

        out = (gate_events.groupby('Gate', group_keys=False).apply(per_gate)).reset_index(drop=True)

        if out.empty:
            return out

        self.client.write(
            out,
            data_frame_measurement_name='gate_state',
            data_frame_timestamp_column='_time',
            data_frame_tag_columns=['gate'],
        )
        return out

    # --------- M3
    def writeKpiMinute(self, t_minute_utc: pd.Timestamp, recipe_name: str,
                       batches_min: float, giveaway_pct: float, rejects_per_min: Optional[float] = None):
        if not self.client: return
        p = Point("kpi_minute").time(self._to_dt(t_minute_utc)) \
                               .tag("recipe", str(recipe_name)) \
                               .field("batches_min", float(batches_min)) \
                               .field("giveaway_pct", float(giveaway_pct))
        if rejects_per_min is not None:
            p = p.field("rejects_per_min", float(rejects_per_min))
        self.client.write(p)

    def writeKpiMinuteCombined(self, t_minute_utc: pd.Timestamp, batches_min: float,
                               giveaway_pct: float, rejects_per_min: Optional[float] = None):
        self.writeKpiMinute(t_minute_utc, "__combined", batches_min, giveaway_pct, rejects_per_min)

    def writeKpiMinuteDF(self, recipe_kpi_minute, assignments: WindowAssignments, program_id: int):
        import pandas as pd

        if not self.client:
            return pd.DataFrame(columns=['_time','program','recipe','batches_min','giveaway_pct'])

        # 1) build DF only from real datapoints (no densify here)
        rows = []
        for (rid, ts_z), v in recipe_kpi_minute.items():
            gates = [g for g, rr in assignments.gate_to_recipe_id.items() if rr == rid]
            if not gates:
                continue
            rname = assignments.gate_to_recipe_name[gates[0]] or f"recipe_{rid}"
            rows.append({
                '_time': pd.to_datetime(ts_z, utc=True),
                'program': str(program_id),
                'recipe': str(rname),
                'batches_min': float(v.get('batches_min', 0.0)),
                'giveaway_pct': float(v.get('giveaway_pct', 0.0)),
            })

        df = pd.DataFrame(rows) if rows else pd.DataFrame(columns=['_time','program','recipe','batches_min','giveaway_pct'])

        # 2) densify *after* building the DF (avoid duplicates)
        if DENSE_INFLUX_MINUTES and '__full_minutes__' in assignments.gate_to_recipe_name and not df.empty:
            full_idx = pd.to_datetime(assignments.gate_to_recipe_name['__full_minutes__'], utc=True)
            recipes = sorted({
                assignments.gate_to_recipe_name[g]
                for g in assignments.gate_to_recipe_name
                if isinstance(g, int) and assignments.gate_to_recipe_name[g]
            })
            mi = pd.MultiIndex.from_product([recipes, full_idx], names=['recipe', '_time'])

            df = (
                df.set_index(['recipe','_time'])
                .reindex(mi)
                .fillna({'batches_min': 0.0, 'giveaway_pct': 0.0})
                .reset_index()
            )
            df['program'] = str(program_id)

        if not df.empty:
            self.client.write(
                df,
                data_frame_measurement_name='kpi_minute',
                data_frame_timestamp_column='_time',
                data_frame_tag_columns=['program','recipe'],
            )
        return df


    def writeKpiMinuteCombinedDF(self, combined_kpi_minute, program_id: int, gate0_counts_per_min: Dict[str, int], full_minutes_z=None):
        import pandas as pd

        rows = []
        for ts_z, v in combined_kpi_minute.items():
            rows.append({
                '_time': pd.to_datetime(ts_z, utc=True),
                'program': str(program_id),
                'recipe': '__combined',
                'batches_min': float(v.get('batches_min', 0.0)),
                'giveaway_pct': float(v.get('giveaway_pct', 0.0)),
                'rejects_per_min': float(gate0_counts_per_min.get(ts_z, 0)),
            })
        df = pd.DataFrame(rows, columns=['_time','program','recipe','batches_min','giveaway_pct','rejects_per_min'])

        # densify using the window’s minute index if provided
        if full_minutes_z:
            full_idx = pd.to_datetime(full_minutes_z, utc=True)
            g0 = {pd.to_datetime(k, utc=True): float(v) for k, v in gate0_counts_per_min.items()}
            df = (
                df.set_index('_time')
                .reindex(full_idx)
                .assign(
                    program=str(program_id),
                    recipe='__combined',
                    batches_min=lambda d: d['batches_min'].fillna(0.0),
                    giveaway_pct=lambda d: d['giveaway_pct'].fillna(0.0),
                    rejects_per_min=lambda d: d.index.map(lambda t: g0.get(t, 0.0))
                )
                .reset_index()
                .rename(columns={'index':'_time'})
            )

        if self.client and not df.empty:
            self.client.write(
                df,
                data_frame_measurement_name='kpi_minute',
                data_frame_timestamp_column='_time',
                data_frame_tag_columns=['program','recipe'],
            )
        return df
    
    # --------- M4
    def writeKpiTotals(self, t_utc: pd.Timestamp, recipe_name: str,
                       total_batches: float, giveaway_g_per_batch: float, giveaway_pct_avg: float):
        if not self.client: return
        p = Point("kpi_totals").time(self._to_dt(t_utc)) \
                               .tag("recipe", str(recipe_name)) \
                               .field("total_batches", float(total_batches)) \
                               .field("giveaway_g_per_batch", float(giveaway_g_per_batch)) \
                               .field("giveaway_pct_avg", float(giveaway_pct_avg))
        self.client.write(p)

    def writeKpiTotalsDF(self, m4_df: pd.DataFrame, program_id: int):
        if m4_df.empty:
            return m4_df

        df = m4_df.copy()
        df['program'] = str(program_id)          # <-- always attach program

        if self.client:                          # <-- only guard the write
            self.client.write(
                df,
                data_frame_measurement_name='kpi_totals',
                data_frame_timestamp_column='_time',
                data_frame_tag_columns=['program','recipe'],
            )
        return df

    # --------- M5
    def writeAssignment(self, t_utc: pd.Timestamp, gate: Optional[int], recipe_name: Optional[str], piece_id: Optional[str] = None):
        if not self.client: return
        p = Point("assignments").time(self._to_dt(t_utc)).field("assigned", 1)
        if piece_id: p = p.tag("piece_id", str(piece_id))
        if gate is not None: p = p.tag("gate", str(int(gate)))
        if recipe_name: p = p.tag("recipe", str(recipe_name))
        self.client.write(p)

# --------------------- PARSERS FOR WINDOWS / RECIPE MAP ---------------------
def _parse_pair_generic(s: Any) -> Tuple[int, int]:
    """
    Accepts formats like '(120, 160)', '[4875, 9999]', '120,160', ' 120 , 160 '.
    Returns (0, 0) if missing/invalid.
    """
    if pd.isna(s):
        return (0, 0)
    txt = str(s).strip()
    if not txt:
        return (0, 0)

    # strip brackets/parentheses and spaces
    txt = txt.replace('[', '').replace(']', '').replace('(', '').replace(')', '')
    txt = txt.replace(' ', '')
    if ',' not in txt:
        return (0, 0)
    a, b = txt.split(',', 1)
    try:
        return int(float(a)), int(float(b))
    except Exception:
        return (0, 0)

def parse_bounds_piece(s: Any) -> Tuple[int, int]:
    return _parse_pair_generic(s)

def parse_bounds_batch(s: Any) -> Tuple[int, int]:
    return _parse_pair_generic(s)

def parse_batch_count(s: Any) -> Tuple[Optional[str], Optional[int]]:
    if pd.isna(s): return (None, None)
    st = str(s).strip()
    if st in ('', 'NA', '*'): return (None, None)
    if st.startswith('>'):  # min
        return ('min', int(float(st[1:])))
    if st.startswith('<'):  # max
        return ('max', int(float(st[1:])))
    try:
        return ('exact', int(float(st)))
    except:
        return (None, None)

# --------------------- DF NORMALIZATION ---------------------
def load_df(df_path: str) -> pd.DataFrame:
    df = pd.read_excel(df_path, engine="openpyxl")

    # Build Timestamp (no shifting, just mark as UTC)
    if 'Timestamp' in df.columns:
        ts = pd.to_datetime(df['Timestamp'], errors='coerce')
    elif 'K' in df.columns:
        ts = pd.to_datetime(df['K'], errors='coerce')
    elif {'A','B'}.issubset(set(df.columns)):
        ts = pd.to_datetime(df['A'].astype(str) + ' ' + df['B'].astype(str), errors='coerce')
    else:
        raise ValueError("df.xlsx missing a recognizable timestamp (need 'Timestamp' or 'K' or columns A+B).")

    # IMPORTANT: interpret as UTC WITHOUT conversion
    df['Timestamp'] = ts.dt.tz_localize('UTC')

    # Columns
    if 'Type' not in df.columns:
        df['Type'] = 'Piece'
    if 'Gate' not in df.columns:
        raise ValueError("df.xlsx must contain a Gate column.")
    if 'Weight' not in df.columns:
        raise ValueError("df.xlsx must contain a Weight column (grams).")

    for col in ['Class', 'BatchWeight', 'BatchCount', 'file_order']:
        if col not in df.columns:
            df[col] = np.nan

    df['Gate'] = pd.to_numeric(df['Gate'], errors='coerce').fillna(0).astype(int)
    df['Weight'] = pd.to_numeric(df['Weight'], errors='coerce').fillna(0).astype(int)

    # Stable sort so piece/batch rows that share a timestamp stay in file order
    # (pieces before/after batches depending on how they were written).
    return df.sort_values(['Timestamp', 'file_order'], ascending=[True, False], kind='mergesort').reset_index(drop=True)


def load_windows(windows_path: str) -> pd.DataFrame:
    win = pd.read_excel(windows_path, engine="openpyxl")
    cols = {c.lower(): c for c in win.columns}
    if 'start' not in cols or 'end' not in cols:
        raise ValueError("windows.xlsx must have 'start' and 'end' columns.")

    # Interpret as UTC WITHOUT conversion
    win['start'] = pd.to_datetime(win[cols['start']], errors='coerce').dt.tz_localize('UTC')
    win['end']   = pd.to_datetime(win[cols['end']],   errors='coerce').dt.tz_localize('UTC')

    return win

def load_recipe_map(recipe_map_path: str) -> Dict[str, RecipeSpec]:
    rm = pd.read_excel(recipe_map_path, engine="openpyxl")
    # Expect at least a 'name' column (recipe), we parse from name "R_x_y_xx_yy_xxx_yyy"
    if 'name' not in {c.lower() for c in rm.columns}:
        # try first column as name
        rm = rm.rename(columns={rm.columns[0]: 'name'})
    out: Dict[str, RecipeSpec] = {}
    for _, row in rm.iterrows():
        name = str(row.get('name', '')).strip()
        if not name.startswith('R_'): continue
        try:
            _, x, y, xx, yy, xxx, yyy = name.split('_', 6)
            bc_type = None if xxx == 'NA' else xxx
            bc_val = None if yyy in ('NA','',None) else int(float(yyy))
            spec = RecipeSpec(int(x), int(y), int(xx), int(yy), bc_type, bc_val)
            out[name] = spec
        except Exception:
            continue
    return out

# --------------------- KPI COMPUTATION ---------------------

def densify_sql_minutes(prog_minute: Dict[str, Dict[str, float]],
                        recipe_minute: Dict[tuple, Dict[str, float]],
                        assignments: WindowAssignments,
                        full_minutes_z: List[str]):
    # Program minutes
    for ts_z in full_minutes_z:
        prog_minute.setdefault(ts_z, {"batches_created":0, "pieces_processed":0, "weight_processed_g":0})

    # Recipe minutes (for every assigned recipe)
    recipe_names = [assignments.gate_to_recipe_name[g]
                    for g in assignments.gate_to_recipe_name
                    if isinstance(g, int) and assignments.gate_to_recipe_name[g]]
    # Map recipe_id -> exists
    rid_set = set(assignments.recipe_id_to_gates.keys())
    for rid in rid_set:
        if rid is None:
            continue
        for ts_z in full_minutes_z:
            recipe_minute.setdefault((rid, ts_z), {"batches_created":0, "pieces_processed":0, "weight_processed_g":0})

def compute_window_kpis(df_slice: pd.DataFrame, assignments: WindowAssignments):
    """
    Returns:
      - program_totals: dict for program_stats
      - per_recipe_totals: dict[recipe_id] -> totals
      - prog_minute: dict[minute_iso] -> {batches_created, pieces_processed, weight_processed_g}
      - recipe_minute: dict[(recipe_id, minute_iso)] -> same fields as prog_minute
      - dwell: dict[gate] -> list[durations_sec]
      - recipe_kpi_minute: dict[(recipe_id, minute_iso)] -> {batches_min, rejects_per_min, giveaway_pct}
      - combined_kpi_minute: dict[minute_iso] -> {batches_min, rejects_per_min, giveaway_pct}
    """
    pieces = df_slice[df_slice['Type']=='Piece'].copy()
    batches = df_slice[df_slice['Type']=='Batch'].copy()

    # -------- per-recipe totals using "filled batches equiv" logic --------
    per_recipe_totals = {}
    total_filled = 0.0
    total_w_batched = 0.0
    total_w_give = 0.0

    # Build a compact recipe dataframe like in your reference
    pieces_sorted = df_slice.sort_values(by=['Timestamp','file_order'], ascending=[True, False], kind='mergesort')
    pieces_only   = pieces_sorted[pieces_sorted['Type']=='Piece']

    for rid, gates in assignments.recipe_id_to_gates.items():
        if rid is None or not gates: 
            continue

        rname = assignments.gate_to_recipe_name[gates[0]]
        try:
            _, x, y, xx, yy, xxx, yyy = rname.split('_', 6)
            lo_p, hi_p = int(x), int(y)
            lo_b, hi_b = int(xx), int(yy)
            bc_type = None if xxx == 'NA' else xxx
            bc_val  = None if yyy in ('NA','',None) else int(float(yyy))
        except Exception:
            lo_p=hi_p=lo_b=hi_b=0; bc_type=None; bc_val=None

        b = df_slice[(df_slice['Type']=='Batch') & (df_slice['Gate'].isin(gates))].sort_values('Timestamp').copy()

        filled_equiv = 0.0
        w_target_sum = 0.0
        w_actual_sum = float(b['Weight'].sum())

        for _, bb in b.iterrows():
            weight = float(bb['Weight'])
            if bc_type in ('exact','min') and bc_val:
                try:
                    actual_count = int(float(bb.get('BatchCount', np.nan)))
                except:
                    actual_count = 0
                this_fill = 1.0 if (bc_type=='exact' and actual_count==bc_val) or (bc_type=='min' and actual_count>=bc_val) \
                        else (actual_count/float(bc_val)) if bc_val else 0.0
                this_target = this_fill * (bc_val * lo_p if bc_val else 0.0)
            else:
                if lo_b <= 0:
                    this_fill   = 1.0
                    this_target = weight
                else:
                    this_fill   = 1.0 if weight >= lo_b else weight/float(lo_b)
                    this_target = this_fill * lo_b

            filled_equiv += this_fill
            w_target_sum += this_target

        w_give = max(0.0, w_actual_sum - w_target_sum)

        # rejects for SQL totals: gate 0, but eligibility by piece bounds
        elig = pieces_only[pieces_only['Weight'].between(lo_p, hi_p)]
        w_rej = float(elig[~elig['Gate'].isin(gates)]['Weight'].sum())
        i_rej = int(elig[~elig['Gate'].isin(gates)].shape[0])
        i_bat = int(pieces_only[pieces_only['Gate'].isin(gates)].shape[0])

        per_recipe_totals[rid] = {
            "total_batches": float(filled_equiv),                     # NOTE: filled equivalents
            "total_batched_weight_g": int(w_target_sum),
            "total_reject_weight_g": int(w_rej),
            "total_giveaway_weight_g": int(round(w_give)),
            "total_items_batched": i_bat,
            "total_items_rejected": i_rej
        }

        total_filled     += filled_equiv
        total_w_batched  += w_target_sum
        total_w_give     += w_give

    # SQL program totals (reject weight = actual gate 0 weight)
    w_reject_prog = float(df_slice[(df_slice['Type']=='Piece') & (df_slice['Gate']==0)]['Weight'].sum())
    items_batched = int(pieces_only[pieces_only['Gate']!=0].shape[0])
    items_reject  = int(pieces_only[pieces_only['Gate']==0].shape[0])

    program_totals = {
        "total_batches": float(total_filled),                      # filled equivalents
        "total_batched_weight_g": int(total_w_batched),
        "total_reject_weight_g": int(w_reject_prog),
        "total_giveaway_weight_g": int(round(total_w_give)),
        "total_items_batched": items_batched,
        "total_items_rejected": items_reject
    }

    # -------- throughput minute (SQLite 11–13) --------
    prog_minute: Dict[str, Dict[str, float]] = {}
    # batches/min
    for ts_min, cnt in batches[batches['Gate']!=0].groupby(batches['Timestamp'].dt.floor('T')).size().items():
        z = iso_minute_z(ts_min)
        prog_minute.setdefault(z, {"batches_created":0, "pieces_processed":0, "weight_processed_g":0})
        prog_minute[z]["batches_created"] += int(cnt)
    # pieces/min (processed = batched + rejected)
    for ts_min, cnt in pieces.groupby(pieces['Timestamp'].dt.floor('T')).size().items():
        z = iso_minute_z(ts_min)
        prog_minute.setdefault(z, {"batches_created":0, "pieces_processed":0, "weight_processed_g":0})
        prog_minute[z]["pieces_processed"] += int(cnt)
    # weight processed/min (non-reject pieces)
    nonrej = pieces[pieces['Gate']!=0]
    for ts_min, s in nonrej.groupby(nonrej['Timestamp'].dt.floor('T'))['Weight'].sum().items():
        z = iso_minute_z(ts_min)
        prog_minute.setdefault(z, {"batches_created":0, "pieces_processed":0, "weight_processed_g":0})
        prog_minute[z]["weight_processed_g"] += int(s)

    recipe_minute: Dict[Tuple[int, str], Dict[str, float]] = {}
    for rid, gates in assignments.recipe_id_to_gates.items():
        if rid is None or not gates: continue
        # batches per minute
        b = batches[batches['Gate'].isin(gates)]
        for ts_min, cnt in b.groupby(b['Timestamp'].dt.floor('T')).size().items():
            key = (rid, iso_minute_z(ts_min))
            recipe_minute.setdefault(key, {"batches_created":0, "pieces_processed":0, "weight_processed_g":0})
            recipe_minute[key]["batches_created"] += int(cnt)
        # pieces per minute
        p = pieces[pieces['Gate'].isin(gates)]
        for ts_min, cnt in p.groupby(p['Timestamp'].dt.floor('T')).size().items():
            key = (rid, iso_minute_z(ts_min))
            recipe_minute.setdefault(key, {"batches_created":0, "pieces_processed":0, "weight_processed_g":0})
            recipe_minute[key]["pieces_processed"] += int(cnt)
        # weight processed/min
        for ts_min, s in p.groupby(p['Timestamp'].dt.floor('T'))['Weight'].sum().items():
            key = (rid, iso_minute_z(ts_min))
            recipe_minute.setdefault(key, {"batches_created":0, "pieces_processed":0, "weight_processed_g":0})
            recipe_minute[key]["weight_processed_g"] += int(s)

    # -------- minute-level KPIs for Influx (M3) --------
    recipe_kpi_minute: Dict[Tuple[int, str], Dict[str, float]] = {}
    # cache per-minute (w_give, denom) to build combined later
    minute_accum_extra: Dict[str, Dict[str, float]] = {}  # ts_z -> {w_give_sum, denom_sum}
    for rid, gates in assignments.recipe_id_to_gates.items():
        if rid is None or not gates: continue

        rname = assignments.gate_to_recipe_name[gates[0]]
        try:
            _, x, y, xx, yy, xxx, yyy = rname.split('_', 6)
            lo_p, hi_p = int(x), int(y)
            lo_b, hi_b = int(xx), int(yy)
            bc_type = None if xxx == 'NA' else xxx
            bc_val  = None if yyy in ('NA','',None) else int(float(yyy))
        except Exception:
            lo_p=hi_p=lo_b=hi_b=0; bc_type=None; bc_val=None

        # batches and eligible rejects for this recipe
        b = batches[batches['Gate'].isin(gates)]
        elig = pieces[pieces['Weight'].between(lo_p, hi_p)]
        rej = elig[~elig['Gate'].isin(gates)]

        # batches per minute for 'batches_min'
        b_count_by_min = b.groupby(b['Timestamp'].dt.floor('T')).size()

        # actual batched weight per minute
        b_w_by_min = b.groupby(b['Timestamp'].dt.floor('T'))['Weight'].sum()
        # rejected eligible weight per minute
        rej_w_by_min = rej.groupby(rej['Timestamp'].dt.floor('T'))['Weight'].sum()
        # rejected count per minute
        rej_c_by_min = rej.groupby(rej['Timestamp'].dt.floor('T')).size()

        # compute target weight per minute (apply same rules to the minute's batch subset)
        for ts_min, w_actual in b_w_by_min.items():
            sub_batches = b[b['Timestamp'].dt.floor('T') == ts_min]
            w_target = 0.0
            for _, bb in sub_batches.iterrows():
                weight = float(bb['Weight'])
                if bc_type in ('exact','min') and bc_val:
                    try:
                        actual_count = int(float(bb.get('BatchCount', np.nan)))
                    except:
                        actual_count = 0
                    fill = 1.0 if (bc_type=='exact' and actual_count==bc_val) or (bc_type=='min' and actual_count>=bc_val) \
                           else (actual_count/float(bc_val)) if bc_val else 0.0
                    w_target += fill * (bc_val * lo_p if bc_val else 0.0)
                else:
                    if lo_b <= 0:
                        w_target += weight
                    else:
                        fill = 1.0 if weight >= lo_b else weight/float(lo_b)
                        w_target += fill * lo_b

            w_give = max(0.0, float(w_actual) - float(w_target))
            denom = float(w_actual) + w_give
            gpct = (w_give / denom * 100.0) if denom > 0 else 0.0

            key = (rid, iso_minute_z(ts_min))
            # batches_min
            bmin = int(b_count_by_min.get(ts_min, 0))
            # rejects_per_min
            rmin = int(rej_c_by_min.get(ts_min, 0))

            recipe_kpi_minute[key] = {
                "batches_min": bmin,
                "giveaway_pct": float(gpct),
            }

            # accumulate for combined
            tz_z = iso_minute_z(ts_min)
            acc = minute_accum_extra.setdefault(tz_z, {"w_give_sum": 0.0, "denom_sum": 0.0})
            acc["w_give_sum"] += w_give
            acc["denom_sum"]  += denom

        # also ensure minutes that had batches but zero giveaway get entries
        for ts_min, cnt in b_count_by_min.items():
            key = (rid, iso_minute_z(ts_min))
            if key not in recipe_kpi_minute:
                rmin = int(rej_c_by_min.get(ts_min, 0))
                recipe_kpi_minute[key] = {"batches_min": int(cnt), "rejects_per_min": rmin, "giveaway_pct": 0.0}

    # combined minute roll-up
    combined_kpi_minute: Dict[str, Dict[str, float]] = {}
    # sum batches_min & rejects_per_min from recipe_kpi_minute
    for (rid, ts_z), v in recipe_kpi_minute.items():
        c = combined_kpi_minute.setdefault(ts_z, {"batches_min": 0.0, "rejects_per_min": 0.0, "giveaway_pct": 0.0})
        c["batches_min"]     += float(v.get("batches_min", 0))
        c["rejects_per_min"] += float(v.get("rejects_per_min", 0))

    # compute combined giveaway pct from accumulated w_give/denom
    for ts_z, acc in minute_accum_extra.items():
        w_give_sum = float(acc.get("w_give_sum", 0.0))
        denom_sum  = float(acc.get("denom_sum", 0.0))
        gpct = (w_give_sum / denom_sum * 100.0) if denom_sum > 0 else 0.0
        combined_kpi_minute.setdefault(ts_z, {"batches_min": 0.0, "rejects_per_min": 0.0, "giveaway_pct": 0.0})
        combined_kpi_minute[ts_z]["giveaway_pct"] = gpct

    # -------- dwell --------
    dwell: Dict[int, List[float]] = {}
    for gate, grp in batches.groupby('Gate'):
        if gate == 0: continue
        ts_sorted = grp['Timestamp'].sort_values()
        diffs = ts_sorted.diff().dropna().dt.total_seconds().tolist()
        dwell[int(gate)] = diffs

    return program_totals, per_recipe_totals, prog_minute, recipe_minute, dwell, recipe_kpi_minute, combined_kpi_minute

# --------------------- MAIN PIPELINE ---------------------
def build_window_assignments(win_row: pd.Series, recipe_map: Dict[str, RecipeSpec], sw: SqliteWriter) -> Tuple[int, int, WindowAssignments, str]:
    """
    Use EXACT headers from windows.xlsx:
      - start, end
      - g{N}_piece, g{N}_b_weight, g{N}_b_count   for N = 1..8
      - optional recipe_1..recipe_8 (we ignore them for assignment; identical specs dedupe by name anyway)

    Creates:
      - program (name or "Imported yyyymmdd-hhmmss")
      - run_config + assignments (NULL for empty gates)
    """
    # program name
    base_name = None
    for col in win_row.index:
        if str(col).lower() in ('program', 'name'):
            base_name = str(win_row[col]).strip()
            break
    if not base_name or base_name == 'nan':
        base_name = f"Imported {pd.Timestamp(win_row['start']).tz_convert(UTC).strftime('%Y%m%d-%H%M%S')}"

    program_id = sw.get_or_create_program(base_name, gates=9)
    config_name = f"{base_name} @ {pd.Timestamp(win_row['start']).tz_convert(UTC).strftime('%Y-%m-%d %H:%M:%S')}"
    config_id = sw.create_run_config(program_id, config_name)

    cols = {str(c).lower(): c for c in win_row.index}

    gate_to_recipe_id: Dict[int, Optional[int]] = {}
    gate_to_recipe_name: Dict[int, Optional[str]] = {}

    # Gates 1..8 (0 stays for rejects)
    for g in range(1, 9):
        pcol = cols.get(f"g{g}_piece")
        bwcol = cols.get(f"g{g}_b_weight")
        ccol = cols.get(f"g{g}_b_count")

        piece_lo, piece_hi = parse_bounds_piece(win_row[pcol]) if pcol in win_row else (0, 0)
        batch_lo, batch_hi = parse_bounds_batch(win_row[bwcol]) if bwcol in win_row else (0, 0)
        bc_type, bc_val = parse_batch_count(win_row[ccol]) if ccol in win_row else (None, None)

        # empty if truly nothing is configured
        is_empty = (piece_lo == 0 and piece_hi == 0 and batch_lo == 0 and batch_hi == 0 and bc_type is None and bc_val is None)
        if is_empty:
            gate_to_recipe_id[g] = None
            gate_to_recipe_name[g] = None
            sw.upsert_assignment(config_id, g, None)
            continue

        spec = RecipeSpec(piece_lo, piece_hi, batch_lo, batch_hi, bc_type, bc_val)

        # allow recipe_map overrides by canonical name
        rname = spec.recipe_name()
        if rname in recipe_map:
            spec = recipe_map[rname]
            rname = spec.recipe_name()

        recipe_id = sw.get_or_create_recipe(spec)
        gate_to_recipe_id[g] = recipe_id
        gate_to_recipe_name[g] = rname
        sw.upsert_assignment(config_id, g, recipe_id)

    # build reverse map
    recipe_id_to_gates: Dict[int, List[int]] = {}
    for g, rid in gate_to_recipe_id.items():
        if rid is None:
            continue
        recipe_id_to_gates.setdefault(rid, []).append(int(g))

    # debug: show exactly what we assigned (will avoid the old "fallback" noise)
    have = sorted([g for g, rid in gate_to_recipe_id.items() if rid is not None])
    names = [gate_to_recipe_name[g] for g in have]
    print(f"[assign] gates with recipes: {have} -> {names}")

    return program_id, config_id, WindowAssignments(gate_to_recipe_id, gate_to_recipe_name, recipe_id_to_gates), base_name

def build_m4_cumulative_per_minute(df_slice: pd.DataFrame, assignments: WindowAssignments) -> pd.DataFrame:
    """
    For each recipe:
      - compute for each minute: filled_batches_equiv (sum of "fill"),
        batched_actual_w, target_w, giveaway_w
      - then build cumulative totals over time within the window
      - emit per-minute rows with:
          total_batches (cum filled), giveaway_g_per_batch (cum_give / max(cum_filled,1)),
          giveaway_pct_avg (cum_give / (cum_actual + cum_give) * 100)
    """
    pieces = df_slice[df_slice['Type']=='Piece'].copy()
    batches = df_slice[df_slice['Type']=='Batch'].copy()

    rows = []

    for rid, gates in assignments.recipe_id_to_gates.items():
        if rid is None or not gates: 
            continue

        rname = assignments.gate_to_recipe_name[gates[0]]

        # decode recipe spec from name
        try:
            _, x, y, xx, yy, xxx, yyy = rname.split('_', 6)
            lo_p, hi_p = int(x), int(y)
            lo_b, hi_b = int(xx), int(yy)
            bc_type = None if xxx == 'NA' else xxx
            bc_val  = None if yyy in ('NA','',None) else int(float(yyy))
        except Exception:
            lo_p=hi_p=lo_b=hi_b=0; bc_type=None; bc_val=None

        b = batches[batches['Gate'].isin(gates)].copy()  
        if b.empty:
            continue                               
        b.loc[:, '__m'] = b['Timestamp'].dt.floor('T')    # <— safer assign

        # per-minute aggregates: actual weight and "filled equivalents"
        per_min = []
        for ts_min, bb in b.groupby('__m'):
            w_actual = float(bb['Weight'].sum())
            filled = 0.0
            w_target = 0.0

            for _, one in bb.iterrows():
                weight = float(one['Weight'])
                if bc_type in ('exact','min') and bc_val:
                    try:
                        actual_count = int(float(one.get('BatchCount', np.nan)))
                    except:
                        actual_count = 0
                    this_fill = 1.0 if (bc_type=='exact' and actual_count==bc_val) or (bc_type=='min' and actual_count>=bc_val) \
                               else (actual_count/float(bc_val)) if bc_val else 0.0
                    this_tgt = this_fill * (bc_val * lo_p if bc_val else 0.0)
                else:
                    if lo_b <= 0:
                        this_fill = 1.0
                        this_tgt  = weight
                    else:
                        this_fill = 1.0 if weight >= lo_b else weight/float(lo_b)
                        this_tgt  = this_fill * lo_b

                filled   += this_fill
                w_target += this_tgt

            w_give = max(0.0, w_actual - w_target)
            per_min.append((ts_min, filled, w_actual, w_give))

        if not per_min:
            continue

        # sort by minute and do cumulative
        per_min = sorted(per_min, key=lambda t: t[0])
        cum_filled = 0.0
        cum_actual = 0.0
        cum_give   = 0.0

        for ts_min, filled, w_actual, w_give in per_min:
            cum_filled += filled
            cum_actual += w_actual
            cum_give   += w_give

            gpb = (cum_give / max(1.0, cum_filled))
            gpct_avg = (cum_give / (cum_actual + cum_give) * 100.0) if (cum_actual + cum_give) > 0 else 0.0

            rows.append({
                '_time': ts_min.tz_localize('UTC') if ts_min.tzinfo is None else ts_min.tz_convert('UTC'),
                'recipe': rname,
                'total_batches': float(cum_filled),
                'giveaway_g_per_batch': float(gpb),
                'giveaway_pct_avg': float(gpct_avg),
            })

    return pd.DataFrame(rows, columns=['_time','recipe','total_batches','giveaway_g_per_batch','giveaway_pct_avg'])

def main():
    ap = argparse.ArgumentParser(description="One-time import of Excel data into SQLite and Influx")

    # Defaults to local one_time_data if args omitted (nice for VS Code debug)
    base_dir = os.path.dirname(os.path.abspath(__file__))
    df_path = os.path.join(base_dir, "one_time_data", "df.xlsx")
    windows_path = os.path.join(base_dir, "one_time_data", "windows.xlsx")
    recipe_map_path = os.path.join(base_dir, "one_time_data", "recipe_map.xlsx")

    ap.add_argument("--df", default=df_path, help="Path to df.xlsx")
    ap.add_argument("--windows", default=windows_path, help="Path to windows.xlsx")
    ap.add_argument("--recipe-map", default=recipe_map_path, help="Optional recipe_map.xlsx")
    ap.add_argument("--piece-id-start", type=int, default=1, help="Starting integer for piece_id; keeps increasing across windows.")
    args = ap.parse_args()

    print(f"[+] SQLite: {SQLITE_DB}")
    if HAS_INFLUX:
        print(f"[+] Influx host: {INFLUX_HOST}  db={INFLUX_DB}")
        tok = (INFLUX_TOKEN or "")
        print("[+] Token set:", "yes" if tok else "NO")
        if tok:
            print("[+] Token preview:", f"{tok[:6]}…{tok[-4:]}")
    else:
        print("[!] Influx disabled (missing client or env). Will only fill SQLite.")

    # Load data
    df = load_df(args.df)
    win = load_windows(args.windows)
    rmap = load_recipe_map(args.recipe_map) if args.recipe_map else {}

    sw = SqliteWriter(SQLITE_DB)
    iw = InfluxWriter()

    piece_id_counter = args.piece_id_start

    if HAS_INFLUX and iw.client:
        from influxdb_client_3 import Point
        try:
            ts = pd.Timestamp.now(tz=UTC)
            iw.client.write(Point("_preflight").time(ts.to_pydatetime()).field("ok", 1))
            print("[Influx] preflight write OK")
        except Exception as e:
            print(f"[Influx][preflight] FAILED: {type(e).__name__}: {e}")
            print("-> Check INFLUXDB3_HOST_URL / INFLUXDB3_DATABASE / INFLUXDB3_AUTH_TOKEN and token permissions.")
            # Disable further writes but keep SQLite/CSV going:
            iw.client = None

    try:
        for idx, wrow in win.iterrows():
            print(f"[+] window: {idx}")
            start_utc = pd.Timestamp(wrow['start'])
            end_utc   = pd.Timestamp(wrow['end'])
            if pd.isna(start_utc) or pd.isna(end_utc) or start_utc >= end_utc:
                print(f"[skip] window {idx}: invalid start/end")
                continue

            # Build program + config + (attempt) assignments from windows.xlsx
            program_id, config_id, assignments, program_name = build_window_assignments(wrow, rmap, sw)  

            # Slice df for this window and trim partial batches
            df_slice = df[(df['Timestamp'] >= start_utc) & (df['Timestamp'] <= end_utc)].copy()
            if df_slice.empty:
                print(f"[warn] window {idx} slice empty.")
                continue
            df_slice = fix_window_slice(df_slice)

            print(f"[debug] df_slice.shape: {df_slice.shape}")
            print("[debug] pieces(g!=0) after trim:", df_slice[(df_slice['Type']=='Piece') & (df_slice['Gate']!=0)].shape[0])
            print("[debug] batches(g!=0) after trim:", df_slice[(df_slice['Type']=='Batch') & (df_slice['Gate']!=0)].shape[0])

            disp_start_z = df_slice['Timestamp'].min().strftime('%Y-%m-%d %H:%M:%SZ')
            disp_end_z   = df_slice['Timestamp'].max().strftime('%Y-%m-%d %H:%M:%SZ')
            print(f"[window span trimmed UTC] {disp_start_z} .. {disp_end_z}")

            # If the window sheet didn't yield any gate recipes, derive from data.
            if not assignments.recipe_id_to_gates:
                print("[assign][skip] no gate recipes defined in windows.xlsx for this window.")
                continue

            # Mark settings_history: start/end (after assignments exist)
            sw.settings_history_mark(start_utc, config_id, note="import start")
            sw.settings_history_mark(end_utc,   None,       note="import end")

            # compute dense minute list for this window if needed
            full_minutes_z = []
            if DENSE_INFLUX_MINUTES:
                t0 = df_slice['Timestamp'].min().floor('T')
                t1 = df_slice['Timestamp'].max().floor('T')
                full_minutes_z = [m.strftime("%Y-%m-%dT%H:%M:00Z") for m in pd.date_range(t0, t1, freq='T')]
                # sneak it into assignments for writeKpiMinuteDF (no schema change to that signature)
                assignments.gate_to_recipe_name['__full_minutes__'] = full_minutes_z

            # Compute KPIs (#1..#13 + dwell)
            (prog_totals,
             recipe_totals,
             prog_minute,
             recipe_minute,
             dwell,
             recipe_kpi_minute,
             combined_kpi_minute) = compute_window_kpis(df_slice, assignments)

            # Build dense minute list for SQLite always
            t0 = df_slice['Timestamp'].min().floor('T')
            t1 = df_slice['Timestamp'].max().floor('T')
            full_minutes_z_sql = [m.strftime("%Y-%m-%dT%H:%M:00Z") for m in pd.date_range(t0, t1, freq='T')]

            densify_sql_minutes(prog_minute, recipe_minute, assignments, full_minutes_z_sql)

            # --- WRITE SQLITE ---
            sw.write_program_totals(program_id, prog_totals, start_utc, end_utc)
            for rid, totals in recipe_totals.items():
                sw.bump_recipe_totals(program_id, rid, totals)
            zero_prog = {"batches_created":0, "pieces_processed":0, "weight_processed_g":0}
            for ts_z in full_minutes_z_sql:
                sw.upsert_program_minute(program_id, ts_z, prog_minute.get(ts_z, zero_prog))
            zero_rec = {"batches_created":0, "pieces_processed":0, "weight_processed_g":0}
            for rid in assignments.recipe_id_to_gates.keys():
                if rid is None:
                    continue
                for ts_z in full_minutes_z_sql:
                    sw.upsert_recipe_minute(program_id, rid, ts_z, recipe_minute.get((rid, ts_z), zero_rec))
            for gate, durations in dwell.items():
                sw.update_gate_dwell(program_id, gate, durations)


            # build Gate-0 (reject) piece-counts per minute for M3 combined
            g0 = df_slice[(df_slice['Type'] == 'Piece') & (df_slice['Gate'] == 0)].copy()
            if not g0.empty:
                gate0_counts_per_min = (
                    g0.assign(_min=g0['Timestamp'].dt.floor('T'))
                    .groupby('_min').size()
                )
                # convert index->iso minute strings
                gate0_counts_per_min = { iso_minute_z(k): int(v) for k, v in gate0_counts_per_min.items() }
            else:
                gate0_counts_per_min = {}

            # --- WRITE INFLUX (optional, v3 / M1–M5) ---
            if HAS_INFLUX and iw.client:
                print(f"[Influx] window '{program_name}' {disp_start_z}..{disp_end_z}")

                # M5: per-gate assignments at window start (recipe tagged, no program tag)
                for gate, rname in assignments.gate_to_recipe_name.items():
                    if not isinstance(gate, int) or not rname:
                        continue
                    iw.writeAssignment(start_utc, gate=int(gate), recipe_name=rname)
                    CSV_ROWS_INFLUX_M5_ASSIGNMENTS.append({
                        "ts": utc_iso(start_utc),
                        "program": int(program_id),
                        "gate": int(gate),
                        "recipe": str(rname),
                    })

                # M1: raw pieces (no piece_id in historical xlsx)
                pieces_all = df_slice[df_slice['Type'] == 'Piece'].copy()

                # stable order within the window; give each piece an ID starting at 1
                pieces_all = pieces_all.sort_values(['Timestamp','file_order'], ascending=[True, False], kind='mergesort').reset_index(drop=True)
                start = piece_id_counter
                end = start + len(pieces_all)
                pieces_all['piece_id'] = np.arange(start, end).astype(str)
                piece_id_counter = end

                # Try the fast DF writer first; if the server complains, fall back to chunked Points.
                try:
                    iw.writePiecesDataFrame(pieces_all)
                except Exception as e:
                    print(f"[M1] DataFrame write failed ({type(e).__name__}): {e}")
                    print("[M1] Falling back to chunked Points write…")
                    iw.writePiecesChunked(
                        pieces_all,
                        chunk_size=int(os.getenv("ONE_TIME_CHUNK_SIZE", "5000"))
                    )

                # Optional CSV audit (no per-row prints)
                for _, rowp in pieces_all.iterrows():
                    ts = pd.Timestamp(rowp['Timestamp'])
                    CSV_ROWS_INFLUX_M1_PIECES.append({
                        "ts": utc_iso(ts),
                        "weight_g": float(rowp['Weight']),
                        "piece_id": str(rowp['piece_id']),
                        "gate": int(rowp['Gate']),
                    })


                # M2: gate_state per minute per gate (count & sum) — DataFrame bulk write
                m2_df = iw.writeGateStateCumulativeFromSlice(df_slice)

                # CSV audit dump (per-piece rows, not per-minute)
                if not m2_df.empty:
                    CSV_ROWS_INFLUX_M2_GATE.extend(
                        m2_df.assign(
                            ts_minute=m2_df['_time'].map(utc_iso),
                            gate_csv=m2_df['gate'].astype(int)
                        )[ ['ts_minute', 'gate_csv', 'pieces_in_gate', 'weight_sum_g'] ]
                        .rename(columns={'gate_csv':'gate'})
                        .to_dict('records')
                    )

                # ---------- M3: recipe kpis per minute (fast DF) ----------
                m3_recipe_df = iw.writeKpiMinuteDF(recipe_kpi_minute, assignments, program_id)
                if not m3_recipe_df.empty:
                    CSV_ROWS_INFLUX_M3_RECIPE.extend(
                        m3_recipe_df.assign(
                            ts_minute=lambda d: d['_time'].map(utc_iso)
                        )[ ['ts_minute','program','recipe','batches_min','giveaway_pct'] ].to_dict('records')
                    )

                m3_combined_df = iw.writeKpiMinuteCombinedDF(combined_kpi_minute, program_id, gate0_counts_per_min, full_minutes_z)
                if not m3_combined_df.empty:
                    CSV_ROWS_INFLUX_M3_COMBINED.extend(
                        m3_combined_df.assign(
                            ts_minute=lambda d: d['_time'].map(utc_iso)
                        )[ ['ts_minute','program','recipe','batches_min','giveaway_pct','rejects_per_min'] ].to_dict('records')
                    )

                print("[debug] M2 rows (gate_state):", 0 if m2_df is None else len(m2_df))
                print("[debug] M3 recipe keys:", len(recipe_kpi_minute))

                # M4: rolling per-minute cumulative per recipe within this program
                m4_raw = build_m4_cumulative_per_minute(df_slice, assignments)

                if DENSE_INFLUX_MINUTES and not m4_raw.empty:
                    # full minute index for the window (UTC tz-aware)
                    full_idx = pd.to_datetime(full_minutes_z, utc=True)

                    # build a full recipe × minute grid and forward-fill within each recipe
                    recipes = m4_raw['recipe'].unique()
                    mi = pd.MultiIndex.from_product([recipes, full_idx], names=['recipe', '_time'])

                    m4_dense = (
                        m4_raw
                        .set_index(['recipe', '_time'])
                        .reindex(mi)
                        .groupby(level=0).ffill()
                        .fillna({
                            'total_batches': 0.0,
                            'giveaway_g_per_batch': 0.0,
                            'giveaway_pct_avg': 0.0
                        })
                        .reset_index()
                    )

                    m4_raw = m4_dense

                try:
                    m4_df = iw.writeKpiTotalsDF(m4_raw, program_id)
                except Exception as e:
                    print(f"[M4] totals DataFrame write failed ({type(e).__name__}): {e}")
                    m4_df = pd.DataFrame()

                if not m4_df.empty:
                    CSV_ROWS_INFLUX_M4_TOTALS.extend(
                        m4_df.assign(
                            ts=lambda d: d['_time'].map(utc_iso)
                        )[ ['ts','program','recipe','total_batches','giveaway_g_per_batch','giveaway_pct_avg'] ].to_dict('records')
                    )

            else:
                print("[Influx] writes skipped (no client)")

        sw.close()
        iw.close()
        print("[✓] Import completed.")

    except Exception as e:
        sw.close()
        iw.close()
        raise

    def _ensure_dir(path: str):
        os.makedirs(path, exist_ok=True)
        return path

    def export_influx_csv(out_dir: str = OUT_DIR):
        _ensure_dir(out_dir)
        if CSV_ROWS_INFLUX_M1_PIECES:
            pd.DataFrame(CSV_ROWS_INFLUX_M1_PIECES).sort_values("ts").to_csv(os.path.join(out_dir, "influx_m1_pieces.csv"), index=False)
        if CSV_ROWS_INFLUX_M2_GATE:
            pd.DataFrame(CSV_ROWS_INFLUX_M2_GATE).sort_values(["ts_minute","gate"]).to_csv(os.path.join(out_dir, "influx_m2_gate_state.csv"), index=False)
        if CSV_ROWS_INFLUX_M3_RECIPE:
            pd.DataFrame(CSV_ROWS_INFLUX_M3_RECIPE).sort_values(["ts_minute","recipe"]).to_csv(os.path.join(out_dir, "influx_m3_kpi_minute_recipes.csv"), index=False)
        if CSV_ROWS_INFLUX_M3_COMBINED:
            pd.DataFrame(CSV_ROWS_INFLUX_M3_COMBINED).sort_values(["ts_minute"]).to_csv(os.path.join(out_dir, "influx_m3_kpi_minute_combined.csv"), index=False)
        if CSV_ROWS_INFLUX_M4_TOTALS:
            pd.DataFrame(CSV_ROWS_INFLUX_M4_TOTALS).sort_values(["ts","recipe"]).to_csv(os.path.join(out_dir, "influx_m4_kpi_totals.csv"), index=False)
        if CSV_ROWS_INFLUX_M5_ASSIGNMENTS:
            pd.DataFrame(CSV_ROWS_INFLUX_M5_ASSIGNMENTS).sort_values(["ts","program","gate"]).to_csv(os.path.join(out_dir, "influx_m5_assignments.csv"), index=False)
        print(f"[CSV] Influx exports written to ./{out_dir}/")

    def export_sqlite_csv(sqlite_path: str, out_dir: str = OUT_DIR):
        import sqlite3
        _ensure_dir(out_dir)
        con = sqlite3.connect(sqlite_path)
        try:
            jobs = [
                ("program_stats_view",         "SELECT * FROM program_stats_view",                "sqlite_program_stats.csv"),
                ("recipe_stats_report",        "SELECT * FROM recipe_stats_report",               "sqlite_recipe_stats.csv"),  # <-- changed
                ("program_throughput_minute",  "SELECT * FROM program_throughput_minute",         "sqlite_program_throughput_minute.csv"),
                ("recipe_throughput_minute",   "SELECT * FROM recipe_throughput_minute_named",    "sqlite_recipe_throughput_minute.csv"),
                ("gate_dwell_stats",           "SELECT * FROM gate_dwell_stats",                  "sqlite_gate_dwell_stats.csv"),
            ]
            for _, sql, fname in jobs:
                try:
                    df = pd.read_sql_query(sql, con)
                    df.to_csv(os.path.join(out_dir, fname), index=False)
                except Exception as e:
                    print(f"[CSV][WARN] {fname} export skipped: {e}")
            print(f"[CSV] SQLite exports written to ./{out_dir}/")
        finally:
            con.close()

    # --- exporters ---
    export_influx_csv(OUT_DIR)
    export_sqlite_csv(SQLITE_DB, OUT_DIR)

if __name__ == "__main__":
    main()