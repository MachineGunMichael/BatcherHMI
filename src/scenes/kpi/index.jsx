// src/scenes/kpi/index.jsx
import React, { useMemo, useEffect, useState, useCallback, useRef } from "react";
import { Box, Typography, useTheme, Slider } from "@mui/material";
import { ResponsiveLine } from "@nivo/line";
import { ResponsivePie } from "@nivo/pie";
import { ResponsiveScatterPlot } from "@nivo/scatterplot";
import { ResponsiveBoxPlot } from "@nivo/boxplot";
import Header from "../../components/Header";
import ServerOffline from "../../components/ServerOffline";
import { tokens } from "../../theme";
import { useAppContext } from "../../context/AppContext";
import { useDashboardData } from "../dashboard/dataProvider";
import useMachineState from "../../hooks/useMachineState";
import { getSyncedAnimationStyle } from "../../utils/animationSync";
import { useRenderMonitor } from "../../utils/renderMonitor";

/* ---------- Recipe name formatter ---------- */
const formatRecipeName = (name) => {
  if (!name || name === "Total") return name;
  let formatted = name;
  if (formatted.startsWith("R_")) formatted = formatted.substring(2);
  if (formatted.endsWith("_NA_0")) formatted = formatted.substring(0, formatted.length - 5);
  formatted = formatted.replace(/_exact_(\d+)/, "_=_$1");
  formatted = formatted.replace(/_min_(\d+)/, "_>_$1");
  formatted = formatted.replace(/_max_(\d+)/, "_<_$1");
  return formatted;
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

/* ---------- Custom scatter node ---------- */
const ScatterNode = ({ node }) => {
  const r = (node?.size ?? 3) / 2;
  const a = typeof node?.data?.alpha === 'number' ? node.data.alpha : 1;
  return (
    <g transform={`translate(${node.x}, ${node.y})`}>
      <circle r={r} fill={node.color} fillOpacity={a} stroke="none" />
    </g>
  );
};

const LegendBox = React.memo(({ chartBoxSx, legendKeys, colorMap, colors, dashboardVisibleSeries, transitioningRecipeNames, toggleSeries, getDisplayName }) => {
  useRenderMonitor('KPI:LegendBox');
  const containerRef = useRef(null);
  const [needsTwoCols, setNeedsTwoCols] = useState(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const itemH = 32;
    const available = el.clientHeight || 200;
    setNeedsTwoCols(legendKeys.length * itemH > available);
  }, [legendKeys]);

  // Compute width from longest display name (~6.2px per char at 11px font + circle/padding)
  const colWidth = useMemo(() => {
    const longest = legendKeys.reduce((max, name) => {
      const display = getDisplayName(name);
      return display.length > max ? display.length : max;
    }, 0);
    return Math.max(120, longest * 6.2 + 40);
  }, [legendKeys, getDisplayName]);

  const boxWidth = needsTwoCols ? colWidth * 2 + 28 : colWidth + 24;

  return (
    <Box sx={{
      ...chartBoxSx,
      width: boxWidth, minWidth: boxWidth, flexShrink: 0,
      display: "flex", flexDirection: "column", overflow: "hidden",
      transition: 'width 0.3s ease',
    }} p="12px">
      <Typography variant="h5" color={colors.tealAccent[500]} sx={{ mb: 1 }}>Legend</Typography>
      <Box ref={containerRef} sx={{
        flex: 1, overflow: 'hidden', p: '4px',
        ...(needsTwoCols ? {
          display: 'flex', flexDirection: 'column', flexWrap: 'wrap',
          alignContent: 'flex-start', gap: '0 8px',
        } : {}),
      }}>
        {legendKeys.map((name) => {
          const isTransitioning = transitioningRecipeNames.has(name);
          return (
            <Box key={name} display="flex" alignItems="center" gap="8px"
              onClick={() => toggleSeries(name)}
              sx={{
                cursor: 'pointer',
                opacity: (dashboardVisibleSeries?.[name] ?? true) ? 1 : 0.4,
                transition: 'all 0.2s', '&:hover': { transform: 'scale(1.05)' },
                border: (dashboardVisibleSeries?.[name] ?? true) ? 'none' : `1px solid ${colors.grey[300]}`,
                borderRadius: '4px', padding: '4px 8px', mb: '4px',
                whiteSpace: 'nowrap',
                ...(isTransitioning && getSyncedAnimationStyle()),
              }}
            >
              <Box sx={{ width: '12px', height: '12px', minWidth: '12px', borderRadius: '50%', backgroundColor: colorMap[name] || colors.primary[700], flexShrink: 0 }} />
              <Typography variant="body2" fontSize="11px" color={colors.primary[800]}>
                {getDisplayName(name)}
              </Typography>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
});

/* ---------- Memoized chart sections ---------- */
const MemoKPILineChart = React.memo(({ data, lineProps, lineColorFn, chartBoxSx, colors, title }) => {
  useRenderMonitor(`KPI:Line:${title}`);
  return (
    <Box sx={{ ...chartBoxSx, flex: 1 }} p="15px">
      <Typography variant="h5" color={colors.tealAccent[500]}>{title}</Typography>
      {data.length > 0 ? (
        <ResponsiveLine data={data} colors={lineColorFn} {...lineProps} animate={false} />
      ) : (
        <Box display="flex" alignItems="center" justifyContent="center" height="calc(100% - 30px)">
          <Typography variant="body2" color={colors.grey[500]}>No data</Typography>
        </Box>
      )}
    </Box>
  );
});

const MemoKPIPieChart = React.memo(({ data, pieProps, title, label, value, chartBoxSx, colors }) => {
  useRenderMonitor(`KPI:Pie:${title}`);
  return (
    <Box sx={{ ...chartBoxSx, display: "flex", flexDirection: "column", flex: 1 }} p="12px">
      <Typography variant="h5" color={colors.tealAccent[500]}>{title}</Typography>
      <Typography variant="body2" color={colors.primary[800]} sx={{ mb: "-6px" }}>{label} : {value}</Typography>
      <Box sx={{ flex: 1, position: "relative", overflow: "hidden" }}>
        {data.length > 0 ? <ResponsivePie data={data} {...pieProps} /> : (
          <Box display="flex" alignItems="center" justifyContent="center" height="100%"><Typography variant="body2" color={colors.grey[500]}>No data</Typography></Box>
        )}
      </Box>
    </Box>
  );
});

const MemoKPIScatterChart = React.memo(({ scatter, scatterProps, chartBoxSx, colors }) => {
  useRenderMonitor('KPI:Scatter');
  return (
    <Box sx={{ ...chartBoxSx, flex: 1 }} p="15px">
      <Typography variant="h5" color={colors.tealAccent[500]}>Piece Weight Distribution</Typography>
      <Box sx={{ height: "calc(100% - 30px)", position: "relative" }}>
        {scatter && scatter.length > 0 && scatter[0]?.data?.length > 0 ? (
          <ResponsiveScatterPlot data={scatter} {...scatterProps} nodeComponent={ScatterNode} animate={false} />
        ) : (
          <Box display="flex" alignItems="center" justifyContent="center" height="100%">
            <Typography variant="body2" color={colors.grey[500]}>No data available</Typography>
          </Box>
        )}
      </Box>
    </Box>
  );
});

const MemoKPIRejectsBox = React.memo(({ rejects, chartBoxSx, colors }) => {
  useRenderMonitor('KPI:Rejects');
  return (
    <Box sx={{ ...chartBoxSx, flex: '0 0 auto', width: '240px', minWidth: '200px', display: 'flex', flexDirection: 'column' }} p="15px">
      <Typography variant="h5" color={colors.tealAccent[500]} mb="10px">Rejects</Typography>
      <Box display="flex" flexDirection="row" gap="20px" flex="1" justifyContent="space-around" alignItems="center">
        <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center' }}>
          <Typography variant="h7" color={colors.primary[900]} mb="8px">TOTAL COUNT</Typography>
          <Typography variant="h2" color={colors.tealAccent[500]} fontWeight="bold" sx={{ lineHeight: 1 }}>
            {(() => { const d = rejects?.[0]?.data?.[rejects[0].data.length - 1]; return d?.total_rejects_count?.toLocaleString() || '0'; })()}
          </Typography>
          <Typography variant="body2" color={colors.primary[900]} mt="8px">pieces</Typography>
        </Box>
        <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center' }}>
          <Typography variant="h7" color={colors.primary[900]} mb="8px">TOTAL WEIGHT</Typography>
          <Typography variant="h2" color={colors.tealAccent[500]} fontWeight="bold" sx={{ lineHeight: 1 }}>
            {(() => { const d = rejects?.[0]?.data?.[rejects[0].data.length - 1]; const w = (d?.total_rejects_weight_g || 0) / 1000; return w.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }); })()}
          </Typography>
          <Typography variant="body2" color={colors.primary[900]} mt="8px">kg</Typography>
        </Box>
      </Box>
    </Box>
  );
});

const MemoKPIBoxPlot = React.memo(({ visibleBoxData, boxGroups, activeSubGroups, boxColorFn, boxBorderColorFn, chartTheme, visibleMetrics, metricLegend, setVisibleMetrics, chartBoxSx, colors }) => {
  useRenderMonitor('KPI:BoxPlot');
  return (
    <Box sx={{ ...chartBoxSx, flex: 1, minHeight: 0 }} p="15px">
      <Box display="flex" alignItems="center" justifyContent="space-between" mb="4px">
        <Typography variant="h5" color={colors.tealAccent[500]}>Gate Time Distribution</Typography>
        <Box display="flex" gap={2}>
          {metricLegend.map(({ key, label, opacity }) => (
            <Box key={key} display="flex" alignItems="center" gap="6px"
              onClick={() => setVisibleMetrics(prev => ({ ...prev, [key]: !prev[key] }))}
              sx={{
                cursor: 'pointer',
                opacity: visibleMetrics[key] !== false ? 1 : 0.4,
                transition: 'all 0.2s',
                '&:hover': { transform: 'scale(1.05)' },
                border: visibleMetrics[key] !== false ? 'none' : `1px solid ${colors.grey[300]}`,
                borderRadius: '4px', padding: '2px 8px',
              }}
            >
              <Box sx={{
                width: 12, height: 12, borderRadius: '3px', flexShrink: 0,
                backgroundColor: `${colors.tealAccent[500]}${opacity}`,
                border: `1px solid ${colors.tealAccent[500]}`,
              }} />
              <Typography variant="caption" color={colors.primary[800]}>{label}</Typography>
            </Box>
          ))}
        </Box>
      </Box>
      {visibleBoxData.length > 0 ? (
        <ResponsiveBoxPlot
          data={visibleBoxData}
          subGroupBy="subGroup"
          groups={boxGroups}
          subGroups={activeSubGroups}
          margin={{ top: 10, right: 20, bottom: 50, left: 70 }}
          minValue={0}
          maxValue="auto"
          padding={0.3}
          innerPadding={4}
          enableGridX={false}
          enableGridY={false}
          axisTop={null}
          axisRight={null}
          axisBottom={{ tickSize: 5, tickPadding: 5, tickRotation: 0 }}
          axisLeft={{
            tickSize: 5, tickPadding: 5, tickRotation: 0,
            legend: 'Time (seconds)', legendPosition: 'middle', legendOffset: -55,
            format: value => `${Math.round(value)}s`,
            tickValues: 5,
          }}
          colors={boxColorFn}
          borderRadius={2}
          borderWidth={2}
          borderColor={boxBorderColorFn}
          medianWidth={3}
          medianColor={{ from: 'color', modifiers: [['darker', 1]] }}
          whiskerEndSize={0.4}
          whiskerColor={boxBorderColorFn}
          animate={false}
          theme={chartTheme}
          enableLabel={false}
        />
      ) : (
        <Box display="flex" alignItems="center" justifyContent="center" height="100%">
          <Typography variant="body2" color={colors.grey[500]}>No gate timing data available</Typography>
        </Box>
      )}
    </Box>
  );
});

const KPI = () => {
  useRenderMonitor('KPI');
  const theme = useTheme();
  const colors = useMemo(() => tokens(theme.palette.mode), [theme.palette.mode]);
  const isDark = theme.palette.mode === "dark";

  const { activeRecipes: rawActiveRecipes, transitionStartRecipes: rawTransitionStartRecipes } = useMachineState();
  const { dashboardVisibleSeries, setDashboardVisibleSeries, recipeOrderMap } = useAppContext();

  // Stabilise references so downstream useMemo/useCallback chain doesn't
  // cascade re-renders when useMachineState emits a new object with identical content.
  const arKey = JSON.stringify((rawActiveRecipes || []).map(r => [r.recipeName, r.displayName || r.display_name, r.orderId, r.customerName]));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const activeRecipes = useMemo(() => rawActiveRecipes, [arKey]);
  const tsrKey = JSON.stringify(rawTransitionStartRecipes || {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const transitionStartRecipes = useMemo(() => rawTransitionStartRecipes, [tsrKey]);

  const activeRecipesRef = useRef(activeRecipes);
  activeRecipesRef.current = activeRecipes;

  const recipeDisplayNames = useMemo(() => {
    const map = {};
    (activeRecipes || []).forEach(r => { if (r.recipeName) map[r.recipeName] = r.displayName || r.display_name || null; });
    Object.values(transitionStartRecipes || {}).forEach(r => { if (r && r.recipeName && !map[r.recipeName]) map[r.recipeName] = r.displayName || r.display_name || null; });
    return map;
  }, [activeRecipes, transitionStartRecipes]);

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
    return recipeDisplayNames[recipeName] || formatRecipeName(recipeName);
  }, [recipeNameToOrderInfo, recipeDisplayNames]);

  const transitioningRecipeNames = useMemo(() => {
    const names = new Set();
    Object.values(transitionStartRecipes || {}).forEach(r => { if (r && r.recipeName) names.add(r.recipeName); });
    return names;
  }, [transitionStartRecipes]);

  const {
    mode, configError, loading, colorMap, assignmentsByGate,
    xTicks, throughput, giveaway, piecesProcessed, weightProcessed,
    rejects, scatter, pies, gateTimingData,
    currentTime, datasetStart, datasetEnd, setCurrentTime,
  } = useDashboardData();

  const [sliderValue, setSliderValue] = useState(currentTime);

  const [visibleMetrics, setVisibleMetrics] = useState({
    Completion: true, Response: true, Blocked: true,
  });

  const [chartKey, setChartKey] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setChartKey(prev => prev + 1), 300000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => { setSliderValue(currentTime); }, [currentTime]);

  const debounceRef = useRef(null);
  const handleSliderChange = useCallback((_, value) => {
    setSliderValue(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setCurrentTime(value), 100);
  }, [setCurrentTime]);

  useEffect(() => { return () => { if (debounceRef.current) clearTimeout(debounceRef.current); }; }, []);

  // Legend keys & toggle
  const colorMapKeys = useMemo(() => JSON.stringify(Object.keys(colorMap || {}).sort()), [colorMap]);
  useEffect(() => {
    const keys = JSON.parse(colorMapKeys);
    if (!keys.length) return;
    setDashboardVisibleSeries(prev => {
      const next = { ...(prev || {}) };
      let hasChanges = false;
      keys.forEach(k => { if (next[k] === undefined) { next[k] = true; hasChanges = true; } });
      Object.keys(next).forEach(k => { if (!keys.includes(k)) { delete next[k]; hasChanges = true; } });
      return hasChanges ? next : prev;
    });
  }, [colorMapKeys, setDashboardVisibleSeries]);

  const legendKeys = useMemo(() => {
    const ks = Object.keys(colorMap || {}).filter(k => k !== "Total");
    ks.sort();
    if (colorMap["Total"]) ks.push("Total");
    return ks;
  }, [colorMap]);

  const toggleSeries = useCallback((name) => {
    setDashboardVisibleSeries(prev => ({ ...(prev || {}), [name]: !(prev?.[name] ?? true) }));
  }, [setDashboardVisibleSeries]);

  const formatTimeLabel = (ts) =>
    new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });

  // Chart themes and shared props — memoized to prevent new references every render
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
  }, [isDark, colors, getDisplayName]);

  const sharedLineProps = useMemo(() => ({
    margin: { top: 10, right: 20, bottom: 50, left: 40 },
    xScale: { type: 'point' }, yScale: { type: 'linear', min: 'auto', max: 'auto' },
    curve: 'basis', enableArea: false, useMesh: false, isInteractive: false,
    axisTop: null, axisRight: null, pointSize: 0,
    axisBottom: {
      format: (v) => { try { return v ? formatTimeLabel(v) : ''; } catch { return ''; } },
      tickRotation: 0, orient: "bottom", tickValues: lineTickValues,
      tickSize: 5, tickPadding: 5,
    },
    axisLeft: { orient: "left", tickValues: 5, tickSize: 5, tickPadding: 5, tickRotation: 0 },
    theme: chartTheme, enableGridX: false, enableGridY: false,
    tooltip: lineTooltip,
  }), [lineTickValues, chartTheme, lineTooltip]);

  const throughputProps = useMemo(() => ({ ...sharedLineProps, axisLeft: { ...sharedLineProps.axisLeft, legend: 'batch / min', legendOffset: -35, legendPosition: 'middle' } }), [sharedLineProps]);
  const giveawayProps = useMemo(() => ({ ...sharedLineProps, axisLeft: { ...sharedLineProps.axisLeft, legend: '%', legendOffset: -35, legendPosition: 'middle' }, yScale: { type: 'linear', min: 0, max: 'auto' }, enableArea: true, areaBaselineValue: 0 }), [sharedLineProps]);
  const piecesProcessedProps = useMemo(() => ({ ...sharedLineProps, axisLeft: { ...sharedLineProps.axisLeft, legend: 'pieces / min', legendOffset: -35, legendPosition: 'middle' } }), [sharedLineProps]);
  const weightProcessedProps = useMemo(() => ({ ...sharedLineProps, axisLeft: { ...sharedLineProps.axisLeft, legend: 'kg / min', legendOffset: -35, legendPosition: 'middle' } }), [sharedLineProps]);

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

  const lineColorFn = useCallback(s => s?.color || colors.primary[700], [colors]);

  // Scatter
  const HORIZON_MS = 60 * 60 * 1000;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const domainEnd = useMemo(() => (mode === "live" ? Date.now() : (currentTime || Date.now())), [mode, currentTime, scatter]);
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
  }, [isDark, colors, theme.palette.mode]);

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
  }), [domainStart, domainEnd, fixedTicks, chartTheme, scatterColorFn, scatterTooltip]);

  // Visibility filtering — memoized to avoid recomputing on every render
  const visible = dashboardVisibleSeries || {};
  const visibleRef = useRef(visible);
  visibleRef.current = visible;

  const filteredThroughput = useMemo(
    () => sanitizeLineSeries([...(throughput.series || []).filter(s => visibleRef.current[s.id]), ...(visibleRef.current["Total"] ? (throughput.total || []) : [])]),
    [throughput, dashboardVisibleSeries]
  );
  const filteredGiveaway = useMemo(
    () => sanitizeLineSeries([...(giveaway.series || []).filter(s => visibleRef.current[s.id]), ...(visibleRef.current["Total"] ? (giveaway.total || []) : [])]),
    [giveaway, dashboardVisibleSeries]
  );
  const filteredPiecesProcessed = useMemo(
    () => sanitizeLineSeries([...(piecesProcessed.series || []).filter(s => visibleRef.current[s.id]), ...(visibleRef.current["Total"] ? (piecesProcessed.total || []) : [])]),
    [piecesProcessed, dashboardVisibleSeries]
  );
  const filteredWeightProcessed = useMemo(
    () => sanitizeLineSeries([...(weightProcessed.series || []).filter(s => visibleRef.current[s.id]), ...(visibleRef.current["Total"] ? (weightProcessed.total || []) : [])]),
    [weightProcessed, dashboardVisibleSeries]
  );

  const pieBatchTotal = useMemo(() => (pies.total || []).filter(s => visibleRef.current[s.id]), [pies, dashboardVisibleSeries]);
  const pieGiveG = useMemo(() => (pies.give_g || []).filter(s => visibleRef.current[s.id]), [pies, dashboardVisibleSeries]);
  const pieGivePct = useMemo(() => (pies.give_pct || []).filter(s => visibleRef.current[s.id]), [pies, dashboardVisibleSeries]);
  const batchTotalSum = useMemo(() => Math.round(pieBatchTotal.reduce((s, d) => s + (Number(d.value) || 0), 0)), [pieBatchTotal]);
  const giveawayGramSum = useMemo(() => Number(pieGiveG.reduce((s, d) => s + (Number(d.value) || 0), 0).toFixed(1)), [pieGiveG]);
  const giveawayPercentAvg = useMemo(
    () => pieGivePct.length ? Number((pieGivePct.reduce((s, d) => s + (Number(d.value) || 0), 0) / pieGivePct.length).toFixed(1)) : 0,
    [pieGivePct]
  );

  // Gate timing boxplot data
  const gateToRecipe = useMemo(() => {
    const m = {};
    (gateTimingData.dwell || []).forEach(d => { m[d.gate.toString()] = d.recipe_name; });
    (gateTimingData.ack || []).forEach(d => { m[d.gate.toString()] = d.recipe_name; });
    (gateTimingData.blocked || []).forEach(d => { m[d.gate.toString()] = d.recipe_name; });
    return m;
  }, [gateTimingData]);

  const combinedBoxData = useMemo(() => {
    const vis = visibleRef.current;
    const data = [];
    (gateTimingData.dwell || []).filter(d => vis[d.recipe_name] !== false).forEach(({ gate, dwell_times }) => {
      (dwell_times || []).forEach(v => data.push({ group: gate.toString(), subGroup: 'Completion', value: v }));
    });
    (gateTimingData.ack || []).filter(d => vis[d.recipe_name] !== false).forEach(({ gate, times }) => {
      (times || []).forEach(v => data.push({ group: gate.toString(), subGroup: 'Response', value: v }));
    });
    (gateTimingData.blocked || []).filter(d => vis[d.recipe_name] !== false).forEach(({ gate, times }) => {
      (times || []).forEach(v => data.push({ group: gate.toString(), subGroup: 'Blocked', value: v }));
    });
    return data;
  }, [gateTimingData, dashboardVisibleSeries]);

  const visibleBoxData = useMemo(() => combinedBoxData.filter(d => visibleMetrics[d.subGroup] !== false), [combinedBoxData, visibleMetrics]);
  const activeSubGroups = useMemo(() => ['Completion', 'Response', 'Blocked'].filter(k => visibleMetrics[k] !== false), [visibleMetrics]);
  const boxGroups = useMemo(() => [...new Set(combinedBoxData.map(d => d.group))].sort((a, b) => Number(a) - Number(b)), [combinedBoxData]);

  const subGroupColorModifier = useMemo(() => ({ Completion: 'ff', Response: '88', Blocked: '44' }), []);
  const metricLegend = useMemo(() => [
    { key: 'Completion', label: 'Batch Completion Time', opacity: 'ff' },
    { key: 'Response', label: 'Operator Response Time', opacity: '88' },
    { key: 'Blocked', label: 'Gate Blocked Time', opacity: '44' },
  ], []);

  const boxColorFn = useCallback((boxData) => {
    const recipeName = gateToRecipe[boxData.group];
    const baseColor = colorMap[recipeName] || colors.grey[500];
    const alpha = subGroupColorModifier[boxData.subGroup] || 'ff';
    return `${baseColor}${alpha}`;
  }, [gateToRecipe, colorMap, colors, subGroupColorModifier]);

  const boxBorderColorFn = useCallback((boxData) => {
    const recipeName = gateToRecipe[boxData.group];
    return colorMap[recipeName] || colors.grey[500];
  }, [gateToRecipe, colorMap, colors]);

  const chartBoxSx = useMemo(() => ({ backgroundColor: colors.primary[100], borderRadius: 1.5, overflow: "hidden" }), [colors]);

  if (mode === null && configError && configError !== 'waiting') {
    return <ServerOffline title="KPI" />;
  }

  if (mode === null) {
    return (
      <Box m="20px" display="flex" alignItems="center" justifyContent="center" height="calc(100vh - 200px)">
        <Box textAlign="center">
          <Header title="KPI" subtitle="Waiting for configuration..." />
          <Typography variant="h4" color={colors.grey[300]} mt={4}>Loading configuration...</Typography>
        </Box>
      </Box>
    );
  }

  return (
    <Box m="20px" height="calc(100vh - 200px)" maxHeight="calc(100vh - 200px)"
      sx={{ overflow: "visible", display: "flex", flexDirection: "column" }}>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb="20px" sx={{ m: "0px 0 0 0" }}>
        <Header title="KPI" subtitle="Performance Metrics" />
        {mode === "replay" && datasetStart && datasetEnd && currentTime && (
          <Box display="flex" alignItems="center" gap="12px" px="20px">
            <Box flex="0 0 300px" display="flex" flexDirection="column" gap="2px">
              <Typography variant="body2" color={colors.primary[700]} fontSize="10px">
                {new Date(currentTime).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
              </Typography>
              <Slider
                value={sliderValue}
                min={datasetStart.getTime()}
                max={datasetEnd.getTime()}
                onChange={handleSliderChange}
                sx={{ color: colors.tealAccent[500], '& .MuiSlider-thumb': { width: 14, height: 14 }, '& .MuiSlider-track': { height: 3 }, '& .MuiSlider-rail': { height: 3, opacity: 0.3 } }}
              />
            </Box>
          </Box>
        )}
      </Box>

      <Box key={chartKey} display="flex" gap="16px" sx={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
        {/* Left: 3 rows of charts */}
        <Box flex="1" display="flex" flexDirection="column" gap="16px" sx={{ minWidth: 0 }}>
          {/* Row 1: Legend (20%) | Rejects (30%) | Piece Weight Distribution (50%) */}
          <Box display="flex" gap="16px" sx={{ flex: 1, minHeight: 0 }}>
            <LegendBox
              chartBoxSx={chartBoxSx}
              legendKeys={legendKeys}
              colorMap={colorMap}
              colors={colors}
              dashboardVisibleSeries={dashboardVisibleSeries}
              transitioningRecipeNames={transitioningRecipeNames}
              toggleSeries={toggleSeries}
              getDisplayName={getDisplayName}
            />
            <MemoKPIRejectsBox rejects={rejects} chartBoxSx={chartBoxSx} colors={colors} />
            <MemoKPIScatterChart scatter={scatter} scatterProps={sharedScatterProps} chartBoxSx={chartBoxSx} colors={colors} />
          </Box>
          {/* Row 2: Batches | Pieces */}
          <Box display="flex" gap="16px" sx={{ flex: 1, minHeight: 0 }}>
            <MemoKPILineChart data={filteredThroughput} lineProps={throughputProps} lineColorFn={lineColorFn} chartBoxSx={chartBoxSx} colors={colors} title="Batches Processed" />
            <MemoKPILineChart data={filteredPiecesProcessed} lineProps={piecesProcessedProps} lineColorFn={lineColorFn} chartBoxSx={chartBoxSx} colors={colors} title="Pieces Processed" />
          </Box>
          {/* Row 3: Give-away | Weight */}
          <Box display="flex" gap="16px" sx={{ flex: 1, minHeight: 0 }}>
            <MemoKPILineChart data={filteredGiveaway} lineProps={giveawayProps} lineColorFn={lineColorFn} chartBoxSx={chartBoxSx} colors={colors} title="Give-away" />
            <MemoKPILineChart data={filteredWeightProcessed} lineProps={weightProcessedProps} lineColorFn={lineColorFn} chartBoxSx={chartBoxSx} colors={colors} title="Weight Processed" />
          </Box>
          {/* Row 4: Gate Time Distribution */}
          <MemoKPIBoxPlot
            visibleBoxData={visibleBoxData}
            boxGroups={boxGroups}
            activeSubGroups={activeSubGroups}
            boxColorFn={boxColorFn}
            boxBorderColorFn={boxBorderColorFn}
            chartTheme={chartTheme}
            visibleMetrics={visibleMetrics}
            metricLegend={metricLegend}
            setVisibleMetrics={setVisibleMetrics}
            chartBoxSx={chartBoxSx}
            colors={colors}
          />
        </Box>

        {/* Right: 3 pie charts spanning full height */}
        <Box sx={{ width: '180px', minWidth: '180px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <MemoKPIPieChart data={pieBatchTotal} pieProps={sharedPieProps} title="Batch total" label="Sum" value={batchTotalSum} chartBoxSx={chartBoxSx} colors={colors} />
          <MemoKPIPieChart data={pieGiveG} pieProps={sharedPieProps} title="Give-away (g/batch)" label="Sum" value={giveawayGramSum} chartBoxSx={chartBoxSx} colors={colors} />
          <MemoKPIPieChart data={pieGivePct} pieProps={sharedPieProps} title="Give-away (%)" label="Avg" value={giveawayPercentAvg} chartBoxSx={chartBoxSx} colors={colors} />
        </Box>
      </Box>
    </Box>
  );
};

export default KPI;
