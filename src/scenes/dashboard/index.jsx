// src/scenes/dashboard/index.jsx
import React, { useMemo, useState, useRef, useCallback, useEffect } from "react";
import { Box, Typography, useTheme, Paper, IconButton, Tooltip } from "@mui/material";
import PauseIcon from "@mui/icons-material/Pause";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import { ResponsiveLineCanvas } from "@nivo/line";
import { ResponsivePie } from "@nivo/pie";
import { ResponsiveScatterPlotCanvas } from "@nivo/scatterplot";
import Header from "../../components/Header";
import MachineControls from "../../components/MachineControls";
import ServerOffline from "../../components/ServerOffline";
import { tokens } from "../../theme";
import { useDashboardData } from "./dataProvider";
import useMachineState from "../../hooks/useMachineState";
import { getSyncedAnimationStyle } from "../../utils/animationSync";
import { useAppContext } from "../../context/AppContext";
import { useRenderMonitor } from "../../utils/renderMonitor";
import api from "../../services/api";

/* ---------- Recipe name formatter ---------- */
const formatRecipeName = (name) => {
  if (!name || name === "Total") return name;
  return name;
};

/* ---------- Nivo safety ---------- */
const sanitizeLineSeries = (arr) => {
  const list = Array.isArray(arr) ? arr : [];
  return list
    .filter(s => s && typeof s.id !== "undefined" && Array.isArray(s.data))
    .map(s => ({
      id: String(s.id),
      color: s.color,
      data: (s.data || [])
        .filter(p => p != null && (p.x !== undefined || p.t !== undefined))
        .map(p => ({ x: p.x ?? p.t, y: Number.isFinite(p.y) ? p.y : Number(p.v ?? NaN) }))
        .filter(p => p.x !== undefined && p.x !== null && Number.isFinite(p.y))
    }))
    .filter(s => s.data.length > 0);
};

/* ---------- Gate annotations grid (no machine image) ---------- */
const GATE_GAP = 10; // px — horizontal & vertical gap between gate boxes

