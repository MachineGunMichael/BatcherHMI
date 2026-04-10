// src/scenes/dashboard/dataProvider.js
import { useEffect, useMemo, useState, useRef } from "react";
import { tokens } from "../../theme";
import {useTheme} from "@mui/material";
import { isPageVisible, bumpSseEvent } from "../../utils/renderMonitor";

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
  piesCumulative: `/api/history/pies-cumulative`,
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
  const slotToColor = {};
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
        
        // For incoming recipes from queue (batch limit transition) with no gates yet,
        // find the finishing recipe and inherit its slot color
        if (inheritedSlot < 0 && recipe._isIncomingFromQueue) {
          const finishingRecipe = activeRecipes.find(r => 
            r.batchLimitTransitioning || r.isFinishing
          );
          if (finishingRecipe) {
            const finishingSlot = programStartRecipes.findIndex(p => 
              p.recipeName === finishingRecipe.recipeName
            );
            if (finishingSlot >= 0) {
              inheritedSlot = finishingSlot;
            }
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

function toPieSlices(m4Breakdown, colorMap, liveActiveRecipes) {
  const safe = (n) => (Number.isFinite(Number(n)) ? Number(n) : 0);
  
  const giveawayMap = {};
  const breakdown = Array.isArray(m4Breakdown) ? m4Breakdown : (m4Breakdown ? [m4Breakdown] : []);
  breakdown.forEach(r => { giveawayMap[r.recipe] = r; });

  const recipes = liveActiveRecipes && liveActiveRecipes.length > 0
    ? liveActiveRecipes
    : breakdown.map(r => ({ recipeName: r.recipe, completedBatches: r.total_batches }));

  const total = recipes.map(r => {
    const apiData = giveawayMap[r.recipeName];
    return {
      id: r.recipeName,
      value: safe(apiData?.total_batches ?? r.completedBatches),
      color: colorMap[r.recipeName] || "#888",
    };
  });
  const give_g = recipes.map(r => {
    const ga = giveawayMap[r.recipeName];
    return { id: r.recipeName, value: safe(ga?.giveaway_g_per_batch), color: colorMap[r.recipeName] || "#888" };
  });
  const give_pct = recipes.map(r => {
    const ga = giveawayMap[r.recipeName];
    return { id: r.recipeName, value: safe(ga?.giveaway_pct_avg), color: colorMap[r.recipeName] || "#888" };
  });
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
  const [liveActiveRecipes, setLiveActiveRecipes] = useState([]);

  // Snapshot bits
  const [assignmentsByGate, setAssignmentsByGate] = useState({});
  const [overlayByGate, setOverlayByGate] = useState({});
  const [colorMap, setColorMap] = useState({});
  const [hasBuffer, setHasBuffer] = useState(false);

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

  // Track current program ID for gate timing queries
  const [currentProgramId, setCurrentProgramId] = useState(null);
  const currentProgramIdRef = useRef(null);

  // Gate timing data (boxplots) - refreshed every ~60s
  const [gateTimingData, setGateTimingData] = useState({ dwell: [], ack: [], blocked: [] });

  // Ref for liveActiveRecipes (accessible in fetch effect without dependency)
  const liveActiveRecipesRef = useRef([]);

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
          // Live mode currentTime initialized
          
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
    if (!isPageVisible()) return; // skip fetch while tab is hidden
    
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

        // Use combined M3 endpoint to reduce API calls
        const [m3Data, rejectsData, m1Data, overlayData] = await Promise.all([
          getJSON(API.m3All(from.toISOString(), to.toISOString(), bucketStr)),
          getJSON(API.rejects(from.toISOString(), to.toISOString(), bucketStr)),
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
            setM1Recent(res.snapshot(Date.now()));
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

        // M2 overlay (pieces and grams per gate — now with main/buffer compartments)
        const overlayMap = {};
        (overlayData || []).forEach(item => {
          overlayMap[item.gate] = {
            main: item.main || { pieces: item.pieces || 0, grams: item.grams || 0 },
            buffer: item.buffer || { pieces: 0, grams: 0 },
            mainFull: item.mainFull || false,
            bufferFull: item.bufferFull || false,
            pieces: item.pieces || 0,
            grams: item.grams || 0,
          };
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
        const activeRecipeNames = Array.from(new Set(Object.values(assignMap).filter(Boolean)));
        
        // Use liveActiveRecipes from tick if available (has orderId, gates, etc.)
        const tickRecipes = liveActiveRecipesRef.current || [];
        const newColorMap = tickRecipes.length > 0
          ? buildColorMap(activeRecipeNames, PALETTE, TOTAL_COLOR, tickRecipes)
          : buildColorMap(activeRecipeNames, PALETTE, TOTAL_COLOR);
        setColorMap(prev => {
          const merged = { ...prev, ...newColorMap };
          return merged;
        });
        
        // M3 data: keep all recipes from the API (no filtering to assignments).
        // The chart rendering only shows recipes present in colorMap.
        // No need to override setM3ByRecipe — already set above (line ~727).

        // Fetch giveaway data from batch_completions, scoped by order_id when available
        if (activeRecipeNames.length > 0) {
          try {
            const tickRecipes = liveActiveRecipesRef.current || [];
            const orderLookup = {};
            tickRecipes.forEach(r => { if (r.orderId) orderLookup[r.recipeName] = r.orderId; });
            const recipeOrders = activeRecipeNames.map(name => ({
              recipe: name,
              ...(orderLookup[name] ? { orderId: orderLookup[name] } : {}),
            }));
            const token = localStorage.getItem('token');
            const postHeaders = { 'Content-Type': 'application/json' };
            if (token) postHeaders['Authorization'] = `Bearer ${token}`;
            const resp = await fetch(API.piesCumulative, {
              method: 'POST',
              headers: postHeaders,
              credentials: 'include',
              body: JSON.stringify({ recipeOrders }),
            });
            if (!resp.ok) throw new Error(`pies-cumulative → ${resp.status}`);
            const cumulativePies = await resp.json();
            if (!aborted) setM4Breakdown(cumulativePies || []);
          } catch (e) {
            console.warn('⚠️ Cumulative pies fetch failed:', e.message);
          }
        } else {
          setM4Breakdown([]);
        }

        // Fetch gate timing data for current program (boxplots)
        const pid = currentProgramIdRef.current;
        if (pid) {
          try {
            const [dwellData, ackData, blockedData] = await Promise.all([
              getJSON(`/api/stats/programs/${pid}/gate-dwell`),
              getJSON(`/api/stats/programs/${pid}/ack-times`),
              getJSON(`/api/stats/programs/${pid}/blocked-times`),
            ]);
            if (!aborted) {
              setGateTimingData({
                dwell: dwellData || [],
                ack: ackData || [],
                blocked: blockedData || [],
              });
            }
          } catch (e) {
            console.warn('⚠️ Gate timing fetch failed:', e.message);
          }
        }
        
        if (process.env.NODE_ENV !== 'production') {
          console.log('✅ Data fetch complete:',
            `{m3Recipes: ${Object.keys(m3ByRecipe).length}, m1Points: ${mode === "live" ? (reservoirRef.current?.totalCore + reservoirRef.current?.totalOutliers || 0) : 'seeded'}, xTicks: ${tl.length}, overlayGates: ${Object.keys(overlayMap).length}, assignments: ${Object.keys(assignMap).length}}`
          );
        }
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

    // Unified overlay buffer — both tick and gate SSE events write here;
    // flushed to React state at most every OVERLAY_FLUSH_MS to prevent
    // 10+ re-renders/second when pieces are weighed continuously.
    const pendingOverlayBuf = {};
    let overlayFlushTimer = null;
    const OVERLAY_FLUSH_MS = 100;

    const flushPendingOverlay = () => {
      overlayFlushTimer = null;
      const keys = Object.keys(pendingOverlayBuf);
      if (!keys.length) return;
      const snapshot = {};
      keys.forEach(k => { snapshot[k] = pendingOverlayBuf[k]; delete pendingOverlayBuf[k]; });
      setOverlayByGate(prev => {
        let changed = false;
        for (const [gate, data] of Object.entries(snapshot)) {
          const old = prev[gate];
          if (!old
            || (old.main?.pieces ?? old.pieces) !== (data.main?.pieces ?? data.pieces)
            || (old.main?.grams ?? old.grams) !== (data.main?.grams ?? data.grams)
            || (old.buffer?.pieces ?? 0) !== (data.buffer?.pieces ?? 0)
            || old.mainFull !== data.mainFull
            || old.bufferFull !== data.bufferFull) {
            changed = true;
            break;
          }
        }
        return changed ? { ...prev, ...snapshot } : prev;
      });
    };
    const scheduleOverlayFlush = () => {
      if (!isPageVisible()) return; // hidden → data accumulates, flushed on visibility change
      if (!overlayFlushTimer) {
        overlayFlushTimer = setTimeout(flushPendingOverlay, OVERLAY_FLUSH_MS);
      }
    };

    let es = new EventSource(API.sse(), { withCredentials: true });
    let lastTickAt = Date.now();
    const STALE_TIMEOUT = 5000;

    function removeListeners(source) {
      source.removeEventListener("tick", onTick);
      source.removeEventListener("piece", onPiece);
      source.removeEventListener("gate", onGate);
      source.removeEventListener("overlay", onOverlay);
      source.removeEventListener("program_change", onProgramChange);
    }
    function attachListeners(source) {
      source.addEventListener("tick", onTick);
      source.addEventListener("piece", onPiece);
      source.addEventListener("gate", onGate);
      source.addEventListener("overlay", onOverlay);
      source.addEventListener("program_change", onProgramChange);
      source.onerror = () => {};
    }

    const staleCheck = setInterval(() => {
      if (Date.now() - lastTickAt > STALE_TIMEOUT && es.readyState !== EventSource.CLOSED) {
        console.warn("SSE: no tick for 5s — forcing reconnect");
        removeListeners(es);
        es.close();
        es = new EventSource(API.sse(), { withCredentials: true });
        attachListeners(es);
        lastTickAt = Date.now();
      }
    }, STALE_TIMEOUT);

    const onTick = async (ev) => {
      lastTickAt = Date.now();
      bumpSseEvent();
      try {
        const { 
          ts, legend, overlay, programId, 
          programStartTime: tickProgramStartTime, 
          machineState: tickMachineState,
          hasBuffer: tickHasBuffer,
          activeRecipes: tickActiveRecipes,
          transitionStartRecipes: tickTransitionStartRecipes,
          programStartRecipes: tickProgramStartRecipes,
          completedTransitionGates: tickCompletedTransitionGates,
        } = JSON.parse(ev.data);

        // Always update refs (cheap, no React re-render)
        if (tickMachineState === 'running' && tickProgramStartTime) {
          programStartTimeRef.current = new Date(tickProgramStartTime).getTime();
        } else if (tickMachineState === 'idle' || tickMachineState === 'paused') {
          programStartTimeRef.current = null;
        }
        if (programId) currentProgramIdRef.current = programId;
        if (tickActiveRecipes && tickActiveRecipes.length > 0) {
          liveActiveRecipesRef.current = tickActiveRecipes;
        }

        // Buffer overlay data (cheap, no React re-render)
        if (overlay && overlay.length) {
          overlay.forEach(r => {
            const gateNum = Number(r.gate);
            pendingOverlayBuf[gateNum] = {
              main: r.main || { pieces: Number(r.pieces || 0), grams: Number(r.grams || 0) },
              buffer: r.buffer || { pieces: 0, grams: 0 },
              mainFull: r.mainFull || false,
              bufferFull: r.bufferFull || false,
              pieces: Number(r.pieces || 0),
              grams: Number(r.grams || 0),
            };
          });
        }

        // When tab is hidden: refs and buffers are up-to-date, skip all React state updates
        if (!isPageVisible()) return;

        const to = new Date(ts);

        setProgramStartTime(prev => prev === programStartTimeRef.current ? prev : programStartTimeRef.current);
        if (programId && programId !== currentProgramIdRef.current) {
          setCurrentProgramId(programId);
        }

        const now = Date.now();
        if (!lastFetchTimeRef.current || now - lastFetchTimeRef.current > 60000) {
          setCurrentTime(to.getTime());
          lastFetchTimeRef.current = now;
        }
        
        const assignMap = {};
        (legend || []).forEach(a => {
          assignMap[Number(a.gate)] = a.recipe_name || '—';
        });
        setAssignmentsByGate(prev => {
          const prevStr = JSON.stringify(prev);
          const newStr = JSON.stringify(assignMap);
          return prevStr === newStr ? prev : assignMap;
        });

        if (tickActiveRecipes && tickActiveRecipes.length > 0) {
          setLiveActiveRecipes(prev => {
            if (prev.length !== tickActiveRecipes.length) return tickActiveRecipes;
            const changed = tickActiveRecipes.some((r, i) =>
              r.recipeName !== prev[i]?.recipeName ||
              r.paused !== prev[i]?.paused
            );
            return changed ? tickActiveRecipes : prev;
          });
        }
        
        const tickRecipeNames = (tickActiveRecipes || []).map(r => r.recipeName).filter(Boolean);
        const legendRecipeNames = Object.values(assignMap).filter(v => v && v !== '—');
        const allKnownRecipes = Array.from(new Set([...tickRecipeNames, ...legendRecipeNames]));
        const hasTransitioning = Object.keys(tickTransitionStartRecipes || {}).length > 0;
        
        if (allKnownRecipes.length > 0 || hasTransitioning) {
          const newColorMap = buildColorMap(allKnownRecipes, PALETTE, TOTAL_COLOR, tickActiveRecipes || [], tickTransitionStartRecipes || {}, tickProgramStartRecipes || [], tickCompletedTransitionGates || []);
          setColorMap(prev => {
            const merged = { ...prev };
            Object.entries(newColorMap).forEach(([key, color]) => {
              merged[key] = color;
            });
            if (allKnownRecipes.length > 0) {
              const liveNames = new Set(allKnownRecipes);
              Object.keys(merged).forEach(key => {
                if (key !== "Total" && !liveNames.has(key) && !newColorMap[key]) {
                  delete merged[key];
                }
              });
            }
            if (!merged["Total"] && Object.keys(merged).length > 0) {
              merged["Total"] = TOTAL_COLOR;
            }
            const prevKeys = Object.keys(prev).sort().join(',');
            const mergedKeys = Object.keys(merged).sort().join(',');
            if (prevKeys === mergedKeys) {
              const changed = Object.keys(merged).some(k => merged[k] !== prev[k]);
              if (!changed) return prev;
            }
            return merged;
          });
        }
        
        scheduleOverlayFlush();
        
        if (typeof tickHasBuffer !== 'undefined') {
          setHasBuffer(prev => prev === !!tickHasBuffer ? prev : !!tickHasBuffer);
        }
      } catch (e) {
        console.error("SSE tick handling failed:", e);
      }
    };

    const onPiece = (ev) => {
      bumpSseEvent();
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
    const onGate = (ev) => {
      bumpSseEvent();
      try {
        const d = JSON.parse(ev.data);
        pendingOverlayBuf[Number(d.gate)] = {
          main: d.main || { pieces: Number(d.pieces || 0), grams: Number(d.grams || 0) },
          buffer: d.buffer || { pieces: 0, grams: 0 },
          mainFull: d.mainFull || false,
          bufferFull: d.bufferFull || false,
          pieces: Number(d.pieces || 0),
          grams: Number(d.grams || 0),
        };
        scheduleOverlayFlush();
      } catch (e) {
        console.error("SSE gate handling failed:", e);
      }
    };
    const onOverlay = (ev) => {
      bumpSseEvent();
      try {
        const d = JSON.parse(ev.data);
        if (Array.isArray(d.overlay)) {
          d.overlay.forEach(item => {
            pendingOverlayBuf[Number(item.gate)] = {
              main: item.main || { pieces: Number(item.pieces || 0), grams: Number(item.grams || 0) },
              buffer: item.buffer || { pieces: 0, grams: 0 },
              mainFull: item.mainFull || false,
              bufferFull: item.bufferFull || false,
              pieces: Number(item.pieces || 0),
              grams: Number(item.grams || 0),
            };
          });
          scheduleOverlayFlush();
        }
      } catch (e) {
        console.error("SSE overlay handling failed:", e);
      }
    };
    const onProgramChange = (ev) => {
      bumpSseEvent();
      try {
        const d = JSON.parse(ev.data);
        if (process.env.NODE_ENV === 'development') {
          console.log(`📋 [PROGRAM CHANGE] action=${d.action} programId=${d.programId}`);
        }
        
        if (d.action === 'start' || d.action === 'recipe_change') {
          const startTs = new Date(d.ts).getTime();
          programStartTimeRef.current = startTs;
          if (isPageVisible()) setProgramStartTime(startTs);
        } else if (d.action === 'stop') {
          programStartTimeRef.current = null;
          if (isPageVisible()) setProgramStartTime(null);
        }
      } catch (e) {
        console.error("SSE program_change handling failed:", e);
      }
    };
    attachListeners(es);

    // Smooth renderer: flush reservoir → React state every 5s + persist ~10s
    let lastFlushCount = -1;
    const flushTimer = setInterval(() => {
      if (!isPageVisible()) return; // skip React updates while backgrounded
      const now = Date.now();
      if (res) {
        const currentCount = res.totalCore + res.totalOutliers;
        if (currentCount !== lastFlushCount) {
          setM1Recent(res.snapshot(now));
          lastFlushCount = currentCount;
        }
        if (now - lastPersistRef.current > 10000) {
          res.persistToStorage(now);
          lastPersistRef.current = now;
        }
      }
    }, 5000);

    const qTimer = setInterval(() => {
      res?.recomputeQuantiles();
    }, 5000);

    // Visibility change: flush all pending data and trigger fresh fetch when tab becomes visible
    const onVisibilityChange = () => {
      if (!isPageVisible()) return;
      flushPendingOverlay();
      const now = Date.now();
      if (res) {
        const currentCount = res.totalCore + res.totalOutliers;
        if (currentCount !== lastFlushCount) {
          setM1Recent(res.snapshot(now));
          lastFlushCount = currentCount;
        }
      }
      // Sync ref-only updates that accumulated while hidden
      setProgramStartTime(prev => prev === programStartTimeRef.current ? prev : programStartTimeRef.current);
      if (currentProgramIdRef.current) setCurrentProgramId(currentProgramIdRef.current);
      // Trigger a fresh data fetch by updating currentTime
      setCurrentTime(now);
      lastFetchTimeRef.current = now;
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      removeListeners(es);
      es.close();
      clearInterval(flushTimer);
      clearInterval(qTimer);
      clearInterval(staleCheck);
      if (overlayFlushTimer) clearTimeout(overlayFlushTimer);
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
  const pies = useMemo(() => toPieSlices(m4Breakdown, colorMap, liveActiveRecipes), [m4Breakdown, colorMap, liveActiveRecipes]);

  return {
    mode,                     // "replay" | "live" | null (not configured)
    configError,              // error message if config failed to load
    loading,
    // legend & overlays
    colorMap,                 // { recipe -> color, Total -> color }
    assignmentsByGate,        // { gate: recipe_name }
    overlayByGate,            // { gate: { main, buffer, mainFull, bufferFull, pieces, grams } }
    hasBuffer,                // boolean - whether machine has buffer compartments
    // chart data
    xTicks,                   // array of ISO timestamps used on X axis
    throughput,               // { series: [...], total: [...] }
    giveaway,                 // { series: [...], total: [...] }
    piecesProcessed,          // { series: [...], total: [...] }
    weightProcessed,          // { series: [...], total: [...] }
    rejects,                  // [{ id:'Total', color, data:[{x,y}]}]
    scatter,                  // [{ id: 'Pieces', data:[{x,y,id,alpha}]}]
    pies,                     // { total:[...], give_g:[...], give_pct:[...] }
    gateTimingData,           // { dwell: [...], ack: [...], blocked: [...] }
    // replay controls
    currentTime,              // current cursor position (milliseconds)
    datasetStart,             // dataset start time (Date object)
    datasetEnd,               // dataset end time (Date object)
    setCurrentTime,           // function to jump to a specific time
  };
}