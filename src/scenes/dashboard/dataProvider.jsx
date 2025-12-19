// src/scenes/dashboard/dataProvider.js
import { useEffect, useMemo, useState, useRef } from "react";
import { tokens } from "../../theme";
import {useTheme} from "@mui/material";

/**
 * ========= RUNTIME CONFIGURATION =======================================
 * Configuration is loaded at runtime from the backend.
 * Run: ./start_replay_mode.sh or ./start_live_mode_simple.sh to activate.
 * ======================================================================
 */
export const REPLAY_SPEED = 1; // minutes per second in replay mode (1.0 = realtime, 2.0 = 2x speed)
export const WINDOW_MIN = 60;    // fetch 30 minutes of data at a time (reduced to lower InfluxDB load)
export const BUCKET_SEC = 60;    // bucket size in seconds for aggregation
export const FETCH_THROTTLE_MIN = 0.5; // Only fetch if time jumped by > 3 seconds (reduced for better slider responsiveness)
// ======================================================================

/** ---------------- Sticky, per-second reservoir for LIVE scatter (smooth, capped, persistent) ---------------- */
const MAX_SCATTER_POINTS = 1000;
const HORIZON_MS = 60 * 60 * 1000;    // last 60 minutes
const FADE_WINDOW_MS = 5 * 60 * 1000; // last 5 min fade
const CORE_BUDGET = Math.floor(MAX_SCATTER_POINTS * 0.8); // 80% core evenly across time
const OUTLIER_BUDGET = MAX_SCATTER_POINTS - CORE_BUDGET;  // 20% outliers budget
const BUCKET_INTERVAL_MS = 5000; // 5-second buckets (720 buckets in 60 minutes)
const CORE_PER_BUCKET = Math.max(1, Math.floor(CORE_BUDGET / (HORIZON_MS / BUCKET_INTERVAL_MS))); // ~2 per 5-sec bucket
const SCATTER_LS_KEY = "scatter_live_v3"; // Changed key for new bucket structure

class StickyMinuteReservoir {
  constructor({ horizonMs, fadeMs, bucketIntervalMs }) {
    this.horizonMs = horizonMs;
    this.fadeMs = fadeMs;
    this.bucketIntervalMs = bucketIntervalMs;
    this.buckets = new Map(); // bucketKey -> { core:[], outliers:[] }
    this.seen = new Set();    // dedupe ids
    this.stats = [];          // rolling weights for q10/q90
    this.q10 = null; this.q90 = null;
    this.totalCore = 0; this.totalOutliers = 0;
  }
  bucketKey(t) { return Math.floor(t / this.bucketIntervalMs); }

  pushWeightForStats(w) {
    if (!Number.isFinite(w)) return;
    this.stats.push(w);
    if (this.stats.length > 1000) {
      this.stats.splice(0, this.stats.length - 1000);
    }
  }
  recomputeQuantiles() {
    if (this.stats.length < 50) return;
    if (!this._quantileCounter) this._quantileCounter = 0;
    this._quantileCounter++;
    if (this._quantileCounter < 10) return;
    this._quantileCounter = 0;
    
    const s = [...this.stats].sort((a,b)=>a-b);
    const i10 = Math.floor((s.length - 1) * 0.10);
    const i90 = Math.floor((s.length - 1) * 0.90);
    this.q10 = s[i10]; this.q90 = s[i90];
  }
  _isOutlier(w) {
    return this.q10 != null && this.q90 != null && (w <= this.q10 || w >= this.q90);
  }
  _getBucket(mk) {
    let b = this.buckets.get(mk);
    if (!b) { b = { core: [], outliers: [] }; this.buckets.set(mk, b); }
    return b;
  }
  _dropAged(nowMs) {
    const oldestBucket = this.bucketKey(nowMs - this.horizonMs);
    for (const bk of [...this.buckets.keys()]) {
      if (bk < oldestBucket) {
        const b = this.buckets.get(bk);
        if (b) {
          for (const p of b.core) this.seen.delete(p.id);
          for (const p of b.outliers) this.seen.delete(p.id);
          this.totalCore -= b.core.length;
          this.totalOutliers -= b.outliers.length;
        }
        this.buckets.delete(bk);
      }
    }
  }
  hydrateFromStorage(nowMs) {
    try {
      const raw = localStorage.getItem(SCATTER_LS_KEY);
      if (!raw) return;
      const obj = JSON.parse(raw);
      if (!obj || !Array.isArray(obj.rows)) return;
      const rows = obj.rows;
      for (const r of rows) {
        if (!Number.isFinite(r.t)) continue;
        if (nowMs - r.t > this.horizonMs) continue;
        const id = r.id ?? `${r.t}-${r.g ?? ''}-${Math.round((r.w ?? 0)*10)}`;
        if (this.seen.has(id)) continue;
        const bk = this.bucketKey(r.t);
        const b = this._getBucket(bk);
        const p = { id, t: r.t, weight_g: r.w ?? 0, gate: r.g ?? 0, isOutlier: !!r.o };
        if (p.isOutlier) {
          if (this.totalOutliers < OUTLIER_BUDGET) {
            b.outliers.push(p); this.totalOutliers++; this.seen.add(id);
          }
        } else {
          if (b.core.length < CORE_PER_BUCKET && this.totalCore < CORE_BUDGET) {
            b.core.push(p); this.totalCore++; this.seen.add(id);
          }
        }
      }
    } catch {}
  }
  persistToStorage(nowMs) {
    try {
      const rows = [];
      const oldestBucket = this.bucketKey(nowMs - this.horizonMs);
      for (const [bk, b] of this.buckets) {
        if (bk < oldestBucket) continue;
        for (const p of b.core) rows.push({ id: p.id, t: p.t, w: p.weight_g, g: p.gate, o: 0 });
        for (const p of b.outliers) rows.push({ id: p.id, t: p.t, w: p.weight_g, g: p.gate, o: 1 });
      }
      localStorage.setItem(SCATTER_LS_KEY, JSON.stringify({ rows }));
    } catch {}
  }
  clear() {
    // Clear all data from the reservoir (used when recipe changes)
    this.buckets.clear();
    this.seen.clear();
    this.stats = [];
    this.q10 = null;
    this.q90 = null;
    this.totalCore = 0;
    this.totalOutliers = 0;
    // Also clear localStorage
    try {
      localStorage.removeItem(SCATTER_LS_KEY);
    } catch {}
    console.log('📋 [RESERVOIR] Cleared scatter reservoir');
  }
  addPoint({ id, t, weight_g, gate }, nowMs) {
    if (!Number.isFinite(t)) return;
    if (nowMs - t > this.horizonMs) return;
    if (id != null && this.seen.has(id)) return;

    const bk = this.bucketKey(t);
    const isOut = this._isOutlier(weight_g);
    const p = { id: id ?? `${t}-${gate ?? ''}-${Math.round(weight_g*10)}`, t, weight_g, gate, isOutlier: isOut };
    const b = this._getBucket(bk);

    if (isOut) {
      if (this.totalOutliers >= OUTLIER_BUDGET) return; // keep view stable
      b.outliers.push(p); this.totalOutliers++; this.seen.add(p.id);
    } else {
      if (b.core.length >= CORE_PER_BUCKET || this.totalCore >= CORE_BUDGET) return;
      b.core.push(p); this.totalCore++; this.seen.add(p.id);
    }
  }
  snapshot(nowMs) {
    this._dropAged(nowMs);
    const start = this.bucketKey(nowMs - this.horizonMs);
    const end   = this.bucketKey(nowMs);
    const fadeStart = this.horizonMs - this.fadeMs;
    const annotate = (p) => {
      const age = nowMs - p.t;
      let alpha = 1;
      if (age > fadeStart) {
        const over = Math.min(this.fadeMs, age - fadeStart);
        alpha = Math.max(0, 1 - (over / this.fadeMs));
      }
      return { ...p, alpha };
    };
    const out = [];
    for (let bk = start; bk <= end; bk++) {
      const b = this.buckets.get(bk);
      if (!b) continue;
      for (const p of b.core) out.push(annotate(p));
      for (const p of b.outliers) out.push(annotate(p));
    }
    return out; // time-ordered by bucket + insertion order
  }
}