const GateAnnotationsGrid = React.memo(({ colorMap, assignmentsByGate, overlayByGate, transitioningGates, hasBuffer }) => {
  useRenderMonitor('GateAnnotations');
  const theme = useTheme();
  const colors = tokens(theme.palette.mode);
  const isDark = theme.palette.mode === 'dark';
  // const fullBg = isDark ? colors.redAccent[400] : colors.redAccent[100];
  const fullBg = isDark ? 'rgba(244,67,54,0.25)' : 'rgba(182, 31, 31, 0.25)';

  const gates = [1, 2, 3, 4, 5, 6, 7, 8];

  return (
    <Box sx={{
      display: 'grid',
      gridTemplateColumns: 'repeat(4, 105px)',
      gridTemplateRows: 'auto auto',
      gap: `${GATE_GAP}px`,
    }}>
      {gates.map((gate) => {
        const program = assignmentsByGate[gate] || "—";
        const headColor = colorMap[program] || colors.primary[500];
        const gateInfo = overlayByGate[gate] || { main: { pieces: 0, grams: 0 }, buffer: { pieces: 0, grams: 0 }, mainFull: false, bufferFull: false, pieces: 0, grams: 0 };
        const isTransitioning = (transitioningGates || []).includes(gate);
        const mainData = gateInfo.main || { pieces: gateInfo.pieces || 0, grams: gateInfo.grams || 0 };
        const bufferData = gateInfo.buffer || { pieces: 0, grams: 0 };
        const isMainFull = gateInfo.mainFull || false;
        const isBufferFull = gateInfo.bufferFull || false;
        const isGateBlocked = isMainFull && (!hasBuffer || isBufferFull);

        const blockedPulse = isGateBlocked ? {
          '@keyframes blockedBlink': {
            '0%, 100%': { borderColor: 'transparent', boxShadow: '0 0 0px transparent' },
            '50%': { borderColor: colors.redAccent[500], boxShadow: `0 0 12px ${colors.redAccent[500]}88` },
          },
          animation: 'blockedBlink 1.2s ease-in-out infinite',
          borderWidth: '2px',
        } : {};

        return (
          <Box key={gate} sx={{
            backgroundColor: colors.primary[100],
            borderRadius: 1,
            border: `1px solid ${headColor}`,
            width: '105px',
            boxShadow: 3,
            overflow: 'hidden',
            ...(isTransitioning && getSyncedAnimationStyle()),
            ...blockedPulse,
          }}>
            <Box sx={{ backgroundColor: headColor, py: 0.1, px: 0.5, textAlign: 'left' }}>
              <Typography variant="h8" color="#fff" sx={{ fontSize: '0.65rem' }}>
                G{gate}
              </Typography>
            </Box>

            {hasBuffer && (
              <>
                <Box sx={{ px: 0.5, pt: 0.2, pb: 0.1, backgroundColor: isBufferFull ? fullBg : 'transparent' }}>
                  <Typography variant="caption" color={colors.grey[500]} fontWeight="bold" sx={{ fontSize: '0.55rem', letterSpacing: '0.05em' }}>
                    BUFFER {isBufferFull ? '— FULL' : ''}
                  </Typography>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', py: 0 }}>
                    <Typography variant="body2" color={colors.primary[800]} sx={{ fontSize: '0.65rem' }}>Pcs:</Typography>
                    <Typography variant="body2" color={colors.primary[800]} sx={{ fontSize: '0.65rem' }}>{bufferData.pieces ?? 0}</Typography>
                  </Box>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', py: 0 }}>
                    <Typography variant="body2" color={colors.primary[800]} sx={{ fontSize: '0.65rem' }}>g:</Typography>
                    <Typography variant="body2" color={colors.primary[800]} sx={{ fontSize: '0.65rem' }}>{Number(bufferData.grams ?? 0).toFixed(1)}</Typography>
                  </Box>
                </Box>
                <Box sx={{ borderTop: `1px dashed ${colors.grey[400]}`, mx: 0.5 }} />
              </>
            )}

            <Box sx={{ px: 0.5, pt: hasBuffer ? 0.1 : 0.3, pb: 0.2, backgroundColor: isMainFull ? fullBg : 'transparent' }}>
              {hasBuffer && (
                <Typography variant="caption" color={colors.grey[500]} fontWeight="bold" sx={{ fontSize: '0.55rem', letterSpacing: '0.05em' }}>
                  MAIN {isMainFull ? '— FULL' : ''}
                </Typography>
              )}
              <Box sx={{ display: 'flex', justifyContent: 'space-between', py: 0.1 }}>
                <Typography variant="body2" color={colors.primary[800]} fontWeight={hasBuffer ? 'normal' : 'bold'} sx={{ fontSize: hasBuffer ? '0.65rem' : '0.75rem' }}>
                  {hasBuffer ? 'Pcs:' : 'Pieces:'}
                </Typography>
                <Typography variant="body2" color={colors.primary[800]} sx={{ fontSize: hasBuffer ? '0.65rem' : '0.75rem' }}>
                  {mainData.pieces ?? 0}
                </Typography>
              </Box>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', py: 0.1 }}>
                <Typography variant="body2" color={colors.primary[800]} fontWeight={hasBuffer ? 'normal' : 'bold'} sx={{ fontSize: hasBuffer ? '0.65rem' : '0.75rem' }}>
                  {hasBuffer ? 'g:' : 'Gram:'}
                </Typography>
                <Typography variant="body2" color={colors.primary[800]} sx={{ fontSize: hasBuffer ? '0.65rem' : '0.75rem' }}>
                  {Number(mainData.grams ?? 0).toFixed(1)}
                </Typography>
              </Box>
              {!hasBuffer && isMainFull && (
                <Typography variant="caption" color="#f44336" fontWeight="bold" sx={{ display: 'block', textAlign: 'center', mt: 0.2, fontSize: '0.6rem' }}>
                  FULL — AWAITING REMOVAL
                </Typography>
              )}
            </Box>
          </Box>
        );
      })}
    </Box>
  );
});

