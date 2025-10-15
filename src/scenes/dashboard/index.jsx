// src/scenes/dashboard/index.jsx
import React, { useMemo, useEffect, useState, useCallback } from "react";
import { Box, Typography, useTheme, Slider } from "@mui/material";
import { ResponsiveLine } from "@nivo/line";
import { ResponsivePie } from "@nivo/pie";
import { ResponsiveScatterPlot } from "@nivo/scatterplot";
import Header from "../../components/Header";
import { tokens } from "../../theme";
import { useAppContext } from "../../context/AppContext";
import { useDashboardData, MODE } from "./dataProvider";

/* ---------- Recipe name formatter ---------- */
const formatRecipeName = (name) => {
  if (!name || name === "Total") return name;
  
  let formatted = name;
  
  // Remove "R_" at the beginning
  if (formatted.startsWith("R_")) {
    formatted = formatted.substring(2);
  }
  
  // Remove "_NA_0" at the end
  if (formatted.endsWith("_NA_0")) {
    formatted = formatted.substring(0, formatted.length - 5);
  }
  
  // Replace exact_X with =_X
  formatted = formatted.replace(/_exact_(\d+)/, "_=_$1");
  
  // Replace min_X with >_X
  formatted = formatted.replace(/_min_(\d+)/, "_>_$1");
  
  // Replace max_X with <_X
  formatted = formatted.replace(/_max_(\d+)/, "_<_$1");
  
  return formatted;
};

/* ---------- Nivo safety: normalize series shape ---------- */
const sanitizeLineSeries = (arr) => {
  const list = Array.isArray(arr) ? arr : [];
  return list
    .filter(s => s && typeof s.id !== "undefined" && Array.isArray(s.data))
    .map(s => ({
      id: String(s.id),
      color: s.color,
      data: (s.data || [])
        .filter(p => p != null && (p.x !== undefined || p.t !== undefined))
        .map(p => ({
          x: p.x ?? p.t,
          y: Number.isFinite(p.y) ? p.y : Number(p.v ?? NaN)
        }))
        .filter(p => p.x !== undefined && p.x !== null && Number.isFinite(p.y))
    }))
    .filter(s => s.data.length > 0); // only include series with actual data
};