const API = {
  // SQLite-backed: active assignments at a timestamp
  assignmentsAt: (ts) => `/api/assignments/at-time?timestamp=${encodeURIComponent(ts)}`,
  // M2 overlay per gate (pieces, grams) - uses influx service via SSE
  overlay: (ts, windowSec = 60) =>
    `/api/history/overlay?ts=${encodeURIComponent(ts)}&windowSec=${windowSec}`,
  // Combined M3 endpoint (optimized - fetches all M3 data in one call)
  m3All: (from, to, bucket) =>
    `/api/history/m3-all?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&bucket=${bucket}`,
  // Individual history endpoints (kept for backwards compatibility)
  throughput: (from, to, bucket) =>
    `/api/history/throughput?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&bucket=${bucket}`,
  giveaway: (from, to, bucket) =>
    `/api/history/giveaway?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&bucket=${bucket}`,
  piecesProcessed: (from, to, bucket) =>
    `/api/history/pieces-processed?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&bucket=${bucket}`,
  weightProcessed: (from, to, bucket) =>
    `/api/history/weight-processed?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&bucket=${bucket}`,
  rejects: (from, to, bucket) =>
    `/api/history/rejects?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&bucket=${bucket}`,
  weights: (from, to) =>
    `/api/history/weights?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
  pies: (from, to) =>
    `/api/history/pies?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
  // SSE (server must send {"ts": ISO, "legend": [...], "overlay": [...]})
  sse: (params) => `/api/stream/dashboard${params ? `?${params}` : ""}`,
};

// Auto-detect date range from M1 data using a sampling approach
async function detectDateRange() {
  // Data actually starts at 05:59:46 (first piece) and assignments at 05:53:43
  // Start replay at 07:00:00 to ensure 60-minute lookback window has full data
  // Window will be: 06:00:00 to 07:00:00 (contains 1 hour of piece data)
  const from = new Date('2025-06-05T07:00:00Z');
  const to = new Date('2025-06-17T14:50:00Z');
  
  console.log('Using configured date range:', { 
    from: from.toISOString(), 
    to: to.toISOString(),
    note: 'First piece at 05:59:46, first assignment at 05:53:43. Slider starts at 07:00:00 (lookback: 06:00-07:00)'
  });
  
  return { from, to };
}