/* ---------- Active Orders Table ---------- */
const ActiveOrdersTable = React.memo(({ activeRecipes, colorMap, pausedGates, machineState: mState }) => {
  const theme = useTheme();
  const colors = tokens(theme.palette.mode);

  const handleToggleGatePause = async (gate) => {
    const isPaused = (pausedGates || []).includes(gate);
    try { await api.post('/machine/pause-gate', { gate, paused: !isPaused }); } catch (e) { console.error('Failed to toggle gate pause:', e); }
  };

  const handleToggleRecipePause = async (recipe) => {
    try {
      await api.post('/machine/pause-recipe', {
        recipeName: recipe.recipeName,
        orderId: recipe.orderId || null,
        paused: !recipe.paused,
      });
    } catch (e) { console.error('Failed to toggle recipe pause:', e); }
  };

  if (!activeRecipes || activeRecipes.length === 0) {
    return (
      <Typography variant="body2" color={colors.grey[500]} sx={{ py: 2 }}>
        No active orders. Add orders to start production.
      </Typography>
    );
  }

  return (
    <Paper sx={{ p: 3, backgroundColor: colors.primary[200], width: '100%' }}>
      <Box display="grid" gridTemplateColumns="3fr 80px repeat(8, 20px) 40px repeat(6, minmax(40px, 1fr)) minmax(80px, auto)" gap="2px" sx={{ width: '100%' }}>
        {/* Header row 1 */}
        <Box sx={{ p: 0, display: 'flex', alignItems: 'center', minHeight: '20px' }}>
          <Typography variant="body2" fontWeight="bold">Order</Typography>
        </Box>
        <Box sx={{ p: 0, display: 'flex', alignItems: 'center', minHeight: '20px' }}>
          <Typography variant="body2" fontWeight="bold">Batches</Typography>
        </Box>
        <Box sx={{ p: 0, display: 'flex', alignItems: 'center', minHeight: '20px', gridColumn: 'span 8' }}>
          <Typography variant="body2" fontWeight="bold">Gates</Typography>
        </Box>
        <Box />
        <Box sx={{ display: 'flex', alignItems: 'center', minHeight: '20px', gridColumn: 'span 2' }}>
          <Typography variant="body2" fontWeight="bold">Piece Weight</Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', minHeight: '20px', gridColumn: 'span 2' }}>
          <Typography variant="body2" fontWeight="bold">Batch Weight</Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', minHeight: '20px', gridColumn: 'span 2' }}>
          <Typography variant="body2" fontWeight="bold">Pieces</Typography>
        </Box>
        <Box />

        {/* Header row 2 */}
        <Box sx={{ minHeight: '20px', mb: 1 }} />
        <Box sx={{ minHeight: '20px', mb: 1 }} />
        {[1, 2, 3, 4, 5, 6, 7, 8].map(gate => (
          <Box key={gate} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '20px', mb: 1 }}>
            <Typography variant="body2" fontWeight="bold">{gate}</Typography>
          </Box>
        ))}
        <Box sx={{ mb: 1 }} />
        {['Min', 'Max', 'Min', 'Max', 'Min', 'Max'].map((label, i) => (
          <Box key={i} sx={{ display: 'flex', alignItems: 'center', minHeight: '20px', mb: 1 }}>
            <Typography variant="body2" fontWeight="bold">{label}</Typography>
          </Box>
        ))}
        <Box sx={{ mb: 1 }} />

        {/* Data rows */}
        {(() => {
          const incoming = activeRecipes.filter(r => r._isIncomingFromQueue);
          const rest = activeRecipes.filter(r => !r._isIncomingFromQueue);
          const hasFinishing = rest.some(r => r.batchLimitTransitioning || r.isFinishing);
          const ordered = [];
          for (const r of rest) {
            ordered.push(r);
            if ((r.batchLimitTransitioning || r.isFinishing) && hasFinishing) {
              for (const inc of incoming) ordered.push(inc);
            }
          }
          if (!hasFinishing) for (const inc of incoming) ordered.push(inc);
          return ordered;
        })().map((recipe, i) => {
          const recipeColor = colorMap[recipe.recipeName] || colors.primary[500];
          const completed = recipe.completedBatches || 0;
          const requested = recipe.requestedBatches || recipe.batchLimit;
          const orderName = recipe.orderId && recipe.customerName
            ? `${recipe.customerName} - #${recipe.orderId}`
            : (recipe.displayName || recipe.display_name || formatRecipeName(recipe.recipeName));
          const isRecipePaused = !!recipe.paused;
          const isFinishing = recipe.batchLimitTransitioning || recipe.isFinishing;
          const isIncoming = recipe._isIncomingFromQueue;
          const anyFinishing = activeRecipes.some(r => r.batchLimitTransitioning || r.isFinishing);
          const isReplacing = isIncoming && anyFinishing;

          let nameColor = colors.primary[800];
          let labelSuffix = '';
          if (isFinishing) {
            nameColor = colors.tealAccent[500];
            labelSuffix = ' (Finishing)';
          } else if (isReplacing) {
            nameColor = colors.redAccent[500];
            labelSuffix = ' (Replacing)';
          }

          return (
            <React.Fragment key={`${i}-${recipe.recipeName}`}>
              <Box sx={{ p: 0.5, display: 'flex', alignItems: 'center', height: '28px' }}>
                {isReplacing && (
                  <Typography variant="body2" sx={{ mr: 0.5, color: colors.redAccent[500] }}>↳</Typography>
                )}
                <Typography variant="body2" sx={{ color: nameColor, fontWeight: (isFinishing || isReplacing) ? 'bold' : 'normal' }}>{orderName}{labelSuffix}</Typography>
              </Box>
              <Box sx={{ p: 0.5, display: 'flex', alignItems: 'center', height: '28px' }}>
                <Typography variant="body2">{completed}/{requested || '-'}</Typography>
              </Box>
              {[1, 2, 3, 4, 5, 6, 7, 8].map(gate => {
                const isAssigned = (recipe.gates || []).includes(gate);
                const isGatePaused = isAssigned && (pausedGates || []).includes(gate);
                return (
                  <Box key={gate}
                    onClick={isAssigned ? () => handleToggleGatePause(gate) : undefined}
                    sx={{
                      position: 'relative',
                      backgroundColor: isAssigned
                        ? isGatePaused ? `${recipeColor}66` : recipeColor
                        : undefined,
                      width: '20px', height: '20px', alignSelf: 'center',
                      cursor: isAssigned ? 'pointer' : 'default',
                      ...(isGatePaused && {
                        backgroundImage: 'repeating-linear-gradient(45deg, transparent, transparent 3px, rgba(0,0,0,0.15) 3px, rgba(0,0,0,0.15) 5px)',
                      }),
                      '&:hover .gate-pause-icon': { opacity: isAssigned ? 1 : 0 },
                    }}
                  >
                    {isAssigned && (
                      <Box className="gate-pause-icon" sx={{
                        opacity: isGatePaused ? 1 : 0,
                        transition: 'opacity 0.15s',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        position: 'absolute', inset: 0,
                        backgroundColor: 'rgba(0,0,0,0.35)', borderRadius: '2px',
                      }}>
                        {isGatePaused
                          ? <PlayArrowIcon sx={{ fontSize: 14, color: '#fff' }} />
                          : <PauseIcon sx={{ fontSize: 14, color: '#fff' }} />}
                      </Box>
                    )}
                  </Box>
                );
              })}
              <Box sx={{ height: '28px' }} />
              <Box sx={{ p: 0.5, display: 'flex', alignItems: 'center', height: '28px' }}>
                <Typography variant="body2">{recipe.params?.pieceMinWeight || '-'}</Typography>
              </Box>
              <Box sx={{ p: 0.5, display: 'flex', alignItems: 'center', height: '28px' }}>
                <Typography variant="body2">{recipe.params?.pieceMaxWeight || '-'}</Typography>
              </Box>
              <Box sx={{ p: 0.5, display: 'flex', alignItems: 'center', height: '28px' }}>
                <Typography variant="body2">{recipe.params?.batchMinWeight || '-'}</Typography>
              </Box>
              <Box sx={{ p: 0.5, display: 'flex', alignItems: 'center', height: '28px' }}>
                <Typography variant="body2">{recipe.params?.batchMaxWeight || '-'}</Typography>
              </Box>
              <Box sx={{ p: 0.5, display: 'flex', alignItems: 'center', height: '28px' }}>
                <Typography variant="body2">
                  {recipe.params?.countType === 'min' || recipe.params?.countType === 'exact' ? recipe.params?.countValue || '-' : '-'}
                </Typography>
              </Box>
              <Box sx={{ p: 0.5, display: 'flex', alignItems: 'center', height: '28px' }}>
                <Typography variant="body2">
                  {recipe.params?.countType === 'max' || recipe.params?.countType === 'exact' ? recipe.params?.countValue || '-' : '-'}
                </Typography>
              </Box>
              <Box display="flex" alignItems="center" justifyContent="flex-end" sx={{ height: '28px' }}>
                {isRecipePaused && (
                  <Typography variant="body2" sx={{ color: theme.palette.action.disabled, fontSize: '0.7rem', whiteSpace: 'nowrap', mr: 0.5 }}>
                    PAUSED
                  </Typography>
                )}
                {mState !== 'idle' && (
                  <Tooltip title={isRecipePaused ? "Resume" : "Pause"}>
                    <IconButton
                      size="small"
                      onClick={() => handleToggleRecipePause(recipe)}
                      sx={{ color: isRecipePaused ? colors.tealAccent[500] : colors.orangeAccent[500] }}
                    >
                      {isRecipePaused ? <PlayArrowIcon fontSize="small" /> : <PauseIcon fontSize="small" />}
                    </IconButton>
                  </Tooltip>
                )}
              </Box>
            </React.Fragment>
          );
        })}
      </Box>
    </Paper>
  );
});

