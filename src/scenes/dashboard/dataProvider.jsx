// src/scenes/dashboard/dataProvider.js
import { useEffect, useMemo, useState, useRef } from "react";
import { tokens } from "../../theme";
import {useTheme} from "@mui/material";

/**
 * ========= SWITCHES (hard-coded for now) ===============================
 * MODE: "replay" | "live"
 *   - "replay": fetches a 1-hour sliding window and advances minute by minute
 *   - "live":   subscribes to SSE "tick" events and refreshes windowed data on each tick
 *
 * REPLAY_SPEED: for "replay" mode, how many minutes to advance per second
 * WINDOW_MIN:   how many minutes of window (history) to fetch at once
 * BUCKET_SEC:   aggregation bucket size in seconds (for M1/M3/M3_combined/M4 endpoints)
 */
export const MODE = "replay";    // <-- flip between "replay" and "live"
export const REPLAY_SPEED = 1.0; // minutes per second in replay mode (1.0 = realtime, 2.0 = 2x speed)
export const WINDOW_MIN = 60;    // fetch 30 minutes of data at a time (reduced from 60 for better performance)
export const BUCKET_SEC = 60;    // bucket size in seconds for aggregation
export const FETCH_THROTTLE_MIN = 0.5; // Only fetch if time jumped by > 3 seconds (reduced for better slider responsiveness)
// ======================================================================

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
  // Data actually starts at 06:00:00, but we need to start the replay cursor
  // at a time that allows the 60-minute lookback window to have data.
  // So start at 07:00 (60 minutes after data start)
  const from = new Date('2025-06-05T07:00:00Z');
  const to = new Date('2025-06-17T14:50:00Z');
  
  console.log('Using configured date range:', { 
    from: from.toISOString(), 
    to: to.toISOString(),
    note: 'Window looks back 60 min, so first fetch will be from 06:00 to 07:00'
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

// Persistent color tracking - keeps colors stable and reuses freed colors
// Maps recipe name to color index in priority order
let recipeToColorIndex = {}; // { recipeName: colorIndex }

function buildColorMap(recipeNames, PALETTE, totalColor) {
  const map = {};
  const activeRecipeSet = new Set(recipeNames);
  
  // Step 1: Clean up - remove inactive recipes and free their color indices
  Object.keys(recipeToColorIndex).forEach((recipe) => {
    if (!activeRecipeSet.has(recipe)) {
      delete recipeToColorIndex[recipe]; // Free up the color
    }
  });
  
  // Step 2: Assign existing colors to recipes that already have them
  recipeNames.forEach((recipe) => {
    if (recipeToColorIndex[recipe] !== undefined) {
      map[recipe] = PALETTE[recipeToColorIndex[recipe]];
    }
  });
  
  // Step 3: Find which color indices are currently in use
  const usedIndices = new Set(Object.values(recipeToColorIndex));
  
  // Step 4: Assign colors to new recipes using first available index in priority order
  recipeNames.forEach((recipe) => {
    if (map[recipe]) return; // Already has a color
    
    // Find first available color index
    for (let i = 0; i < PALETTE.length; i++) {
      if (!usedIndices.has(i)) {
        recipeToColorIndex[recipe] = i;
        map[recipe] = PALETTE[i];
        usedIndices.add(i); // Mark as used
        break;
      }
    }
  });
  
  // Only add "Total" if there are active recipes
  if (recipeNames.length > 0) {
    map["Total"] = totalColor; // Use beige/green for Total
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

function toScatterSeries(m1Recent) {
  return [{
    id: "Pieces",
    data: (m1Recent || []).map(p => ({ x: p.t ?? p.x, y: Number(p.weight_g ?? p.y ?? 0) }))
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


  // ---------- Initialize: detect dataset bounds ----------
  useEffect(() => {
    let aborted = false;
    (async () => {
      try {
        setLoading(true);
        
        if (MODE === "replay") {
          const range = await detectDateRange();
          if (aborted) return;
          
          setDatasetStart(range.from);
          setDatasetEnd(range.to);
          setCurrentTime(range.from.getTime()); // Start at beginning
          
          console.log('Dataset range detected:', {
            start: range.from.toISOString(),
            end: range.to.toISOString(),
            durationHours: (range.to - range.from) / (1000 * 60 * 60)
          });
        } else {
          // Live mode: start at current time
          const now = new Date();
          setCurrentTime(now.getTime());
        }
      } catch (err) {
        console.error("Failed to initialize dashboard:", err);
      } finally {
        if (!aborted) setLoading(false);
      }
    })();
    return () => { aborted = true; };
  }, []);

  // ---------- Fetch data window around currentTime ----------
  useEffect(() => {
    if (currentTime === null || fetchingRef.current) return;
    
    // Throttle: only in REPLAY mode (not in live mode where we want fresh data)
    if (MODE === "replay") {
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

        // Build combined data
        const combinedData = (throughputData?.total || []).map(r => {
          const giveawayRow = (giveawayData?.total || []).find(g => g.t === r.t);
          const piecesProcessedRow = (piecesProcessedData?.total || []).find(p => p.t === r.t);
          const weightProcessedRow = (weightProcessedData?.total || []).find(w => w.t === r.t);
          const rejectsRow = (rejectsData || []).find(re => re.t === r.t);
          return {
            t: r.t,
            batches_min: r.v || 0,
            giveaway_pct: giveawayRow?.v || 0,
            pieces_processed: piecesProcessedRow?.v || 0,
            weight_processed_g: weightProcessedRow?.v || 0,
            rejects_per_min: rejectsRow?.v || 0,
            total_rejects_count: rejectsRow?.total_rejects_count || 0,
            total_rejects_weight_g: rejectsRow?.total_rejects_weight_g || 0
          };
        });
        setM3Combined(combinedData);

        setM4Breakdown(piesData || []);

        // M1 scatter - Client-side sampling with outlier preservation
        const scatter = [];
        Object.values(m1Data || {}).forEach(list => {
          (list || []).forEach(p => scatter.push({ t: p.t, weight_g: Number(p.weight_g || 0) }));
        });
        
        // Sample if too many points - preserve outliers
        let sampledScatter = scatter;
        const MAX_POINTS = 500;
        if (scatter.length > MAX_POINTS) {
          // Preserve top and bottom 10% as outliers
          const outlierCount = Math.floor(MAX_POINTS * 0.2);
          const topCount = Math.floor(outlierCount / 2);
          const bottomCount = outlierCount - topCount;
          
          // Sort by weight to identify outliers
          const sortedByWeight = [...scatter].sort((a, b) => a.weight_g - b.weight_g);
          const bottomOutliers = sortedByWeight.slice(0, bottomCount);
          const topOutliers = sortedByWeight.slice(-topCount);
          
          // Get middle points (exclude outliers)
          const outlierWeights = new Set([
            ...bottomOutliers.map(p => p.weight_g),
            ...topOutliers.map(p => p.weight_g)
          ]);
          const middlePoints = scatter.filter(p => !outlierWeights.has(p.weight_g));
          
          // Sample middle points evenly
          const middleTarget = MAX_POINTS - outlierCount;
          const step = Math.max(1, Math.floor(middlePoints.length / middleTarget));
          const sampledMiddle = middlePoints.filter((_, i) => i % step === 0);
          
          // Combine outliers + sampled middle
          sampledScatter = [...bottomOutliers, ...topOutliers, ...sampledMiddle];
        }
        
        // Sort by time for display
        sampledScatter.sort((a, b) => new Date(a.t) - new Date(b.t));
        setM1Recent(sampledScatter);

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
        
        // Build color map ONLY from SQLite assignments
        setColorMap(buildColorMap(activeRecipes, PALETTE, TOTAL_COLOR));
        
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
      } catch (err) {
        console.error("Failed to fetch data window:", err);
      } finally {
        if (!aborted) fetchingRef.current = false;
      }
    })();
    
    return () => { aborted = true; fetchingRef.current = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTime]);

  // ---------- REPLAY: advance time cursor ----------
  useEffect(() => {
    if (MODE !== "replay" || currentTime === null || datasetStart === null || datasetEnd === null) return;
    
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
  }, [currentTime, datasetStart, datasetEnd]);

  // ---------- LIVE SSE ----------
  useEffect(() => {
    if (MODE !== "live") return;
    const es = new EventSource(API.sse(), { withCredentials: true });

    const onTick = async (ev) => {
      try {
        const { ts, overlay } = JSON.parse(ev.data); // server sends { ts: ISO, overlay: [...] }
        const to = new Date(ts);
        
        // Update current time to trigger windowed data fetch
        setCurrentTime(to.getTime());
        
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
    es.onerror = (e) => console.warn("SSE error", e);
    return () => es.close();
  }, []);

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
  const rejects = useMemo(
    () => toRejectsSeries({ m3Combined, color: colorMap["Total"] }),
    [m3Combined, colorMap]
  );
  const scatter = useMemo(() => toScatterSeries(m1Recent), [m1Recent]);
  const pies = useMemo(() => toPieSlices(m4Breakdown, colorMap), [m4Breakdown, colorMap]);

  return {
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
    scatter,                  // [{ id: 'Pieces', data:[{x,y}]}]
    pies,                     // { total:[...], give_g:[...], give_pct:[...] }
    // replay controls
    currentTime,              // current cursor position (milliseconds)
    datasetStart,             // dataset start time (Date object)
    datasetEnd,               // dataset end time (Date object)
    setCurrentTime,           // function to jump to a specific time
  };
}