async function getJSON(url) {
  const token = localStorage.getItem('token');
  const headers = {
    'Content-Type': 'application/json',
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  
  const res = await fetch(url, { 
    credentials: "include",
    headers 
  });
  if (!res.ok) throw new Error(`${url} → ${res.status} ${res.statusText}`);
  return res.json();
}

// Persistent color tracking - keeps colors stable based on slot/position
// Maps gate to slot index to ensure consistent colors during transitions
let slotToColor = {}; // { slotIndex: colorIndex }

/**
 * Build color map based on Active Recipes positions (slots)
 * This ensures colors stay consistent even when recipe names change during transitions
 * 
 * @param {Array} activeRecipes - Array from backend { recipeName, gates } 
 * @param {Object} transitionStartRecipes - Map of gate -> { recipeName } for transitioning gates
 * @param {Array} recipeNames - List of recipe names currently visible (from SSE legend)
 * @param {Array} PALETTE - Color palette
 * @param {String} totalColor - Color for Total
 */
function buildColorMap(recipeNames, PALETTE, totalColor, activeRecipes = [], transitionStartRecipes = {}, programStartRecipes = [], completedTransitionGates = []) {
  const map = {};
  const hasTransitioning = Object.keys(transitionStartRecipes).length > 0;
  const completedGatesSet = new Set(completedTransitionGates);
  
  // DURING TRANSITIONS: Use programStartRecipes for ALL color assignments
  // This freezes colors so nothing shifts until transitions complete
  if (hasTransitioning && programStartRecipes.length > 0) {
    // Build gate -> slot mapping from programStartRecipes
    const gateToSlot = {};
    programStartRecipes.forEach((recipe, slotIndex) => {
      (recipe.gates || []).forEach(gate => {
        gateToSlot[gate] = slotIndex;
      });
    });
    
    // Assign colors based on programStartRecipes positions (frozen)
    // BUT skip recipes that are no longer active AND all their gates have completed transitioning
    programStartRecipes.forEach((recipe, slotIndex) => {
      const isStillActive = activeRecipes.some(r => r.recipeName === recipe.recipeName);
      const recipeGates = recipe.gates || [];
      const allGatesCompleted = recipeGates.length > 0 && recipeGates.every(g => completedGatesSet.has(g));
      
      // Skip old recipes whose gates have all completed (remove from legend)
      if (!isStillActive && allGatesCompleted) {
        // Don't add to map - this removes it from the legend
        return;
      }
      
      const color = PALETTE[slotIndex % PALETTE.length];
      map[recipe.recipeName] = color;
      slotToColor[slotIndex] = color;
    });
    
    // For EDITED recipes (new name, same gates), inherit the slot's color
    // This ensures 100_300 (replacing 100_175) gets purple, not a new color
    activeRecipes.forEach((recipe) => {
      if (!map[recipe.recipeName]) {
        // Find which slot this recipe belongs to based on its gates
        const recipeGates = recipe.gates || [];
        let inheritedSlot = -1;
        for (const gate of recipeGates) {
          if (gateToSlot[gate] !== undefined) {
            inheritedSlot = gateToSlot[gate];
            break;
          }
        }
        
        if (inheritedSlot >= 0) {
          // Inherit the color from the slot it replaced
          map[recipe.recipeName] = PALETTE[inheritedSlot % PALETTE.length];
        } else {
          // Truly new recipe (added to empty gates) - assign next available color
          const nextSlot = programStartRecipes.length + Object.keys(map).filter(k => k !== "Total").length;
          map[recipe.recipeName] = PALETTE[nextSlot % PALETTE.length];
        }
      }
    });
  } else {
    // NO TRANSITIONS: Use activeRecipes positions
    activeRecipes.forEach((recipe, slotIndex) => {
      const color = PALETTE[slotIndex % PALETTE.length];
      map[recipe.recipeName] = color;
      slotToColor[slotIndex] = color;
    });
  }
  
  // For any recipe names in recipeNames that don't have a color yet
  recipeNames.forEach((recipeName, idx) => {
    if (!map[recipeName]) {
      map[recipeName] = PALETTE[idx % PALETTE.length];
    }
  });
  
  // Add "Total" if there are any recipes
  if (recipeNames.length > 0 || activeRecipes.length > 0 || hasTransitioning) {
    map["Total"] = totalColor;
  }
  
  return map;
}

/** Utility: build a sorted list of ISO timestamps from combined totals */
function buildTimelineFromCombined(m3Combined) {
  const tl = (m3Combined || []).map(r => r.t);
  tl.sort((a, b) => new Date(a) - new Date(b));
  return tl;
}

/** Nivo adapters (always produce {x,y}) */
function toThroughputSeries({ m3ByRecipe, m3Combined, colorMap, xTicks }) {
  const series = [];
  // per recipe
  Object.entries(m3ByRecipe || {}).forEach(([recipe, rows]) => {
    const byTs = new Map((rows || []).map(r => [r.t, Number(r.batches_min || 0)]));
    series.push({
      id: recipe,
      color: colorMap[recipe] || "#888",
      data: (xTicks || []).map(t => ({ x: t, y: byTs.get(t) ?? 0 })),
    });
  });
  // total (only if Total exists in colorMap)
  const total = [];
  if (colorMap["Total"]) {
    const totalByTs = new Map((m3Combined || []).map(r => [r.t, Number(r.batches_min || 0)]));
    total.push({
      id: "Total",
      color: colorMap["Total"],
      data: (xTicks || []).map(t => ({ x: t, y: totalByTs.get(t) ?? 0 })),
    });
  }
  return { series, total };
}

function toGiveawaySeries({ m3ByRecipe, m3Combined, colorMap, xTicks }) {
  const series = [];
  Object.entries(m3ByRecipe || {}).forEach(([recipe, rows]) => {
    const byTs = new Map((rows || []).map(r => [r.t, Number(r.giveaway_pct || 0)]));
    series.push({
      id: recipe,
      color: colorMap[recipe] || "#888",
      data: (xTicks || []).map(t => ({ x: t, y: byTs.get(t) ?? 0 })),
    });
  });
  // total (only if Total exists in colorMap)
  const total = [];
  if (colorMap["Total"]) {
    const totalByTs = new Map((m3Combined || []).map(r => [r.t, Number(r.giveaway_pct || 0)]));
    total.push({
      id: "Total",
      color: colorMap["Total"],
      data: (xTicks || []).map(t => ({ x: t, y: totalByTs.get(t) ?? 0 })),
    });
  }
  return { series, total };
}

function toPiecesProcessedSeries({ m3ByRecipe, m3Combined, colorMap, xTicks }) {
  const series = [];
  Object.entries(m3ByRecipe || {}).forEach(([recipe, rows]) => {
    const byTs = new Map((rows || []).map(r => [r.t, Number(r.pieces_processed || 0)]));
    series.push({
      id: recipe,
      color: colorMap[recipe] || "#888",
      data: (xTicks || []).map(t => ({ x: t, y: byTs.get(t) ?? 0 })),
    });
  });
  // total (only if Total exists in colorMap)
  const total = [];
  if (colorMap["Total"]) {
    const totalByTs = new Map((m3Combined || []).map(r => [r.t, Number(r.pieces_processed || 0)]));
    total.push({
      id: "Total",
      color: colorMap["Total"],
      data: (xTicks || []).map(t => ({ x: t, y: totalByTs.get(t) ?? 0 })),
    });
  }
  return { series, total };
}

function toWeightProcessedSeries({ m3ByRecipe, m3Combined, colorMap, xTicks }) {
  const series = [];
  Object.entries(m3ByRecipe || {}).forEach(([recipe, rows]) => {
    const byTs = new Map((rows || []).map(r => [r.t, Number(r.weight_processed_g || 0) / 1000])); // Convert g to kg
    series.push({
      id: recipe,
      color: colorMap[recipe] || "#888",
      data: (xTicks || []).map(t => ({ x: t, y: byTs.get(t) ?? 0 })),
    });
  });
  // total (only if Total exists in colorMap)
  const total = [];
  if (colorMap["Total"]) {
    const totalByTs = new Map((m3Combined || []).map(r => [r.t, Number(r.weight_processed_g || 0) / 1000])); // Convert g to kg
    total.push({
      id: "Total",
      color: colorMap["Total"],
      data: (xTicks || []).map(t => ({ x: t, y: totalByTs.get(t) ?? 0 })),
    });
  }
  return { series, total };
}

function toRejectsSeries({ m3Combined, color }) {
  const byTs = (m3Combined || []).map(r => ({ 
    x: r.t, 
    y: Number(r.rejects_per_min || 0),
    total_rejects_count: Number(r.total_rejects_count || 0),
    total_rejects_weight_g: Number(r.total_rejects_weight_g || 0)
  }));
  // Only return Total series if color is provided (indicating active recipes)
  return color ? [{ id: "Total", color, data: byTs }] : [];
}

/** 👉 UPDATED: include id & alpha; x is numeric ms */
function toScatterSeries(m1Recent) {
  return [{
    id: "Pieces",
    data: (m1Recent || []).map(p => ({
      x: p.t ?? p.x, // p.t is numeric ms now
      y: Number(p.weight_g ?? p.y ?? 0),
      id: p.id ?? `${p.t}-${p.weight_g}`, // stable id
      alpha: p.alpha ?? 1, // fading support
    }))
  }];
}

function toPieSlices(m4Breakdown, colorMap) {
  const safe = (n) => (Number.isFinite(Number(n)) ? Number(n) : 0);
  
  // m4Breakdown can be either array of recipe objects or a single object
  const breakdown = Array.isArray(m4Breakdown) ? m4Breakdown : (m4Breakdown ? [m4Breakdown] : []);
  
  const total = breakdown.map(r => ({
    id: r.recipe || 'Unknown', 
    value: safe(r.total_batches), 
    color: colorMap[r.recipe] || "#888",
  }));
  const give_g = breakdown.map(r => ({
    id: r.recipe || 'Unknown', 
    value: safe(r.giveaway_g_per_batch), 
    color: colorMap[r.recipe] || "#888",
  }));
  const give_pct = breakdown.map(r => ({
    id: r.recipe || 'Unknown', 
    value: safe(r.giveaway_pct_avg), 
    color: colorMap[r.recipe] || "#888",
  }));
  return { total, give_g, give_pct };
}

export function useDashboardData() {
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState(null); // null = not configured yet
  const [configError, setConfigError] = useState(null);

  // Initialize theme colors (can use hooks inside this function component)
  const theme = useTheme();
  const colors = tokens(theme.palette.mode);
  
  // Memoize colors to prevent recalculation on every render
  const PALETTE = useMemo(() => [
    colors.tealAccent[500], 
    colors.orangeAccent[500],
    colors.purpleAccent[500], 
    colors.redAccent[500], 
    colors.tealAccent[300], 
    colors.orangeAccent[300],
    colors.purpleAccent[300], 
    colors.redAccent[300], 
  ], [colors]);
  
  const TOTAL_COLOR = useMemo(() => colors.beigeAccent[400], [colors]);

  // Replay date range (entire dataset bounds)
  const [datasetStart, setDatasetStart] = useState(null);
  const [datasetEnd, setDatasetEnd] = useState(null);
  
  // Current time cursor (milliseconds since epoch)
  const [currentTime, setCurrentTime] = useState(null);
  
  // Windowed data (only WINDOW_MIN minutes worth)
  const [xTicks, setXTicks] = useState([]);
  const [m3ByRecipe, setM3ByRecipe] = useState({});
  const [m3Combined, setM3Combined] = useState([]);
  const [m1Recent, setM1Recent] = useState([]);
  const [m4Breakdown, setM4Breakdown] = useState([]);

  // Snapshot bits
  const [assignmentsByGate, setAssignmentsByGate] = useState({});
  const [overlayByGate, setOverlayByGate] = useState({});
  const [colorMap, setColorMap] = useState({});

  // Track if we're currently fetching to avoid overlapping requests
  const fetchingRef = useRef(false);
  
  // Track last fetch time to throttle requests (fetch every 5 minutes instead of every minute)
  const lastFetchTimeRef = useRef(null);

  // LIVE scatter reservoir + persistence
  const reservoirRef = useRef(null);
  const lastPersistRef = useRef(0);
  
  // Track current program start time for filtering reject data
  // Use both state (for useMemo dependency) and ref (for immediate access in callbacks)
  const [programStartTime, setProgramStartTime] = useState(null);
  const programStartTimeRef = useRef(null);

  // ---------- Fetch runtime configuration ----------
  useEffect(() => {
    let aborted = false;
    let pollInterval;
    
    const fetchConfig = async () => {
      try {
        const config = await getJSON('/api/config/mode');
        if (aborted) return;
        
        setMode(config.mode);
        setConfigError(null);
        console.log('Runtime config loaded:', config);
      } catch (err) {
        if (aborted) return;
        
        // 404 means no config set yet - this is expected on first load
        if (err.message.includes('404')) {
          setConfigError('waiting');
          console.log('Waiting for configuration... Run start_replay_mode.sh or start_live_mode_simple.sh');
        } else {
          setConfigError(err.message);
          console.error('Failed to load config:', err);
        }
      }
    };
    
    // Initial fetch
    fetchConfig();
    
    // Poll every 2 seconds if no config yet
    pollInterval = setInterval(() => {
      if (mode === null) {
        fetchConfig();
      }
    }, 2000);
    
    return () => {
      aborted = true;
      clearInterval(pollInterval);
    };
  }, [mode]);

  // ---------- Initialize: detect dataset bounds ----------
  useEffect(() => {
    // Wait for config to be loaded
    if (mode === null) return;
    
    let aborted = false;
    (async () => {
      try {
        setLoading(true);
        
        if (mode === "replay") {
          const range = await detectDateRange();
          if (aborted) return;
          
          setDatasetStart(range.from);
          setDatasetEnd(range.to);
          setCurrentTime(range.from.getTime()); // Start at beginning
          
          console.log('📅 Dataset range detected:', {
            start: range.from.toISOString(),
            end: range.to.toISOString(),
            durationHours: (range.to - range.from) / (1000 * 60 * 60)
          });
          console.log('⏰ Initial currentTime set to:', new Date(range.from.getTime()).toISOString());
        } else {
          // Live mode: start at current time
          const now = new Date();
          setCurrentTime(now.getTime());
          console.log('⏰ Live mode: currentTime set to:', now.toISOString());
          
          // init sticky live reservoir and hydrate persisted points
          if (!reservoirRef.current) {
            reservoirRef.current = new StickyMinuteReservoir({ 
              horizonMs: HORIZON_MS, 
              fadeMs: FADE_WINDOW_MS,
              bucketIntervalMs: BUCKET_INTERVAL_MS
            });
            reservoirRef.current.hydrateFromStorage(Date.now());
          }
        }
      } catch (err) {
        console.error("Failed to initialize dashboard:", err);
      } finally {
        if (!aborted) setLoading(false);
      }
    })();
    return () => { aborted = true; };
  }, [mode]);

  // ---------- Fetch data window around currentTime ----------
  useEffect(() => {
    if (currentTime === null || fetchingRef.current || mode === null) return;
    
    // Throttle: only in REPLAY mode (not in live mode where we want fresh data)
    if (mode === "replay") {
      const throttleMs = FETCH_THROTTLE_MIN * 60 * 1000;
      if (lastFetchTimeRef.current !== null && 
          Math.abs(currentTime - lastFetchTimeRef.current) < throttleMs) {
        return; // Skip fetch in replay, not enough time has passed
      }
    }
    
    let aborted = false;
    fetchingRef.current = true;
    lastFetchTimeRef.current = currentTime;
    
    (async () => {
      try {
        // Calculate window: WINDOW_MIN minutes ending at currentTime
        const windowMs = WINDOW_MIN * 60 * 1000;
        const to = new Date(currentTime);
        const from = new Date(currentTime - windowMs);
        
        const bucketStr = `${BUCKET_SEC}s`;

        // Use combined M3 endpoint to reduce API calls from 8 to 5
        const [m3Data, rejectsData, piesData, m1Data, overlayData] = await Promise.all([
          getJSON(API.m3All(from.toISOString(), to.toISOString(), bucketStr)),
          getJSON(API.rejects(from.toISOString(), to.toISOString(), bucketStr)),
          getJSON(API.pies(from.toISOString(), to.toISOString())),
          getJSON(API.weights(from.toISOString(), to.toISOString())),
          getJSON(API.overlay(to.toISOString(), 60)),
        ]);
        
        // Extract data from combined response
        const throughputData = m3Data.throughput;
        const giveawayData = m3Data.giveaway;
        const piecesProcessedData = m3Data.piecesProcessed;
        const weightProcessedData = m3Data.weightProcessed;
        
        if (aborted) return;

        // Build timeline from throughput total data
        const tl = buildTimelineFromCombined(throughputData?.total || []);
        setXTicks(tl);

        // Convert history API format to internal format
        const m3ByRecipe = {};
        Object.entries(throughputData?.perRecipe || {}).forEach(([recipe, rows]) => {
          const giveawayRows = giveawayData?.perRecipe?.[recipe] || [];
          const piecesProcessedRows = piecesProcessedData?.perRecipe?.[recipe] || [];
          const weightProcessedRows = weightProcessedData?.perRecipe?.[recipe] || [];
          const gMap = new Map(giveawayRows.map(r => [r.t, r.v]));
          const pMap = new Map(piecesProcessedRows.map(r => [r.t, r.v]));
          const wMap = new Map(weightProcessedRows.map(r => [r.t, r.v]));
          
          m3ByRecipe[recipe] = rows.map(r => ({
            t: r.t,
            batches_min: r.v,
            giveaway_pct: gMap.get(r.t) || 0,
            pieces_processed: pMap.get(r.t) || 0,
            weight_processed_g: wMap.get(r.t) || 0
          }));
        });
        setM3ByRecipe(m3ByRecipe);

        // Build combined data, filtering rejects based on program start time
        const combinedData = (throughputData?.total || []).map(r => {
          const giveawayRow = (giveawayData?.total || []).find(g => g.t === r.t);
          const piecesProcessedRow = (piecesProcessedData?.total || []).find(p => p.t === r.t);
          const weightProcessedRow = (weightProcessedData?.total || []).find(w => w.t === r.t);
          const rejectsRow = (rejectsData || []).find(re => re.t === r.t);
          
          // Filter rejects: zero out data from before current program start (live mode only)
          let rejectsPerMin = rejectsRow?.v || 0;
          let totalRejectsCount = rejectsRow?.total_rejects_count || 0;
          let totalRejectsWeightG = rejectsRow?.total_rejects_weight_g || 0;
          
          if (mode === 'live' && programStartTimeRef.current) {
            const itemTime = typeof r.t === 'number' ? r.t : new Date(r.t).getTime();
            if (itemTime < programStartTimeRef.current) {
              // Data from before current program - zero out rejects
              rejectsPerMin = 0;
              totalRejectsCount = 0;
              totalRejectsWeightG = 0;
            }
          }
          
          return {
            t: r.t,
            batches_min: r.v || 0,
            giveaway_pct: giveawayRow?.v || 0,
            pieces_processed: piecesProcessedRow?.v || 0,
            weight_processed_g: weightProcessedRow?.v || 0,
            rejects_per_min: rejectsPerMin,
            total_rejects_count: totalRejectsCount,
            total_rejects_weight_g: totalRejectsWeightG
          };
        });
        setM3Combined(combinedData);

        setM4Breakdown(piesData || []);

        // ---------- M1 scatter window seed ----------
        if (mode === "live") {
          // ---------- LIVE: Seed reservoir from window ----------
          const res = reservoirRef.current;
          if (res) {
            const seed = [];
            Object.values(m1Data || {}).forEach(list => {
              (list || []).forEach(p => seed.push({
                t: typeof p.t === 'number' ? p.t : Date.parse(p.t),
                weight_g: Number(p.weight_g || 0),
                id: p.piece_id ?? null,
                gate: Number(p.gate ?? 0),
              }));
            });
            seed
              .filter(p => Number.isFinite(p.t))
              .sort((a,b)=>a.t - b.t)
              .forEach(p => {
                res.pushWeightForStats(p.weight_g);
                res.addPoint({ id: p.id ?? `${p.t}-${p.gate}-${Math.round(p.weight_g*10)}`, t: p.t, weight_g: p.weight_g, gate: p.gate }, Date.now());
              });
          }
        } else {
          // ---------- REPLAY: keep existing scatter sampling code as-is ----------
          const scatter = [];
          Object.values(m1Data || {}).forEach(list => {
            (list || []).forEach(p => scatter.push({ t: p.t, weight_g: Number(p.weight_g || 0) }));
          });

          // Sample if too many points - preserve outliers
          let sampledScatter = scatter;
          const MAX_POINTS = 500;
          if (scatter.length > MAX_POINTS) {
            const outlierCount = Math.floor(MAX_POINTS * 0.2);
            const topCount = Math.floor(outlierCount / 2);
            const bottomCount = outlierCount - topCount;

            const sortedByWeight = [...scatter].sort((a, b) => a.weight_g - b.weight_g);
            const bottomOutliers = sortedByWeight.slice(0, bottomCount);
            const topOutliers = sortedByWeight.slice(-topCount);

            const outlierKey = new Set([...bottomOutliers, ...topOutliers].map(p => `${p.t}-${p.weight_g}`));
            const middlePoints = scatter.filter(p => !outlierKey.has(`${p.t}-${p.weight_g}`));

            const middleTarget = MAX_POINTS - outlierCount;
            const step = Math.max(1, Math.floor(middlePoints.length / middleTarget));
            const sampledMiddle = middlePoints.filter((_, i) => i % step === 0);

            sampledScatter = [...bottomOutliers, ...topOutliers, ...sampledMiddle];
          }

          // Sort by time for display/seed and convert to numeric ms
          const sampledScatterNumeric = sampledScatter
            .map(p => ({ t: typeof p.t === 'number' ? p.t : Date.parse(p.t), weight_g: p.weight_g }))
            .filter(p => Number.isFinite(p.t))
            .sort((a, b) => a.t - b.t);
          
          setM1Recent(sampledScatterNumeric);
        }
        // ---------- end M1 seed ----------

        // M2 overlay (pieces and grams per gate)
        const overlayMap = {};
        (overlayData || []).forEach(item => {
          overlayMap[item.gate] = { pieces: item.pieces, grams: item.grams };
        });
        setOverlayByGate(overlayMap);

        // Get assignments at current time
        const assigns = await getJSON(API.assignmentsAt(to.toISOString()));
        if (aborted) return;

        const assignMap = {};
        const assignmentsArray = assigns?.assignments || [];
        
        assignmentsArray.forEach(r => { 
          assignMap[Number(r.gate)] = r.recipe_name; 
        });
        setAssignmentsByGate(assignMap);

        // Extract unique recipes from SQLite assignments (SOURCE OF TRUTH)
        const activeRecipes = Array.from(new Set(Object.values(assignMap).filter(Boolean)));
        
        // Build color map - use merge strategy to preserve transitioning recipes
        const newColorMap = buildColorMap(activeRecipes, PALETTE, TOTAL_COLOR);
        setColorMap(prev => {
          // Merge: keep existing colors (including transitioning recipes), add/update new ones
          const merged = { ...prev, ...newColorMap };
          console.log('[DATA FETCH] colorMap update - prev keys:', Object.keys(prev), 'new keys:', Object.keys(newColorMap), 'merged keys:', Object.keys(merged));
          return merged;
        });
        
        // ========== FILTER M3 DATA ==========
        // Only show recipes that are in SQLite assignments
        const filteredM3 = {};
        activeRecipes.forEach(sqliteRecipe => {
          if (m3ByRecipe[sqliteRecipe]) {
            filteredM3[sqliteRecipe] = m3ByRecipe[sqliteRecipe];
          } else {
            // No data for this SQLite recipe in InfluxDB
            filteredM3[sqliteRecipe] = tl.map(t => ({ 
              t, 
              batches_min: 0, 
              giveaway_pct: 0,
              pieces_processed: 0,
              weight_processed_g: 0
            }));
          }
        });
        
        setM3ByRecipe(filteredM3);
        
        // ========== FILTER M4 DATA ==========
        // Only show recipes that are in SQLite assignments
        const filteredM4 = [];
        activeRecipes.forEach(sqliteRecipe => {
          const m4Match = (piesData || []).find(p => p.recipe === sqliteRecipe);
          if (m4Match) {
            filteredM4.push(m4Match);
          } else {
            // No data for this SQLite recipe in InfluxDB
            filteredM4.push({
              recipe: sqliteRecipe,
              total_batches: 0,
              giveaway_g_per_batch: 0,
              giveaway_pct_avg: 0
            });
          }
        });
        
        setM4Breakdown(filteredM4);
        
        console.log('✅ Data fetch complete:', {
          m3Recipes: Object.keys(filteredM3).length,
          m4Items: filteredM4.length,
          m1Points: mode === "live" ? (reservoirRef.current?.totalCore + reservoirRef.current?.totalOutliers || 0) : 'seeded',
          xTicks: tl.length,
          overlayGates: Object.keys(overlayMap).length,
          assignments: Object.keys(assignMap).length
        });
      } catch (err) {
        console.error("❌ Failed to fetch data window:", err);
      } finally {
        if (!aborted) fetchingRef.current = false;
      }
    })();
    
    return () => { aborted = true; fetchingRef.current = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTime, mode]);

  // ---------- REPLAY: advance time cursor ----------
  useEffect(() => {
    if (mode !== "replay" || currentTime === null || datasetStart === null || datasetEnd === null) return;
    
    let live = true;
    const stepMs = 1000; // advance every second
    const advanceMs = REPLAY_SPEED * 60 * 1000; // advance by REPLAY_SPEED minutes each step
    
    const iv = setInterval(() => {
      if (!live) return;
      setCurrentTime(prev => {
        const next = prev + advanceMs;
        // Loop back to start if we exceed dataset end
        if (next > datasetEnd.getTime()) {
          console.log('Reached end of dataset, looping back to start');
          return datasetStart.getTime();
        }
        // Removed debug logging to reduce console noise
        return next;
      });
    }, stepMs);
    
    return () => { live = false; clearInterval(iv); };
  }, [currentTime, datasetStart, datasetEnd, mode]);

  // ---------- LIVE SSE ----------
  useEffect(() => {
    if (mode !== "live") return;

    // Ensure reservoir exists (live)
    if (!reservoirRef.current) {
      reservoirRef.current = new StickyMinuteReservoir({ 
        horizonMs: HORIZON_MS, 
        fadeMs: FADE_WINDOW_MS,
        bucketIntervalMs: BUCKET_INTERVAL_MS
      });
      reservoirRef.current.hydrateFromStorage(Date.now());
    }
    const res = reservoirRef.current;

    const es = new EventSource(API.sse(), { withCredentials: true });

    const onTick = async (ev) => {
      try {
        const { 
          ts, legend, overlay, programId, 
          programStartTime: tickProgramStartTime, 
          machineState: tickMachineState,
          activeRecipes: tickActiveRecipes,
          transitionStartRecipes: tickTransitionStartRecipes,
          programStartRecipes: tickProgramStartRecipes,
          completedTransitionGates: tickCompletedTransitionGates,
        } = JSON.parse(ev.data);
        const to = new Date(ts);
        
        // Update program start time from tick (in case we missed program_change event)
        // Only update if running and we have a valid programStartTime
        if (tickMachineState === 'running' && tickProgramStartTime) {
          const newStartTime = new Date(tickProgramStartTime).getTime();
          // Only update if different from current (to avoid unnecessary re-renders)
          if (newStartTime !== programStartTimeRef.current) {
            console.log(`📋 [TICK] Updating programStartTime from tick: ${tickProgramStartTime} (programId: ${programId})`);
            programStartTimeRef.current = newStartTime;
            setProgramStartTime(newStartTime);
          }
        } else if (tickMachineState === 'idle' || tickMachineState === 'paused') {
          // Clear program start time if not running
          if (programStartTimeRef.current !== null) {
            console.log(`📋 [TICK] Clearing programStartTime (machine state: ${tickMachineState})`);
            programStartTimeRef.current = null;
            setProgramStartTime(null);
          }
        }
        
        // Update current time every 60 seconds only (for M3/M4 charts)
        const now = Date.now();
        if (!lastFetchTimeRef.current || now - lastFetchTimeRef.current > 60000) {
          setCurrentTime(to.getTime());
          lastFetchTimeRef.current = now;
        }
        
        // Update gate assignments from legend
        const assignMap = {};
        (legend || []).forEach(a => {
          assignMap[Number(a.gate)] = a.recipe_name || '—';
        });
        setAssignmentsByGate(assignMap);
        
        // IMPORTANT: Build colorMap from activeRecipes (NEW recipes) for chart legend
        // This ensures charts show NEW recipe names even during transition
        // Gate annotations will show OLD recipe (from assignMap/legend)
        const newRecipeNames = (tickActiveRecipes || []).map(r => r.recipeName).filter(Boolean);
        const hasTransitioning = Object.keys(tickTransitionStartRecipes || {}).length > 0;
        
        // Build colorMap if there are active recipes OR transitioning recipes
        if (newRecipeNames.length > 0 || hasTransitioning) {
          // Use activeRecipes for colorMap - these are the NEW recipes
          // buildColorMap also adds transitioning recipes from transitionStartRecipes
          const newColorMap = buildColorMap(newRecipeNames, PALETTE, TOTAL_COLOR, tickActiveRecipes || [], tickTransitionStartRecipes || {}, tickProgramStartRecipes || [], tickCompletedTransitionGates || []);
          console.log('[SSE TICK] colorMap update - newRecipes:', newRecipeNames, 'newColorMap keys:', Object.keys(newColorMap));
          setColorMap(prev => {
            // Merge: keep existing colors, add/update new ones
            const merged = { ...prev };
            Object.entries(newColorMap).forEach(([key, color]) => {
              merged[key] = color;
            });
            // Remove old recipes that are no longer in newColorMap
            // buildColorMap now handles filtering out completed transition recipes
            Object.keys(merged).forEach(key => {
              if (key !== "Total" && !newColorMap[key]) {
                delete merged[key];
              }
            });
            console.log('[SSE TICK] colorMap merged - transitioning:', hasTransitioning, 'keys:', Object.keys(merged));
            return merged;
          });
        }
        
        // Use overlay from SSE (real-time M2 data)
        const overMap = {};
        (overlay || []).forEach(r => { overMap[Number(r.gate)] = {
          pieces: Number(r.pieces || 0), grams: Number(r.grams || 0)
        };});
        setOverlayByGate(overMap);
      } catch (e) {
        console.error("SSE tick handling failed:", e);
      }
    };

    es.addEventListener("tick", onTick);

    // Fire scatter point into reservoir (no direct setState)
    const onPiece = (ev) => {
      try {
        const d = JSON.parse(ev.data); // { piece_id, gate, weight_g, ts }
        const t = new Date(d.ts).getTime(); // use numeric ms for xScale: 'linear'
        const w = Number(d.weight_g);
        const id = d.piece_id ?? `${t}-${d.gate ?? ''}-${Math.round(w*10)}`;
        if (res) {
          res.pushWeightForStats(w);
          res.addPoint({ id, t, weight_g: w, gate: Number(d.gate ?? 0) }, Date.now());
        }
      } catch (e) {
        console.error("SSE piece handling failed:", e);
      }
    };
    es.addEventListener("piece", onPiece);

    // increment a single gate in the overlay (2→3→4→…)
    const onGate = (ev) => {
      try {
        const d = JSON.parse(ev.data); // { gate, pieces, grams, ts }
        setOverlayByGate((prev) => ({
          ...prev,
          [Number(d.gate)]: { pieces: Number(d.pieces || 0), grams: Number(d.grams || 0) },
        }));
      } catch (e) {
        console.error("SSE gate handling failed:", e);
      }
    };
    es.addEventListener("gate", onGate);

    // full overlay snapshot (for immediate consistency after resets)
    const onOverlay = (ev) => {
      try {
        const d = JSON.parse(ev.data); // { ts, overlay: [{ gate, pieces, grams }, ...] }
        if (Array.isArray(d.overlay)) {
          const overMap = {};
          d.overlay.forEach(item => {
            overMap[Number(item.gate)] = {
              pieces: Number(item.pieces || 0),
              grams: Number(item.grams || 0)
            };
          });
          setOverlayByGate(overMap);
          console.log("📸 [OVERLAY SNAPSHOT] Applied full overlay:", overMap);
        }
      } catch (e) {
        console.error("SSE overlay handling failed:", e);
      }
    };
    es.addEventListener("overlay", onOverlay);

    // Program change event: track program start time
    const onProgramChange = (ev) => {
      try {
        const d = JSON.parse(ev.data); // { action: 'start'|'stop'|'recipe_change', programId?, ts }
        console.log(`📋 [PROGRAM CHANGE] Received event:`, d);
        
        if (d.action === 'start' || d.action === 'recipe_change') {
          // New program starting - track its start time
          const startTs = new Date(d.ts).getTime();
          console.log(`📋 [PROGRAM CHANGE] Setting programStartTime to ${startTs} (${new Date(startTs).toISOString()})`);
          programStartTimeRef.current = startTs;  // Update ref immediately
          setProgramStartTime(startTs);  // Update state for re-render
          
          // NOTE: Don't clear chart data here!
          // The colorMap is built from activeRecipes (new recipes), so:
          // - Old recipe data stays in M3ByRecipe but won't be shown (not in colorMap)
          // - New recipes will naturally appear as data flows in
          // This keeps graphs stable and only shows data for currently active recipes
        } else if (d.action === 'stop') {
          // Program stopped - clear the start time (no active program)
          console.log(`📋 [PROGRAM CHANGE] Clearing programStartTime (was: ${programStartTimeRef.current})`);
          programStartTimeRef.current = null;  // Update ref immediately
          setProgramStartTime(null);  // Update state for re-render
        }
        
        // Reset rejects to 0 (new program = new reject tracking)
        setM3Combined(prev => prev.map(item => ({
          ...item,
          rejects_per_min: 0,
          total_rejects_count: 0,
          total_rejects_weight_g: 0
        })));
      } catch (e) {
        console.error("SSE program_change handling failed:", e);
      }
    };
    es.addEventListener("program_change", onProgramChange);

    // Smooth renderer: flush reservoir → React state every 250 ms + persist ~1s
    const flushTimer = setInterval(() => {
      const now = Date.now();
      if (res) {
        setM1Recent(res.snapshot(now)); // [{t, weight_g, alpha, ...}]
        if (now - lastPersistRef.current > 1000) {
          res.persistToStorage(now);
          lastPersistRef.current = now;
        }
      }
    }, 250);

    // Keep outlier thresholds fresh
    const qTimer = setInterval(() => {
      res?.recomputeQuantiles();
    }, 1000);

    es.onerror = (e) => console.warn("SSE error", e);
    return () => {
      es.removeEventListener("tick", onTick);
      es.removeEventListener("piece", onPiece);
      es.removeEventListener("gate", onGate);
      es.removeEventListener("overlay", onOverlay);
      es.removeEventListener("program_change", onProgramChange);
      es.close();
      clearInterval(flushTimer);
      clearInterval(qTimer);
    };
  }, [mode]);

  // ---------- computed, Nivo-ready ----------
  const throughput = useMemo(
    () => toThroughputSeries({ m3ByRecipe, m3Combined, colorMap, xTicks }),
    [m3ByRecipe, m3Combined, colorMap, xTicks]
  );
  const giveaway = useMemo(
    () => toGiveawaySeries({ m3ByRecipe, m3Combined, colorMap, xTicks }),
    [m3ByRecipe, m3Combined, colorMap, xTicks]
  );
  const piecesProcessed = useMemo(
    () => toPiecesProcessedSeries({ m3ByRecipe, m3Combined, colorMap, xTicks }),
    [m3ByRecipe, m3Combined, colorMap, xTicks]
  );
  const weightProcessed = useMemo(
    () => toWeightProcessedSeries({ m3ByRecipe, m3Combined, colorMap, xTicks }),
    [m3ByRecipe, m3Combined, colorMap, xTicks]
  );
  const rejects = useMemo(() => {
    // Reject data is already filtered at fetch time (when storing in m3Combined)
    // This useMemo just converts to Nivo format
    // Additional filtering here as a safety net in case data wasn't filtered at fetch time
    let filteredM3 = m3Combined;
    
    if (mode === 'live' && programStartTime) {
      filteredM3 = m3Combined.map(item => {
        const itemTime = typeof item.t === 'number' ? item.t : new Date(item.t).getTime();
        if (itemTime < programStartTime) {
          return {
            ...item,
            rejects_per_min: 0,
            total_rejects_count: 0,
            total_rejects_weight_g: 0
          };
        }
        return item;
      });
    }
    
    return toRejectsSeries({ m3Combined: filteredM3, color: colorMap["Total"] });
  }, [m3Combined, colorMap, programStartTime, mode]);
  const scatter = useMemo(() => toScatterSeries(m1Recent), [m1Recent]);
  const pies = useMemo(() => toPieSlices(m4Breakdown, colorMap), [m4Breakdown, colorMap]);

  return {
    mode,                     // "replay" | "live" | null (not configured)
    configError,              // error message if config failed to load
    loading,
    // legend & overlays
    colorMap,                 // { recipe -> color, Total -> color }
    assignmentsByGate,        // { gate: recipe_name }
    overlayByGate,            // { gate: { pieces, grams } }
    // chart data
    xTicks,                   // array of ISO timestamps used on X axis
    throughput,               // { series: [...], total: [...] }
    giveaway,                 // { series: [...], total: [...] }
    piecesProcessed,          // { series: [...], total: [...] }
    weightProcessed,          // { series: [...], total: [...] }
    rejects,                  // [{ id:'Total', color, data:[{x,y}]}]
    scatter,                  // [{ id: 'Pieces', data:[{x,y,id,alpha}]}]
    pies,                     // { total:[...], give_g:[...], give_pct:[...] }
    // replay controls
    currentTime,              // current cursor position (milliseconds)
    datasetStart,             // dataset start time (Date object)
    datasetEnd,               // dataset end time (Date object)
    setCurrentTime,           // function to jump to a specific time
  };
}