/* ---------- Memoized chart sections ---------- */
const MemoScatterChart = React.memo(({ scatter, scatterProps, chartBoxSx, colors }) => {
  useRenderMonitor('ScatterChart');
  return (
    <Box sx={{ ...chartBoxSx, flex: 1.5, display: 'flex', flexDirection: 'column' }} p="12px">
      <Typography variant="h5" color={colors.tealAccent[500]}>Piece Weight Distribution</Typography>
      <Box sx={{ flex: 1, minHeight: 0, position: "relative" }}>
        {scatter && scatter.length > 0 && scatter[0]?.data?.length > 0 ? (
          <ResponsiveScatterPlotCanvas data={scatter} {...scatterProps} />
        ) : (
          <Box display="flex" alignItems="center" justifyContent="center" height="100%">
            <Typography variant="body2" color={colors.grey[500]}>No data</Typography>
          </Box>
        )}
      </Box>
    </Box>
  );
});

const MemoLineChart = React.memo(({ data, lineProps, lineColorFn, chartBoxSx, colors }) => {
  useRenderMonitor('LineChart');
  return (
    <Box sx={{ ...chartBoxSx, flex: 1.5, display: 'flex', flexDirection: 'column' }} p="12px">
      <Typography variant="h5" color={colors.tealAccent[500]}>Pieces Processed</Typography>
      <Box sx={{ flex: 1, minHeight: 0, position: "relative" }}>
        {data.length > 0 ? (
          <ResponsiveLineCanvas data={data} colors={lineColorFn} {...lineProps} enableArea areaOpacity={0.15} areaBaselineValue={0} />
        ) : (
          <Box display="flex" alignItems="center" justifyContent="center" height="100%">
            <Typography variant="body2" color={colors.grey[500]}>No data</Typography>
          </Box>
        )}
      </Box>
    </Box>
  );
});