/* ---------- Annotated machine image with per-gate overlay ---------- */
const AnnotatedMachineImage = ({ colorMap, assignmentsByGate, overlayByGate }) => {
  const theme = useTheme();
  const colors = tokens(theme.palette.mode);

  // const annotationPositions = [
  //   { gate: 1, x1: '36%', y1: '70%', x2: '10%', y2: '15%' },
  //   { gate: 2, x1: '34%', y1: '60%', x2: '20%', y2: '15%' },
  //   { gate: 3, x1: '33%', y1: '50%', x2: '30%', y2: '15%' },
  //   { gate: 4, x1: '43%', y1: '35%', x2: '40%', y2: '15%' },
  //   { gate: 5, x1: '55%', y1: '75%', x2: '65%', y2: '85%' },
  //   { gate: 6, x1: '50%', y1: '65%', x2: '75%', y2: '85%' },
  //   { gate: 7, x1: '40%', y1: '75%', x2: '85%', y2: '85%' },
  //   { gate: 8, x1: '68%', y1: '35%', x2: '95%', y2: '85%' },
  // ];

  const annotationPositions = [
    { gate: 1, x1: '36%', y1: '70%', x2: '50%', y2: '15%' },
    { gate: 2, x1: '34%', y1: '60%', x2: '60%', y2: '15%' },
    { gate: 3, x1: '33%', y1: '50%', x2: '70%', y2: '15%' },
    { gate: 4, x1: '43%', y1: '35%', x2: '80%', y2: '15%' },
    { gate: 5, x1: '36%', y1: '70%', x2: '50%', y2: '65%' },
    { gate: 6, x1: '34%', y1: '60%', x2: '60%', y2: '65%' },
    { gate: 7, x1: '33%', y1: '50%', x2: '70%', y2: '65%' },
    { gate: 8, x1: '43%', y1: '35%', x2: '80%', y2: '65%' },
  ];

  // Line segments with simple x1, y1, x2, y2 coordinates (in percentages)
  const lineSegments = [
    // Gate 1 line - first segment (horizontal)
    {
      id: 'gate1-horizontal',
      x1: 37, y1: 5,   // Start at Gate 1
      x2: 41, y2: 5    // Go right horizontally
    },
    // Gate 1 line - second segment (angled to machine)
    {
      id: 'gate1-angled',
      x1: 37, y1: 5,   // Start at bend point
      x2: 33, y2: 7    // Go to machine
    },
    // Gate 5 line - first segment (horizontal)
    {
      id: 'gate5-horizontal',
      x1: 37, y1: 55,   // Start at Gate 5
      x2: 41, y2: 55    // Go right horizontally
    },
    // Gate 5 line - second segment (angled to machine)
    {
      id: 'gate5-angled',
      x1: 37, y1: 55,   // Start at bend point
      x2: 21, y2: 51    // Go to machine
    }
  ];

  return (
    <Box sx={{ position: 'relative', width: '100%', height: '100%' }}>
      <img
        alt="machine"
        style={{
          position: 'absolute',
          top: '40%',
          left: '17%',
          transform: 'translate(-50%, -50%)',
          maxHeight: '120%'
        }}
        src="../../assets/BatchMind2.png"
      />
      {annotationPositions.map((pos, idx) => {
        const program = assignmentsByGate[pos.gate] || "—";
        const headColor = colorMap[program] || colors.primary[700];
        const gateInfo = overlayByGate[pos.gate] || { pieces: 0, grams: 0 };

        return (
          <Box
            key={idx}
            sx={{
              position: 'absolute',
              top: pos.y2,
              left: pos.x2,
              transform: 'translate(-90%, -50%)',
              backgroundColor: colors.primary[100],
              borderRadius: 1,
              border: `1px solid ${headColor}`,
              width: '110px',
              boxShadow: 3,
              overflow: 'hidden',
            }}
          >
            <Box sx={{ backgroundColor: headColor, py: 0.1, px: 0.5, textAlign: 'left' }}>
              <Typography variant="h8" color="#fff">
                G{pos.gate}: {formatRecipeName(program)}
              </Typography>
            </Box>
            <Box sx={{ p: 0.5 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', borderBottom: `1px solid ${colors.grey[300]}`, py: 0.1 }}>
                <Typography variant="body2" color={colors.primary[800]} fontWeight="bold">Pieces:</Typography>
                <Typography variant="body2" color={colors.primary[800]}>{gateInfo.pieces ?? 0}</Typography>
              </Box>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', py: 0.1 }}>
                <Typography variant="body2" color={colors.primary[800]} fontWeight="bold">Gram:</Typography>
                <Typography variant="body2" color={colors.primary[800]}>{Number(gateInfo.grams ?? 0).toFixed(1)}</Typography>
              </Box>
            </Box>
          </Box>
        );
      })}
      
      {/* Line segments from gate boxes to machine image */}
      {lineSegments.map((segment) => {
        const isHorizontal = segment.y1 === segment.y2;
        const isVertical = segment.x1 === segment.x2;
        
        if (isHorizontal) {
          // Horizontal line
          return (
            <Box
              key={segment.id}
              sx={{
                position: 'absolute',
                left: `${segment.x1}%`,
                top: `${segment.y1}%`,
                width: `${segment.x2 - segment.x1}%`,
                height: '2px',
                backgroundColor: theme.palette.mode === 'dark' ? '#ffffff' : '#000000',
                zIndex: 0,
              }}
            />
          );
        } else if (isVertical) {
          // Vertical line
          return (
            <Box
              key={segment.id}
              sx={{
                position: 'absolute',
                left: `${segment.x1}%`,
                top: `${segment.y1}%`,
                width: '2px',
                height: `${segment.y2 - segment.y1}%`,
                backgroundColor: theme.palette.mode === 'dark' ? '#ffffff' : '#000000',
                zIndex: 0,
              }}
            />
          );
        } else {
          // Diagonal line - use simple math for these
          const deltaX = segment.x2 - segment.x1;
          const deltaY = segment.y2 - segment.y1;
          const length = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
          const angle = Math.atan2(deltaY, deltaX) * (180 / Math.PI);
          
          return (
            <Box
              key={segment.id}
              sx={{
                position: 'absolute',
                left: `${segment.x1}%`,
                top: `${segment.y1}%`,
                width: `${length}%`,
                height: '2px',
                backgroundColor: theme.palette.mode === 'dark' ? '#ffffff' : '#000000',
                transformOrigin: '0 50%',
                transform: `rotate(${angle}deg)`,
                zIndex: 0,
              }}
            />
          );
        }
      })}
    </Box>
  );
};

const Dashboard = () => {
  const theme = useTheme();
  const colors = tokens(theme.palette.mode);
  const isDark = theme.palette.mode === "dark";

  // global toggles from AppContext
  const { dashboardVisibleSeries, setDashboardVisibleSeries } = useAppContext();

  const {
    colorMap,
    assignmentsByGate,
    overlayByGate,
    xTicks,
    throughput,
    giveaway,
    piecesProcessed,
    weightProcessed,
    rejects,
    scatter,
    pies,
    currentTime,
    datasetStart,
    datasetEnd,
    setCurrentTime,
  } = useDashboardData();

  // Debounced slider value to prevent rapid data fetching
  const [sliderValue, setSliderValue] = useState(currentTime);
  const [debounceTimeout, setDebounceTimeout] = useState(null);

  // Update slider value when currentTime changes (from replay)
  useEffect(() => {
    setSliderValue(currentTime);
  }, [currentTime]);

  // Debounced slider change handler
  const handleSliderChange = useCallback((_, value) => {
    setSliderValue(value);
    
    // Clear existing timeout
    if (debounceTimeout) {
      clearTimeout(debounceTimeout);
    }
    
    // Set new timeout to update currentTime after 100ms of no movement
    const timeout = setTimeout(() => {
      setCurrentTime(value);
    }, 100);
    
    setDebounceTimeout(timeout);
  }, [setCurrentTime, debounceTimeout]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (debounceTimeout) {
        clearTimeout(debounceTimeout);
      }
    };
  }, [debounceTimeout]);

  // ensure toggles contain current legend keys (recipes + Total)
  useEffect(() => {
    const keys = Object.keys(colorMap || {});
    if (!keys.length) return;
    setDashboardVisibleSeries(prev => {
      const next = { ...(prev || {}) };
      keys.forEach(k => { if (next[k] === undefined) next[k] = true; });
      Object.keys(next).forEach(k => { if (!keys.includes(k)) delete next[k]; });
      return next;
    });
  }, [colorMap, setDashboardVisibleSeries]);

  const legendKeys = useMemo(() => {
    const ks = Object.keys(colorMap || {}).filter(k => k !== "Total");
    ks.sort();
    if (colorMap["Total"]) ks.push("Total");
    return ks;
  }, [colorMap]);

  const formatTimeLabel = (ts) =>
    new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });

  const chartTheme = {
    axis: {
      domain: { line: { stroke: colors.primary[800], strokeWidth: 1 } },
      legend: { text: { fill: colors.primary[800] } },
      ticks: {
        line: { stroke: colors.primary[800], strokeWidth: 1 },
        text: { fill: colors.primary[800], fontSize: 11 },
      },
    },
    grid: { line: { stroke: colors.primary[800], strokeWidth: 1 } },
    legends: { text: { fill: colors.primary[800] } },
    tooltip: { container: { background: isDark ? colors.primary[400] : colors.primary[100], color: isDark ? "#eee" : "#111" } },
  };

  const sharedLineProps = {
    margin: { top: 10, right: 20, bottom: 50, left: 40 },
    xScale: { type: 'point' },
    yScale: { type: 'linear', min: 'auto', max: 'auto' },
    curve: 'basis',
    enableArea: false,
    useMesh: false,
    isInteractive: false,
    axisTop: null,
    axisRight: null,
    pointSize: 0,
    axisBottom: {
      format: (value) => {
        try {
          return value ? formatTimeLabel(value) : '';
        } catch (e) {
          console.error('formatTimeLabel error:', e, value);
          return '';
        }
      },
      tickRotation: 0,
      orient: "bottom",
      tickValues: (() => {
        const arr = (xTicks || []).filter(t => t != null);
        if (!arr.length) return [];
        const last = arr.length - 1;
        if (last === 0) return [arr[0]];
        const i2 = Math.floor(last / 3), i3 = Math.floor((2 * last) / 3);
        return [arr[0], arr[i2], arr[i3], arr[last]].filter(t => t != null);
      })(),
      tickSize: 5, tickPadding: 5,
      axis: { strokeWidth: 1 }, line: { strokeWidth: 1 },
    },
    axisLeft: {
      orient: "left",
      tickValues: 3, tickSize: 5, tickPadding: 5, tickRotation: 0,
      axis: { strokeWidth: 1 }, line: { strokeWidth: 1 },
      legend: '', legendOffset: -35, legendPosition: 'middle',
    },
    theme: chartTheme,
    enableGridX: false, enableGridY: false,
    tooltip: ({ point }) => {
      if (!point || !point.serieId || !point.data || point.data.x === undefined || point.data.y === undefined) return null;
      return (
        <Box sx={{ 
          background: isDark ? colors.primary[400] : colors.primary[100], 
          padding: '9px 12px',
          borderRadius: '4px',
          border: `1px solid ${point.serieColor}`,
        }}>
          <Typography variant="body2" sx={{ color: isDark ? "#eee" : "#111", fontWeight: 'bold' }}>
            {formatRecipeName(point.serieId)}
          </Typography>
          <Typography variant="body2" sx={{ color: isDark ? "#eee" : "#111" }}>
            {formatTimeLabel(point.data.x)}: {Number(point.data.y).toFixed(2)}
          </Typography>
        </Box>
      );
    },
  };

  const throughputProps = { ...sharedLineProps, axisLeft: { ...sharedLineProps.axisLeft, legend: 'batch / min' } };
  const giveawayProps   = { ...sharedLineProps, axisLeft: { ...sharedLineProps.axisLeft, legend: '%' }, enableArea: true, areaBaselineValue: 0, };
  const piecesProcessedProps = { ...sharedLineProps, axisLeft: { ...sharedLineProps.axisLeft, legend: 'pieces / min' } };
  const weightProcessedProps = { ...sharedLineProps, axisLeft: { ...sharedLineProps.axisLeft, legend: 'kg / min' } };
  const rejectsProps    = {
    ...sharedLineProps,
    axisLeft: { ...sharedLineProps.axisLeft, legend: 'piece / min' },
    enableArea: true, areaBaselineValue: 0,
    yScale: { type: 'linear', min: 0, max: 'auto' },
  };

  const sharedPieProps = {
    margin: { top: 20, right: 5, bottom: 0, left: 5 },
    innerRadius: 0.65,
    padAngle: 3,
    cornerRadius: 3,
    activeOuterRadiusOffset: 8,
    animate: false,
    motionConfig: 'gentle',
    borderWidth: 1,
    borderColor: { from: 'color', modifiers: [['darker', 0.2]] },
    enableArcLinkLabels: false,
    arcLabelsSkipAngle: 10,
    arcLabelsTextColor: '#ffffff',
    valueFormat: ">-.0f",
    colors: ({ id }) => colorMap[id] || colors.primary[700],
    theme: { labels: { text: { fill: '#ffffff' } } },
    tooltip: ({ datum }) => {
      if (!datum || !datum.id || datum.value === undefined) return null;
      return (
        <Box sx={{ 
          background: isDark ? colors.primary[400] : colors.primary[100], 
          padding: '9px 12px',
          borderRadius: '4px',
          border: `1px solid ${datum.color}`,
        }}>
          <Typography variant="body2" sx={{ color: isDark ? "#eee" : "#111", fontWeight: 'bold' }}>
            {formatRecipeName(datum.id)}
          </Typography>
          <Typography variant="body2" sx={{ color: isDark ? "#eee" : "#111" }}>
            {Number(datum.value).toFixed(1)}
          </Typography>
        </Box>
      );
    },
  };

  const sharedScatterProps = {
    margin: { top: 10, right: 20, bottom: 20, left: 40 },
    xScale: { type: 'point' },
    yScale: { type: 'linear', min: 'auto', max: 'auto' },
    axisBottom: {
      format: formatTimeLabel,
      tickRotation: 0,
      orient: "bottom",
      tickValues: (() => {
        const pts = (scatter?.[0]?.data || []);
        const N = pts.length;
        if (N === 0) return [];
        if (N < 4) return pts.filter(p => p && p.x !== undefined).map(p => p.x);
        const indices = [0, Math.floor(N * 0.33), Math.floor(N * 0.66), N - 1];
        return indices.map(i => pts[i]).filter(p => p && p.x !== undefined).map(p => p.x);
      })(),
      tickSize: 5, tickPadding: 5,
      axis: { strokeWidth: 1 }, line: { strokeWidth: 1 },
    },
    axisLeft: {
      orient: "left",
      tickValues: 3, tickSize: 5, tickPadding: 5, tickRotation: 0,
      axis: { strokeWidth: 1 }, line: { strokeWidth: 1 },
      legend: 'weight (g)', legendOffset: -35, legendPosition: 'middle',
    },
    theme: chartTheme,
    key: `scatter-chart-${theme.palette.mode}`,
    colors: () => tokens(theme.palette.mode).tealAccent[500],
    nodeSize: 3,
    useMesh: true,
    enableGridX: false, enableGridY: false,
    tooltip: ({ node }) => {
      if (!node || !node.data || node.data.x === undefined || node.data.y === undefined) return null;
      return (
        <Box sx={{ 
          background: isDark ? colors.primary[400] : colors.primary[100], 
          padding: '9px 12px',
          borderRadius: '4px',
          border: `1px solid ${tokens(theme.palette.mode).tealAccent[500]}`,
        }}>
          <Typography variant="body2" sx={{ color: isDark ? "#eee" : "#111" }}>
            {formatTimeLabel(node.data.x)}: {Number(node.data.y).toFixed(2)}g
          </Typography>
        </Box>
      );
    },
  };

  // visibility filtering (per-recipe + total)
  const visible = dashboardVisibleSeries || {};
  const filteredThroughput = sanitizeLineSeries([
    ...(throughput.series || []).filter(s => visible[s.id]),
    ...(visible["Total"] ? (throughput.total || []) : []),
  ]);
  const filteredGiveaway = sanitizeLineSeries([
    ...(giveaway.series || []).filter(s => visible[s.id]),
    ...(visible["Total"] ? (giveaway.total || []) : []),
  ]);
  const filteredPiecesProcessed = sanitizeLineSeries([
    ...(piecesProcessed.series || []).filter(s => visible[s.id]),
    ...(visible["Total"] ? (piecesProcessed.total || []) : []),
  ]);
  const filteredWeightProcessed = sanitizeLineSeries([
    ...(weightProcessed.series || []).filter(s => visible[s.id]),
    ...(visible["Total"] ? (weightProcessed.total || []) : []),
  ]);
  const filteredRejects = visible["Total"] ? sanitizeLineSeries(rejects) : [];

  // pies (kept 3 charts: total, give_g, give_pct)
  const pieBatchTotal = (pies.total || []).filter(s => visible[s.id]);
  const pieGiveG      = (pies.give_g || []).filter(s => visible[s.id]);
  const pieGivePct    = (pies.give_pct || []).filter(s => visible[s.id]);

  const batchTotalSum = Math.round(pieBatchTotal.reduce((s, d) => s + (Number(d.value) || 0), 0));
  const giveawayGramSum = Number(pieGiveG.reduce((s, d) => s + (Number(d.value) || 0), 0).toFixed(1));
  const giveawayPercentAvg = pieGivePct.length
    ? Number((pieGivePct.reduce((s, d) => s + (Number(d.value) || 0), 0) / pieGivePct.length).toFixed(1))
    : 0;

  const toggleSeries = (name) => setDashboardVisibleSeries(prev => ({ ...(prev || {}), [name]: !prev?.[name] }));

  return (
    <Box m="20px" height="calc(100vh - 200px)" maxHeight="calc(100vh - 200px)"
      sx={{ overflow: "visible", display: "flex", flexDirection: "column" }}>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb="20px" sx={{ m: "0px 0 0 0" }}>
        <Header title="Dashboard" subtitle="Performance Overview" />

        {/* Time Slider (Replay mode only) */}
        {MODE === "replay" && datasetStart && datasetEnd && currentTime && (
          <Box display="flex" alignItems="center" gap="12px" px="20px">
            <Box flex="0 0 300px" display="flex" flexDirection="column" gap="2px">
              <Typography variant="body2" color={colors.primary[700]} fontSize="10px">
                {new Date(currentTime).toLocaleString('en-US', { 
                  month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' 
                })}
              </Typography>
              <Slider
                value={sliderValue}
                min={datasetStart.getTime()}
                max={datasetEnd.getTime()}
                onChange={handleSliderChange}
                sx={{
                  color: colors.tealAccent[500],
                  '& .MuiSlider-thumb': {
                    width: 14,
                    height: 14,
                  },
                  '& .MuiSlider-track': {
                    height: 3,
                  },
                  '& .MuiSlider-rail': {
                    height: 3,
                    opacity: 0.3,
                  },
                }}
              />
            </Box>
          </Box>
        )}
      </Box>

      <Box
        display="grid"
        gridTemplateColumns="repeat(12, 1fr)"
        gridTemplateRows="repeat(12, 1fr)"
        gap="20px"
        sx={{ flex: 1, minHeight: 0, overflow: "hidden" }}
      >
        {/* Machine Image with overlays */}
        <Box gridColumn="1 / span 10" gridRow="1 / span 4"
          sx={{ backgroundColor: colors.primary[100], borderRadius: 1.5, overflow: "hidden", position: 'relative' }}>
          <AnnotatedMachineImage
            colorMap={colorMap}
            assignmentsByGate={assignmentsByGate}
            overlayByGate={overlayByGate}
          />
        </Box>

        {/* Row 2: Give-away, Rejects, and Piece Weight Distribution */}
        <Box gridColumn="1 / span 10" gridRow="5 / span 4" display="grid" gridTemplateColumns="repeat(3, 1fr)" gap="20px">
          {/* Give-away */}
          <Box sx={{ backgroundColor: colors.primary[100], borderRadius: 1.5, overflow: "hidden" }} p="15px">
            <Typography variant="h5" color={tokens(theme.palette.mode).tealAccent[500]}>Give-away</Typography>
            {filteredGiveaway.length > 0 ? (
              <ResponsiveLine
                data={filteredGiveaway}
                colors={serie => serie?.color || colors.primary[700]}
                {...giveawayProps}
              />
            ) : (
              <Box display="flex" alignItems="center" justifyContent="center" height="calc(100% - 30px)">
                <Typography variant="body2" color={colors.grey[500]}>No data</Typography>
              </Box>
            )}
          </Box>

          {/* Rejects KPIs */}
          <Box sx={{ backgroundColor: colors.primary[100], borderRadius: 1.5, overflow: "hidden", display: 'flex', flexDirection: 'column' }} p="15px">
            <Typography variant="h5" color={tokens(theme.palette.mode).tealAccent[500]} mb="10px">Rejects</Typography>
            <Box display="flex" flexDirection="row" gap="20px" flex="1" justifyContent="space-around" alignItems="center">
              {/* Total Rejects Count */}
              <Box 
                sx={{ 
                  flex: 1,
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'center',
                  alignItems: 'center'
                }}
              >
                <Typography variant="h7" color={colors.primary[900]} mb="8px">
                  TOTAL COUNT
                </Typography>
                <Typography variant="h2" color={colors.tealAccent[500]} fontWeight="bold" sx={{ lineHeight: 1 }}>
                  {(() => {
                    const latestData = rejects?.[0]?.data?.[rejects[0].data.length - 1];
                    return latestData?.total_rejects_count?.toLocaleString() || '0';
                  })()}
                </Typography>
                <Typography variant="body2" color={colors.primary[900]} mt="8px">
                  pieces
                </Typography>
              </Box>

              {/* Total Rejects Weight */}
              <Box 
                sx={{ 
                  flex: 1,
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'center',
                  alignItems: 'center'
                }}
              >
                <Typography variant="h7" color={colors.primary[900]}  mb="8px">
                  TOTAL WEIGHT
                </Typography>
                <Typography variant="h2" color={colors.tealAccent[500]} fontWeight="bold" sx={{ lineHeight: 1 }}>
                  {(() => {
                    const latestData = rejects?.[0]?.data?.[rejects[0].data.length - 1];
                    const weightKg = (latestData?.total_rejects_weight_g || 0) / 1000;
                    return weightKg.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
                  })()}
                </Typography>
                <Typography variant="body2" color={colors.primary[900]} mt="8px">
                  kg
                </Typography>
              </Box>
            </Box>
          </Box>

          {/* Piece Weight Distribution (Scatter) */}
          <Box sx={{ backgroundColor: colors.primary[100], borderRadius: 1.5, overflow: "hidden" }} p="15px">
            <Typography variant="h5" color={tokens(theme.palette.mode).tealAccent[500]}>Piece Weight Distribution</Typography>
            <Box sx={{ height: "calc(100% - 30px)", position: "relative" }}>
              {scatter && scatter.length > 0 && scatter[0]?.data?.length > 0 ? (
                <ResponsiveScatterPlot
                  data={scatter}
                  {...sharedScatterProps}
                />
              ) : (
                <Box display="flex" alignItems="center" justifyContent="center" height="100%">
                  <Typography variant="body2" color={colors.grey[500]}>
                    No data available
                  </Typography>
                </Box>
              )}
            </Box>
          </Box>
        </Box>

        {/* Line charts */}
        <Box gridColumn="1 / span 10" gridRow="9 / span 4" display="grid" gridTemplateColumns="repeat(3, 1fr)" gap="20px">
          <Box sx={{ backgroundColor: colors.primary[100], borderRadius: 1.5, overflow: "hidden" }} p="15px">
            <Typography variant="h5" color={tokens(theme.palette.mode).tealAccent[500]}>Batches Processed</Typography>
            {filteredThroughput.length > 0 ? (
              <ResponsiveLine
                data={filteredThroughput}
                colors={serie => serie?.color || colors.primary[700]}
                {...throughputProps}
              />
            ) : (
              <Box display="flex" alignItems="center" justifyContent="center" height="calc(100% - 30px)">
                <Typography variant="body2" color={colors.grey[500]}>No data</Typography>
              </Box>
            )}
          </Box>
          <Box sx={{ backgroundColor: colors.primary[100], borderRadius: 1.5, overflow: "hidden" }} p="15px">
            <Typography variant="h5" color={tokens(theme.palette.mode).tealAccent[500]}>Pieces Processed</Typography>
            {filteredPiecesProcessed.length > 0 ? (
              <ResponsiveLine
                data={filteredPiecesProcessed}
                colors={serie => serie?.color || colors.primary[700]}
                {...piecesProcessedProps}
              />
            ) : (
              <Box display="flex" alignItems="center" justifyContent="center" height="calc(100% - 30px)">
                <Typography variant="body2" color={colors.grey[500]}>No data</Typography>
              </Box>
            )}
          </Box>
          <Box sx={{ backgroundColor: colors.primary[100], borderRadius: 1.5, overflow: "hidden" }} p="15px">
            <Typography variant="h5" color={tokens(theme.palette.mode).tealAccent[500]}>Weight Processed</Typography>
            {filteredWeightProcessed.length > 0 ? (
              <ResponsiveLine
                data={filteredWeightProcessed}
                colors={serie => serie?.color || colors.primary[700]}
                {...weightProcessedProps}
              />
            ) : (
              <Box display="flex" alignItems="center" justifyContent="center" height="calc(100% - 30px)">
                <Typography variant="body2" color={colors.grey[500]}>No data</Typography>
              </Box>
            )}
          </Box>
        </Box>

        {/* Right column: Legend + Pies (4 rows) */}
        <Box gridColumn="11 / span 2" gridRow="1 / span 12" display="grid" gridTemplateRows="auto 1fr 1fr 1fr" gap="10px">
          {/* Legend row */}
          <Box sx={{ backgroundColor: colors.primary[100], borderRadius: 1.5, overflow: "hidden", display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "flex-start", gap: "8px" }} p="10px">
            {legendKeys.map((name) => (
              <Box
                key={name}
                display="flex" alignItems="center" gap="6px"
                onClick={() => toggleSeries(name)}
                sx={{
                  cursor: 'pointer',
                  opacity: (dashboardVisibleSeries?.[name] ?? true) ? 1 : 0.4,
                  transition: 'all 0.2s',
                  '&:hover': { transform: 'scale(1.05)' },
                  border: (dashboardVisibleSeries?.[name] ?? true) ? 'none' : `1px solid ${colors.grey[300]}`,
                  borderRadius: '4px',
                  padding: '4px 8px',
                }}
              >
                <Box width="10px" height="10px" borderRadius="50%" sx={{ backgroundColor: colorMap[name] || colors.primary[700] }} />
                <Typography variant="body2" fontSize="11px" color={colors.primary[800]}>{formatRecipeName(name)}</Typography>
              </Box>
            ))}
          </Box>

          {/* Batch total */}
          <Box sx={{ backgroundColor: colors.primary[100], borderRadius: 1.5, overflow: "hidden", display: "flex", flexDirection: "column" }} p="15px">
            <Typography variant="h5" color={tokens(theme.palette.mode).tealAccent[500]}>Batch total</Typography>
            <Typography variant="h6" color={colors.primary[800]} sx={{ mb: "-10px" }}>Sum : {batchTotalSum}</Typography>
            <Box sx={{ height: "calc(100%)", position: "relative", overflow: "hidden" }}>
              {pieBatchTotal.length > 0 ? (
                <ResponsivePie data={pieBatchTotal} {...sharedPieProps} />
              ) : (
                <Box display="flex" alignItems="center" justifyContent="center" height="100%">
                  <Typography variant="body2" color={colors.grey[500]}>No data</Typography>
                </Box>
              )}
            </Box>
          </Box>

          {/* Give-away (g/batch) */}
          <Box sx={{ backgroundColor: colors.primary[100], borderRadius: 1.5, overflow: "hidden", display: "flex", flexDirection: "column" }} p="15px">
            <Typography variant="h5" color={tokens(theme.palette.mode).tealAccent[500]}>Give-away (g/batch)</Typography>
            <Typography variant="h6" color={colors.primary[800]} sx={{ mb: "-10px" }}>Sum : {giveawayGramSum}</Typography>
            <Box sx={{ height: "calc(100%)", position: "relative", overflow: "hidden" }}>
              {pieGiveG.length > 0 ? (
                <ResponsivePie data={pieGiveG} {...sharedPieProps} />
              ) : (
                <Box display="flex" alignItems="center" justifyContent="center" height="100%">
                  <Typography variant="body2" color={colors.grey[500]}>No data</Typography>
                </Box>
              )}
            </Box>
          </Box>

          {/* Give-away (%) */}
          <Box sx={{ backgroundColor: colors.primary[100], borderRadius: 1.5, overflow: "hidden", display: "flex", flexDirection: "column" }} p="15px">
            <Typography variant="h5" color={tokens(theme.palette.mode).tealAccent[500]}>Give-away (%)</Typography>
            <Typography variant="h6" color={colors.primary[800]} sx={{ mb: "-10px" }}>Avg : {giveawayPercentAvg}</Typography>
            <Box sx={{ height: "calc(100%)", position: "relative", overflow: "hidden" }}>
              {pieGivePct.length > 0 ? (
                <ResponsivePie data={pieGivePct} {...sharedPieProps} />
              ) : (
                <Box display="flex" alignItems="center" justifyContent="center" height="100%">
                  <Typography variant="body2" color={colors.grey[500]}>No data</Typography>
                </Box>
              )}
            </Box>
          </Box>
        </Box>
      </Box>
    </Box>
  );
};

export default Dashboard;