const MemoPieChart = React.memo(({ data, pieProps, title, label, value, chartBoxSx, colors }) => {
  useRenderMonitor('PieChart');
  return (
    <Box sx={{ ...chartBoxSx, flex: 1, display: 'flex', flexDirection: 'column' }} p="12px">
      <Typography variant="h5" color={colors.tealAccent[500]}>{title}</Typography>
      <Typography variant="body2" color={colors.primary[800]} sx={{ mb: "-6px" }}>{label}: {value}</Typography>
      <Box sx={{ flex: 1, minHeight: 0, position: "relative", overflow: "hidden" }}>
        {data.length > 0 ? <ResponsivePie data={data} {...pieProps} /> : (
          <Box display="flex" alignItems="center" justifyContent="center" height="100%">
            <Typography variant="body2" color={colors.grey[500]}>No data</Typography>
          </Box>
        )}
      </Box>
    </Box>
  );
});

const MemoRejectsBox = React.memo(({ rejects, chartBoxSx, colors }) => {
  useRenderMonitor('RejectsBox');
  return (
    <Box sx={{ ...chartBoxSx, flex: 1, display: 'flex', flexDirection: 'column' }} p="12px">
      <Typography variant="h5" color={colors.tealAccent[500]}>Rejects</Typography>
      <Box display="flex" flexDirection="row" flex="1" justifyContent="space-around" alignItems="center" sx={{ minHeight: 0 }}>
        <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center' }}>
          <Typography variant="caption" color={colors.primary[900]} sx={{ mb: 1, whiteSpace: 'nowrap' }}>TOTAL COUNT</Typography>
          <Typography variant="h3" color={colors.tealAccent[500]} fontWeight="bold" sx={{ lineHeight: 1 }}>
            {(() => { const d = rejects?.[0]?.data?.[rejects[0].data.length - 1]; return d?.total_rejects_count?.toLocaleString() || '0'; })()}
          </Typography>
          <Typography variant="body2" color={colors.primary[900]} sx={{ mt: 1 }}>pieces</Typography>
        </Box>
        <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center' }}>
          <Typography variant="caption" color={colors.primary[900]} sx={{ mb: 1, whiteSpace: 'nowrap' }}>TOTAL WEIGHT</Typography>
          <Typography variant="h3" color={colors.tealAccent[500]} fontWeight="bold" sx={{ lineHeight: 1 }}>
            {(() => { const d = rejects?.[0]?.data?.[rejects[0].data.length - 1]; const w = (d?.total_rejects_weight_g || 0) / 1000; return w.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }); })()}
          </Typography>
          <Typography variant="body2" color={colors.primary[900]} sx={{ mt: 1 }}>kg</Typography>
        </Box>
      </Box>
    </Box>
  );
});

/* ---------- Dashboard ---------- */
const REF_W = 750;
const REF_H = 740;

/* The chart row uses flex:1 with minHeight:0 — it fills ALL remaining
   vertical space after gates + table.  When the table grows (more orders),
   charts shrink.  To give charts more room overall, increase REF_H above
   (everything scales down slightly, freeing more virtual pixels for charts). */

const Dashboard = () => {
  useRenderMonitor('Dashboard');
  const theme = useTheme();
  const colors = useMemo(() => tokens(theme.palette.mode), [theme.palette.mode]);
  const isDark = theme.palette.mode === "dark";

  const observerRef = useRef(null);
  const [containerDims, setContainerDims] = useState({ w: 0, h: 0, scale: 1 });

  const containerRef = useCallback((el) => {
    if (observerRef.current) {
      observerRef.current.disconnect();
      observerRef.current = null;
    }
    if (el) {
      const observer = new ResizeObserver((entries) => {
        const { width, height } = entries[0].contentRect;
        if (width < 10 || height < 10) return;
        const s = Math.max(0.4, Math.min(width / REF_W, height / REF_H));
        setContainerDims(prev => {
          if (Math.abs(prev.scale - s) < 0.005 && Math.abs(prev.w - width) < 2 && Math.abs(prev.h - height) < 2) return prev;
          return { w: width, h: height, scale: s };
        });
      });
      observer.observe(el);
      observerRef.current = observer;
    }
  }, []);

  const machineHook = useMachineState();
  const { activeRecipes, transitioningGates, transitionStartRecipes, state: machineState, pausedGates } = machineHook;
  const { dashboardVisibleSeries, setDashboardVisibleSeries, recipeOrderMap } = useAppContext();

  // Stabilise array references so React.memo children don't re-render when
  // useMachineState emits a new object whose arrays have identical content.
  const activeRecipesRef = useRef(activeRecipes);
  activeRecipesRef.current = activeRecipes;
  const stableTransitioningGates = useMemo(() => transitioningGates, [JSON.stringify(transitioningGates)]);
  const stablePausedGates = useMemo(() => pausedGates, [JSON.stringify(pausedGates)]);

  const {
    mode, configError, colorMap, assignmentsByGate, overlayByGate, hasBuffer,
    xTicks, rejects, scatter, piecesProcessed, pies,
  } = useDashboardData();

  // Sync visibility with colorMap (same as KPI page)
  const colorMapKeys = useMemo(() => JSON.stringify(Object.keys(colorMap || {}).sort()), [colorMap]);
  useEffect(() => {
    const keys = JSON.parse(colorMapKeys);
    if (!keys.length) return;
    setDashboardVisibleSeries(prev => {
      const next = { ...(prev || {}) };
      let hasChanges = false;
      keys.forEach(k => { if (next[k] === undefined) { next[k] = true; hasChanges = true; } });
      return hasChanges ? next : prev;
    });
  }, [colorMapKeys, setDashboardVisibleSeries]);

  /* Display name helpers */
  const recipeNameToOrderInfo = useMemo(() => {
    const map = {};
    if (!recipeOrderMap) return map;
    Object.entries(recipeOrderMap).forEach(([key, info]) => {
      const recipeName = info.recipeName;
      if (recipeName) {
        if (!map[recipeName]) map[recipeName] = [];
        map[recipeName].push({ key, ...info });
      }
    });
    return map;
  }, [recipeOrderMap]);

  const getDisplayName = useCallback((recipeNameOrObj) => {
    if (!recipeNameOrObj || recipeNameOrObj === "Total") return recipeNameOrObj;
    const recipeName = typeof recipeNameOrObj === 'string' ? recipeNameOrObj : recipeNameOrObj.recipeName || recipeNameOrObj.id;
    if (!recipeName || recipeName === "Total") return recipeName;
    if (recipeNameToOrderInfo[recipeName]) {
      const entries = recipeNameToOrderInfo[recipeName];
      const orderEntry = entries.find(e => e.orderId);
      if (orderEntry) return `${orderEntry.customerName} - #${orderEntry.orderId}`;
    }
    const activeMatch = (activeRecipesRef.current || []).find(r => r.recipeName === recipeName && r.orderId && r.customerName);
    if (activeMatch) return `${activeMatch.customerName} - #${activeMatch.orderId}`;
    return formatRecipeName(recipeName);
  }, [recipeNameToOrderInfo]);

  const formatTimeLabel = useCallback((ts) =>
    new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false }), []);

  /* Chart theme & props — ALL memoized to prevent new refs every render */
  const chartTheme = useMemo(() => ({
    axis: {
      domain: { line: { stroke: colors.primary[800], strokeWidth: 1 } },
      legend: { text: { fill: colors.primary[800] } },
      ticks: { line: { stroke: colors.primary[800], strokeWidth: 1 }, text: { fill: colors.primary[800], fontSize: 11 } },
    },
    grid: { line: { stroke: colors.primary[800], strokeWidth: 1 } },
    legends: { text: { fill: colors.primary[800] } },
    tooltip: { container: { background: isDark ? colors.primary[400] : colors.primary[100], color: isDark ? "#eee" : "#111" } },
  }), [colors, isDark]);

  const lineTickValues = useMemo(() => {
    const arr = (xTicks || []).filter(t => t != null);
    if (!arr.length) return [];
    const last = arr.length - 1;
    if (last === 0) return [arr[0]];
    const i2 = Math.floor(last / 3), i3 = Math.floor((2 * last) / 3);
    return [arr[0], arr[i2], arr[i3], arr[last]].filter(t => t != null);
  }, [xTicks]);

  const lineTooltip = useCallback(({ point }) => {
    if (!point || !point.serieId || !point.data) return null;
    return (
      <Box sx={{ background: isDark ? colors.primary[400] : colors.primary[100], padding: '9px 12px', borderRadius: '4px', border: `1px solid ${point.serieColor}` }}>
        <Typography variant="body2" sx={{ color: isDark ? "#eee" : "#111", fontWeight: 'bold' }}>{getDisplayName(point.serieId)}</Typography>
        <Typography variant="body2" sx={{ color: isDark ? "#eee" : "#111" }}>{formatTimeLabel(point.data.x)}: {Number(point.data.y).toFixed(2)}</Typography>
      </Box>
    );
  }, [isDark, colors, getDisplayName, formatTimeLabel]);

  const piecesProcessedProps = useMemo(() => ({
    margin: { top: 10, right: 20, bottom: 20, left: 40 },
    xScale: { type: 'point' }, yScale: { type: 'linear', min: 0, max: 'auto' },
    curve: 'basis', enableArea: false, useMesh: false, isInteractive: false,
    axisTop: null, axisRight: null, pointSize: 0,
    axisBottom: {
      format: (v) => { try { return v ? formatTimeLabel(v) : ''; } catch { return ''; } },
      tickRotation: 0, orient: "bottom", tickValues: lineTickValues,
      tickSize: 5, tickPadding: 5,
    },
    axisLeft: { orient: "left", tickValues: 3, tickSize: 5, tickPadding: 5, tickRotation: 0,
      legend: 'pieces / min', legendOffset: -35, legendPosition: 'middle' },
    theme: chartTheme, enableGridX: false, enableGridY: false,
    tooltip: lineTooltip,
  }), [lineTickValues, chartTheme, lineTooltip, formatTimeLabel]);

  const lineColorFn = useCallback(s => s?.color || colors.primary[700], [colors]);

  const pieTooltip = useCallback(({ datum }) => {
    if (!datum) return null;
    return (
      <Box sx={{ background: isDark ? colors.primary[400] : colors.primary[100], padding: '9px 12px', borderRadius: '4px', border: `1px solid ${datum.color}` }}>
        <Typography variant="body2" sx={{ color: isDark ? "#eee" : "#111", fontWeight: 'bold' }}>{getDisplayName(datum.id)}</Typography>
        <Typography variant="body2" sx={{ color: isDark ? "#eee" : "#111" }}>{Number(datum.value).toFixed(1)}</Typography>
      </Box>
    );
  }, [isDark, colors, getDisplayName]);

  const pieColorFn = useCallback(({ id }) => colorMap[id] || colors.primary[700], [colorMap, colors]);

  const sharedPieProps = useMemo(() => ({
    margin: { top: 20, right: 5, bottom: 0, left: 5 },
    innerRadius: 0.65, padAngle: 3, cornerRadius: 3, activeOuterRadiusOffset: 8,
    animate: false, borderWidth: 1, borderColor: { from: 'color', modifiers: [['darker', 0.2]] },
    enableArcLinkLabels: false, arcLabelsSkipAngle: 10, arcLabelsTextColor: '#ffffff', valueFormat: ">-.0f",
    colors: pieColorFn,
    theme: { labels: { text: { fill: '#ffffff' } } },
    tooltip: pieTooltip,
  }), [pieColorFn, pieTooltip]);

  const HORIZON_MS = 60 * 60 * 1000;
  // Recompute domain whenever scatter data updates so the X-axis stays current
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const domainEnd = useMemo(() => Date.now(), [scatter]);
  const domainStart = domainEnd - HORIZON_MS;
  const fixedTicks = useMemo(() => {
    const w = domainEnd - domainStart;
    return [Math.round(domainStart), Math.round(domainStart + w / 3), Math.round(domainStart + (2 * w) / 3), Math.round(domainEnd)];
  }, [domainStart, domainEnd]);

  const scatterTooltip = useCallback(({ node }) => {
    if (!node || !node.data) return null;
    return (
      <Box sx={{ background: isDark ? colors.primary[400] : colors.primary[100], padding: '9px 12px', borderRadius: '4px', border: `1px solid ${tokens(theme.palette.mode).tealAccent[500]}` }}>
        <Typography variant="body2" sx={{ color: isDark ? "#eee" : "#111" }}>{formatTimeLabel(node.data.x)}: {Number(node.data.y).toFixed(2)}g</Typography>
      </Box>
    );
  }, [isDark, colors, theme.palette.mode, formatTimeLabel]);

  const scatterColorFn = useCallback(() => tokens(theme.palette.mode).tealAccent[500], [theme.palette.mode]);

  const sharedScatterProps = useMemo(() => ({
    margin: { top: 10, right: 20, bottom: 20, left: 40 },
    xScale: { type: 'linear', min: domainStart, max: domainEnd },
    yScale: { type: 'linear', min: 'auto', max: 'auto' },
    axisBottom: { format: formatTimeLabel, tickRotation: 0, orient: "bottom", tickValues: fixedTicks, tickSize: 5, tickPadding: 5 },
    axisLeft: { orient: "left", tickValues: 3, tickSize: 5, tickPadding: 5, tickRotation: 0, legend: 'weight (g)', legendOffset: -35, legendPosition: 'middle' },
    theme: chartTheme, colors: scatterColorFn,
    nodeSize: 3, useMesh: true, enableGridX: false, enableGridY: false,
    tooltip: scatterTooltip,
  }), [domainStart, domainEnd, fixedTicks, chartTheme, scatterColorFn, scatterTooltip, formatTimeLabel]);

  /* Filtered chart data — memoized to avoid recomputing on every render */
  const visible = dashboardVisibleSeries || {};
  const visibleRef = useRef(visible);
  visibleRef.current = visible;

  const filteredPiecesProcessed = useMemo(
    () => sanitizeLineSeries([...(piecesProcessed?.series || []).filter(s => visibleRef.current[s.id]), ...(visibleRef.current["Total"] ? (piecesProcessed?.total || []) : [])]),
    [piecesProcessed, dashboardVisibleSeries]
  );

  const pieBatchTotal = useMemo(() => (pies?.total || []).filter(s => visibleRef.current[s.id]), [pies, dashboardVisibleSeries]);
  const pieGivePct = useMemo(() => (pies?.give_pct || []).filter(s => visibleRef.current[s.id]), [pies, dashboardVisibleSeries]);
  const batchTotalSum = useMemo(() => Math.round(pieBatchTotal.reduce((s, d) => s + (Number(d.value) || 0), 0)), [pieBatchTotal]);
  const giveawayPercentAvg = useMemo(
    () => pieGivePct.length ? Number((pieGivePct.reduce((s, d) => s + (Number(d.value) || 0), 0) / pieGivePct.length).toFixed(1)) : 0,
    [pieGivePct]
  );

  const chartBoxSx = useMemo(() => ({ backgroundColor: colors.primary[100], borderRadius: 1.5, overflow: "hidden" }), [colors]);

  if (mode === null && configError && configError !== 'waiting') {
    return <ServerOffline title="Dashboard" />;
  }

  if (mode === null) {
    return (
      <Box m="20px" display="flex" alignItems="center" justifyContent="center" height="calc(100vh - 200px)">
        <Box textAlign="center">
          <Typography variant="h2" color={colors.primary[800]} fontWeight="bold">Dashboard</Typography>
          <Typography variant="h5" color={colors.tealAccent[400]}>Waiting for configuration...</Typography>
          <Typography variant="h4" color={colors.grey[300]} mt={4}>Loading configuration...</Typography>
        </Box>
      </Box>
    );
  }

  const { w: cW, h: cH, scale } = containerDims;

  return (
    <Box m="20px" sx={{ height: 'calc(100vh - 180px)', display: 'flex', flexDirection: 'column' }}>
      <Header title="Dashboard" subtitle="Performance Overview" />

      <Box ref={containerRef} sx={{ flex: 1, minHeight: 0, position: 'relative', overflow: 'hidden' }}>
        <Box sx={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: cW > 0 ? `${cW / scale}px` : '100%',
          height: cH > 0 ? `${cH / scale}px` : '100%',
          transform: `scale(${scale})`,
          transformOrigin: 'top left',
          display: 'flex',
          flexDirection: 'column',
        }}>

          {/* Top section: Gate annotations (left) + Controls (right) — always full height */}
          <Box sx={{ flexShrink: 0, display: 'flex', gap: 2, mb: 3 }}>
          <GateAnnotationsGrid
            colorMap={colorMap}
            assignmentsByGate={assignmentsByGate}
            overlayByGate={overlayByGate}
            transitioningGates={stableTransitioningGates}
            hasBuffer={hasBuffer}
          />
          <Box sx={{ ml: 'auto' }}>
            <Paper elevation={0} sx={{
              width: '175px',
              p: 1.5,
              backgroundColor: isDark ? 'rgba(30,30,30,0.85)' : 'rgba(255,255,255,0.88)',
              backdropFilter: 'blur(8px)',
              border: `1px solid ${colors.grey[300]}`,
              borderRadius: 2,
            }}>
              <MachineControls
                layout="vertical"
                activeRecipesCount={activeRecipes?.length || 0}
                showTitle={false}
                contentOrder="reversed"
                machineStateOverride={machineHook}
                styles={{
                  titleVariant: 'h5',
                  buttonHeight: '30px',
                  buttonFontSize: '0.8rem',
                  buttonGap: 0.8,
                  recipesTextVariant: 'caption',
                  stateBadge: { px: 1.5, py: 0.3, borderRadius: 1.5, fontSize: '0.65rem' },
                }}
              />
            </Paper>
          </Box>
        </Box>

        {/* Bottom section: Table + Charts — fills remaining height */}
        <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          {/* Active Orders table (takes natural height, pushes charts down) */}
          <Box sx={{ mb: 2, flexShrink: 0 }}>
            <ActiveOrdersTable
              activeRecipes={activeRecipes}
              colorMap={colorMap}
              pausedGates={stablePausedGates}
              machineState={machineState}
            />
          </Box>

          {/* KPI charts — fills remaining space, shrinks when table grows */}
          <Box sx={{ flex: 1, minHeight: 0, display: 'flex', gap: '12px', overflow: 'hidden' }}>
            <MemoRejectsBox rejects={rejects} chartBoxSx={chartBoxSx} colors={colors} />
            <MemoScatterChart scatter={scatter} scatterProps={sharedScatterProps} chartBoxSx={chartBoxSx} colors={colors} />
            <MemoLineChart data={filteredPiecesProcessed} lineProps={piecesProcessedProps} lineColorFn={lineColorFn} chartBoxSx={chartBoxSx} colors={colors} />
            <MemoPieChart data={pieBatchTotal} pieProps={sharedPieProps} title="Batch Total" label="Sum" value={batchTotalSum} chartBoxSx={chartBoxSx} colors={colors} />
            <MemoPieChart data={pieGivePct} pieProps={sharedPieProps} title="Give-away (%)" label="Avg" value={giveawayPercentAvg} chartBoxSx={chartBoxSx} colors={colors} />
          </Box>
        </Box>
        </Box>
      </Box>
    </Box>
  );
};

export default Dashboard;
