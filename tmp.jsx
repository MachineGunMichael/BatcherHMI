import React, { useState, useEffect, useMemo } from "react";
import { Box, useTheme, Typography } from "@mui/material";
import { ResponsiveLine } from "@nivo/line";
import { ResponsivePie } from "@nivo/pie";
import { ResponsiveScatterPlot } from "@nivo/scatterplot";
import { tokens } from "../../theme";
import Header from "../../components/Header";
import mockData from "../../data/mockData_json4.json";

// Annotated machine image with per-gate overlay
const AnnotatedMachineImage = ({ colorMap, gateData }) => {
  const theme = useTheme();
  const colors = tokens(theme.palette.mode);

  const annotationPositions = [
    { gate: 1, x1: '50%', y1: '10%', x2: '70%', y2: '5%', program: 'Program A' },
    { gate: 2, x1: '70%', y1: '20%', x2: '90%', y2: '15%', program: 'Program A' },
    { gate: 3, x1: '80%', y1: '30%', x2: '95%', y2: '35%', program: 'Program C' },
    { gate: 4, x1: '70%', y1: '40%', x2: '90%', y2: '50%', program: 'Program D' },
    { gate: 5, x1: '60%', y1: '55%', x2: '85%', y2: '65%', program: 'Program A' },
    { gate: 6, x1: '50%', y1: '65%', x2: '75%', y2: '75%', program: 'Program B' },
    { gate: 7, x1: '40%', y1: '75%', x2: '65%', y2: '85%', program: 'Program C' },
    { gate: 8, x1: '30%', y1: '85%', x2: '60%', y2: '95%', program: 'Program B' },
  ];

  return (
    <Box sx={{ position: 'relative', width: '100%', height: '100%' }}>
      <img
        alt="machine"
        width="90%"
        style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          maxHeight: '80%'
        }}
        src="../../assets/Marelec_Grader_8.png"
      />
      <Box
        component="svg"
        sx={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
      >
        {annotationPositions.map((pos, idx) => {
          const midX = `calc(${pos.x1} + ${(parseFloat(pos.x2) - parseFloat(pos.x1)) * 0.6}%)`;
          return (
            <React.Fragment key={idx}>
              <line x1={pos.x1} y1={pos.y1} x2={midX} y2={pos.y1} stroke={colorMap[pos.program]} strokeWidth={2} />
              <line x1={midX} y1={pos.y1} x2={pos.x2} y2={pos.y2} stroke={colorMap[pos.program]} strokeWidth={2} />
            </React.Fragment>
          );
        })}
      </Box>

      {annotationPositions.map((pos, idx) => {
        // pick correct gate record (array or object)
        const info = gateData
          ? Array.isArray(gateData)
            ? gateData[pos.gate - 1]
            : gateData[pos.gate]
          : {};
        const pieces = info.pieces ?? 0;
        const sumGrams = info.sumGrams ?? 0;

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
              border: `1px solid ${colorMap[pos.program]}`,
              width: '100px',
              boxShadow: 3,
              overflow: 'hidden',
            }}
          >
            <Box sx={{ backgroundColor: colorMap[pos.program], py: 0.1, px: 0.5, textAlign: 'left' }}>
              <Typography variant="body2" color="#fff">
                G{pos.gate}: {pos.program}
              </Typography>
            </Box>
            <Box sx={{ p: 0.5 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', borderBottom: `1px solid ${colors.grey[300]}`, py: 0.1 }}>
                <Typography variant="body2" color={colors.primary[800]} fontWeight="bold">
                  Pieces:
                </Typography>
                <Typography variant="body2" color={colors.primary[800]}> {pieces} </Typography>
              </Box>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', py: 0.1 }}>
                <Typography variant="body2" color={colors.primary[800]} fontWeight="bold">
                  Gram:
                </Typography>
                <Typography variant="body2" color={colors.primary[800]}> {sumGrams.toFixed(1)} </Typography>
              </Box>
            </Box>
          </Box>
        );
      })}
    </Box>
  );
};

const Dashboard = () => {
  const theme = useTheme();
  const colors = tokens(theme.palette.mode);
  const isDarkMode = theme.palette.mode === 'dark';

  const chartTheme = {
    axis: {
      domain: {
        line: {
          stroke: isDarkMode ? colors.primary[800] : colors.primary[800],
          strokeWidth: 1,
        },
      },
      legend: {
        text: {
          fill: isDarkMode ? colors.primary[800] : colors.primary[800],
        },
      },
      ticks: {
        line: {
          stroke: isDarkMode ? colors.primary[800] : colors.primary[800] ,
          strokeWidth: 1,
        },
        text: {
          fill: isDarkMode ? colors.primary[800] : colors.primary[800],
          fontSize: 11,
        },
      },
    },
    grid: {
      line: {
        stroke: isDarkMode ? colors.primary[800] : colors.primary[800],
        strokeWidth: 1,
      },
    },
    legends: {
      text: {
        fill: isDarkMode ? colors.primary[800] : colors.primary[800],
      },
    },
    tooltip: {
      container: {
        background: isDarkMode ? colors.primary[400] : colors.primary[100],
        color: isDarkMode ? colors.grey[100] : colors.grey[900],
      },
    },
  };

  const {
    timestamps,
    throughput,
    throughput_sum,
    rejects,
    giveaway,
    pie_batch_per_min,
    pie_batch_total,
    pie_giveaway_percent,
    pie_giveaway_gram_batch,
    scatter_distribution
  } = mockData;
  const totalPoints = timestamps.length;
  const windowSize = 60;
  const [index, setIndex] = useState(windowSize - 1);

  // define which program each gate runs, and its caps
  const gateMapping = {
    1: 'Program A', 2: 'Program A', 3: 'Program B', 4: 'Program D',
    5: 'Program B', 6: 'Program A', 7: 'Program C', 8: 'Program C'
  };
  const programLimits = {
    'Program A': { maxPieces: 10, maxGram: 100 },
    'Program B': { maxPieces: 3, maxGram: 200 },
    'Program C': { maxPieces: 4, maxGram: 150 },
    'Program D': { maxPieces: 8, maxGram: 150 },
  };

  // simulate each gate's (pieces, sumGrams) over time
  const gateSimulation = useMemo(() => {
    const sim = [];
    const state = {};
    for (let g = 1; g <= 8; g++) state[g] = { pieces: 0, sumGrams: 0 };

    for (let t = 0; t < totalPoints; t++) {
      const snapshot = {};
      for (let g = 1; g <= 8; g++) {
        const prog = gateMapping[g];
        const { maxPieces, maxGram } = programLimits[prog];
        const prev = state[g].pieces;
        const nextPieces = prev + 1 > maxPieces ? 0 : prev + 1;
        let sum = 0;
        for (let i = 0; i < nextPieces; i++) sum += Math.random() * maxGram;

        state[g] = { pieces: nextPieces, sumGrams: sum };
        snapshot[g] = state[g];
      }
      sim.push(snapshot);
    }
    return sim;
  }, [totalPoints]);

  useEffect(() => {
    const iv = setInterval(() => setIndex(i => (i + 1) % totalPoints), 2000);
    return () => clearInterval(iv);
  }, [totalPoints]);

  const isWrapped = index < windowSize - 1;
  const windowTimestamps = isWrapped
    ? timestamps.slice(0, windowSize)
    : timestamps.slice(index - (windowSize - 1), index + 1);
  const windowData = arr =>
    isWrapped ? arr.slice(0, windowSize) : arr.slice(index - (windowSize - 1), index + 1);

  const colorMap = useMemo(() => ({
    "Program A": colors.tealAccent[500],
    "Program B": colors.redAccent[500],
    "Program C": colors.purpleAccent[500],
    "Program D": colors.orangeAccent[500],
    Total: colors.beigeAccent[400],
  }), [
    colors.tealAccent,
    colors.redAccent,
    colors.purpleAccent,
    colors.orangeAccent,
    colors.beigeAccent,
  ]);

  const throughputData = useMemo(() => {
    const series = Object.entries(throughput).map(([prog, arr]) => ({
      id: prog,
      color: colorMap[prog],
      data: windowTimestamps.map((t, i) => ({ x: t, y: windowData(arr)[i] })),
    }));
    series.push({
      id: "Total",
      color: colorMap.Total,
      data: windowTimestamps.map((t, i) => ({ x: t, y: windowData(throughput_sum)[i] })),
    });
    return series;
  }, [throughput, throughput_sum, windowTimestamps, index, colorMap]);

  const giveawayData = useMemo(() =>
    Object.entries(giveaway).map(([prog, arr]) => ({
      id: prog,
      color: colorMap[prog],
      data: windowTimestamps.map((t, i) => ({ x: t, y: windowData(arr)[i] })),
    })),
    [giveaway, windowTimestamps, index, colorMap]
  );

  const rejectsData = useMemo(() => {
    return [{
      id: "Total",
      color: colorMap.Total,
      data: windowTimestamps.map((t, i) => ({
        x: t,
        y: windowData(rejects)[i],
      })),
    }];
  }, [rejects, windowTimestamps, index, colorMap]);

  const batchPerMinData = useMemo(
    () =>
      pie_batch_per_min[index].map(d => ({
        id: d.program,
        value: d.value,
        color: colorMap[d.program],
      })),
    [pie_batch_per_min, index, colorMap]
  );
  const batchTotalData = useMemo(
    () =>
      pie_batch_total[index].map(d => ({
        id: d.program,
        value: d.value,
        color: colorMap[d.program],
      })),
    [pie_batch_total, index, colorMap]
  );
  const giveawayPercentData = useMemo(
    () =>
      pie_giveaway_percent[index].map(d => ({
        id: d.program,
        value: d.value,
        color: colorMap[d.program],
      })),
    [pie_giveaway_percent, index, colorMap]
  );
  const giveawayGramData = useMemo(
    () =>
      pie_giveaway_gram_batch[index].map(d => ({
        id: d.program,
        value: d.value,
        color: colorMap[d.program],
      })),
    [pie_giveaway_gram_batch, index, colorMap]
  );

  const scatterData = useMemo(() => {
    const currentDate = new Date(timestamps[index]);
    const oneHourAgo = new Date(currentDate.getTime() - 3600 * 1000);
  
    const pts = scatter_distribution
      .filter(d => {
        const t = new Date(d.timestamp);
        return t >= oneHourAgo && t <= currentDate;
      })
      .map(d => ({
        x: d.timestamp,
        y: Number(d.weight),
      }));
  
    return [
      {
        id: "Pieces",
        data: pts,
      },
    ];
  }, [scatter_distribution, timestamps, index]);

  const formatTimeLabel = (timestamp) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { 
      hour: '2-digit', 
      minute: '2-digit',
      hour12: false
    });
  };

  const batchPerMinSum = useMemo(() => {
    return batchPerMinData.reduce((sum, item) => sum + item.value, 0);
  }, [batchPerMinData]);

  const batchTotalSum = useMemo(() => {
    return batchTotalData.reduce((sum, item) => sum + item.value, 0);
  }, [batchTotalData]);

  const giveawayGramSum = useMemo(() => {
    const sum = giveawayGramData.reduce((sum, item) => sum + item.value, 0);
    return Number(sum.toFixed(1));
  }, [giveawayGramData]);

  const giveawayPercentAvg = useMemo(() => {
    if (giveawayPercentData.length === 0) return 0;
    const sum = giveawayPercentData.reduce((sum, item) => sum + item.value, 0);
    return Number((sum / giveawayPercentData.length).toFixed(1));
  }, [giveawayPercentData]);

  const sharedLineProps = {
    margin: { top: 10, right: 20, bottom: 50, left: 40 },
    xScale: { type: 'point' },
    yScale: { type: 'linear', min: 'auto', max: 'auto' },
    curve: 'basis',
    enableArea: false,
    useMesh: true,
    axisTop: null,
    axisRight: null,
    pointSize: 0,
    pointColor: { theme: 'background' },
    pointBorderWidth: 2,
    pointBorderColor: { from: 'serieColor' },
    pointLabel: 'yFormatted',
    pointLabelYOffset: -12,
    axisBottom: {
      format: formatTimeLabel,
      tickRotation: 0,
      orient: "bottom",
      tickValues: (() => {
        const firstIndex = 0;
        const lastIndex = windowTimestamps.length - 1;
        const oneThirdIndex = Math.floor(lastIndex / 3);
        const twoThirdsIndex = Math.floor(2 * lastIndex / 3);
        
        return [
          windowTimestamps[firstIndex], 
          windowTimestamps[oneThirdIndex], 
          windowTimestamps[twoThirdsIndex], 
          windowTimestamps[lastIndex]
        ];
      })(),
      tickSize: 5,
      tickPadding: 5,
      axis: { 
        strokeWidth: 1 
      },
      line: { 
        strokeWidth: 1 
      },
    },
    axisLeft: {
      orient: "left",
      tickValues: 3,
      tickSize: 5,
      tickPadding: 5,
      tickRotation: 0,
      axis: { 
        strokeWidth: 1 
      },
      line: { 
        strokeWidth: 1 
      },
      legend: '',
      legendOffset: -35,
      legendPosition: 'middle',
    },
    theme: chartTheme,
    key: `line-chart-${theme.palette.mode}`,
    enableGridX: false,
    enableGridY: false,
  };

  const sharedPieProps = {
    margin: { top: 10, right: 10, bottom: 0, left: 10 },
    innerRadius: 0.75,
    padAngle: 3,
    cornerRadius: 3,
    activeOuterRadiusOffset: 8,
    borderWidth: 1,
    borderColor: { from: 'color', modifiers: [[ 'darker', 0.2 ]] },
    enableArcLinkLabels: false,
    arcLinkLabelsSkipAngle: 10,
    arcLinkLabelsTextColor: "#333333",
    arcLinkLabelsThickness: 2,
    arcLinkLabelsColor: { from: 'color' },
    arcLabelsSkipAngle: 10,
    arcLabelsTextColor: { theme: 'labels.text.fill' },
    valueFormat: ">-.0f",
    colors: ({ id }) => colorMap[id],
    theme: {
      labels: {
        text: {
          fill: tokens('dark').primary[900],
        },
      },
    }
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
        if (!scatterData[0] || !scatterData[0].data || scatterData[0].data.length === 0) {
          return [];
        }
        
        const dataPoints = scatterData[0].data;
        const totalPoints = dataPoints.length;
        
        if (totalPoints < 4) {
          return dataPoints.map(d => d.x);
        }
        
        return [
          dataPoints[0].x, 
          dataPoints[Math.floor(totalPoints * 0.33)].x, 
          dataPoints[Math.floor(totalPoints * 0.66)].x, 
          dataPoints[totalPoints - 1].x
        ];
      })(),
      tickSize: 5,
      tickPadding: 5,
      axis: { 
        strokeWidth: 1 
      },
      line: { 
        strokeWidth: 1 
      },
    },
    axisLeft: { 
      orient: "left",
      tickValues: 3,
      tickSize: 5,
      tickPadding: 5,
      tickRotation: 0,
      axis: { 
        strokeWidth: 1 
      },
      line: { 
        strokeWidth: 1 
      },
      legend: 'weight (g)',
      legendOffset: -35,
      legendPosition: 'middle',
    },
    theme: chartTheme,
    key: `scatter-chart-${theme.palette.mode}`,
    colors: () => colors.tealAccent[500],
    nodeSize: 3,
    useMesh: true,
    enableGridX: false,
    enableGridY: false,
  };

  const throughputProps = {
    ...sharedLineProps,
    axisLeft: {
      ...sharedLineProps.axisLeft,
      legend: 'batch / min',
    }
  };

  const giveawayProps = {
    ...sharedLineProps,
    axisLeft: {
      ...sharedLineProps.axisLeft,
      legend: '%',
    }
  };
  
  const rejectsProps = {
    ...sharedLineProps,
    axisLeft: {
      ...sharedLineProps.axisLeft,
      legend: 'piece / min',
    },
    enableArea: true,
    areaBaselineValue: 0,
    yScale: { 
      type: 'linear', 
      min: 0, 
      max: 'auto' 
    }
  };

  return(
    <Box 
      m="20px" 
      height="calc(100vh - 200px)" 
      maxHeight="calc(100vh - 200px)" 
      sx={{ 
        overflow: "visible",
        display: "flex",
        flexDirection: "column"
      }}
    > 
      <Box display="flex" justifyContent="space-between" alignItems="center" mb="20px" sx={{ m: "0px 0 0 0" }} >
        <Header title="Dashboard" subtitle="Performance Overview" />
        
        <Box 
          display="flex" 
          alignItems="center"
          justifyContent="flex-end"
          gap="20px"
          mr="20px"
        >
          {Object.entries(colorMap).map(([program, color]) => (
            <Box 
              key={program}
              display="flex" 
              alignItems="center" 
              gap="5px"
            >
              <Box 
                width="12px" 
                height="12px" 
                borderRadius="50%" 
                sx={{ backgroundColor: color }} 
              />
              <Typography variant="h7" color={colors.primary[800]}>
                {program}
              </Typography>
            </Box>
          ))}
        </Box>
      </Box>

      <Box
        display="grid"
        gridTemplateColumns="repeat(12, 1fr)"
        gridTemplateRows="repeat(3, 1fr)"
        gap="20px"
        sx={{
          flex: 1,
          minHeight: 0,
          overflow: "hidden"
        }}
      >
        <Box gridColumn="1 / span 3" gridRow="1 / span 3" sx={{ position: 'relative', overflow: 'hidden' }}>
          <AnnotatedMachineImage colorMap={colorMap} gateData={gateSimulation[index]} />
        </Box>

        <Box
          gridColumn="4 / span 9"
          gridRow="1 / span 1"
          display="grid"
          gridTemplateColumns="repeat(3, 1fr)"
          gap="20px"
          sx={{ minHeight: 0 }}
        >
          <Box sx={{ backgroundColor: colors.primary[100], borderRadius: 1.5, overflow: "hidden"}} p="15px">
            <Typography
                variant="h5"
                color={colors.tealAccent[500]}
              >
                Throughput
            </Typography>
            <ResponsiveLine
              data={throughputData}
              colors={d => d.color}
              theme={chartTheme}
              key={`throughput-${theme.palette.mode}`}
              {...throughputProps}
            />
          </Box>
          <Box sx={{ backgroundColor: colors.primary[100], borderRadius: 1.5, overflow: "hidden"}} p="15px">
            <Typography
                variant="h5"
                color={colors.tealAccent[500]}
              >
                Give-away
            </Typography>
            <ResponsiveLine
              data={giveawayData}
              colors={d => d.color}
              theme={chartTheme}
              key={`giveaway-${theme.palette.mode}`}
              {...giveawayProps}
            />
          </Box>
          <Box sx={{ backgroundColor: colors.primary[100], borderRadius: 1.5, overflow: "hidden"}} p="15px">
            <Typography
                variant="h5"
                color={colors.tealAccent[500]}
              >
                Rejects
            </Typography>
            <ResponsiveLine
              data={rejectsData}
              colors={d => d.color}
              theme={chartTheme}
              key={`rejects-${theme.palette.mode}`}
              {...rejectsProps}
            />
          </Box>
        </Box>

        <Box
          gridColumn="4 / span 9"
          gridRow="2 / span 1"
          display="grid"
          gridTemplateColumns="repeat(4, 1fr)"
          gap="20px"
          height="100%"
          sx={{
            flex: 1,
            minHeight: 0,
            overflow: "hidden"
          }}
        >
          <Box sx={{ 
            backgroundColor: colors.primary[100], 
            borderRadius: 1.5, 
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
            height: "100%"
          }} p="15px">
            <Typography
                variant="h5"
                color={colors.tealAccent[500]}
              >
                Batch per min
            </Typography>

            <Typography
                variant="h6"
                color={colors.primary[800]}
              >
                Sum : {Math.round(batchPerMinSum)}
            </Typography>
          
            <Box sx={{ 
              height: "85%",
              position: "relative"
            }}>
              <ResponsivePie
                data={batchPerMinData}
                {...sharedPieProps}
              />
            </Box>
          </Box>

          <Box sx={{ 
            backgroundColor: colors.primary[100], 
            borderRadius: 1.5, 
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
            height: "100%"
          }} p="15px">
            <Typography
                variant="h5"
                color={colors.tealAccent[500]}
              >
                Batch total
            </Typography>

            <Typography
                variant="h6"
                color={colors.primary[800]}
              >
                Sum : {Math.round(batchTotalSum)}
            </Typography>
          
            <Box sx={{ 
              height: "85%",
              position: "relative"
            }}>
              <ResponsivePie
                data={batchTotalData}
                {...sharedPieProps}
              />
            </Box>
          </Box>

          <Box sx={{ 
            backgroundColor: colors.primary[100], 
            borderRadius: 1.5, 
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
            height: "100%"
          }} p="15px">
            <Typography
                variant="h5"
                color={colors.tealAccent[500]}
              >
                Give-away (g/batch)
            </Typography>

            <Typography
                variant="h6"
                color={colors.primary[800]}
              >
                Sum : {giveawayGramSum}
            </Typography>
          
            <Box sx={{ 
              height: "85%",
              position: "relative"
            }}>
              <ResponsivePie
                data={giveawayGramData}
                {...sharedPieProps}
              />
            </Box>
          </Box>

          <Box sx={{ 
            backgroundColor: colors.primary[100], 
            borderRadius: 1.5, 
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
            height: "100%"
          }} p="15px">
            <Typography
                variant="h5"
                color={colors.tealAccent[500]}
              >
                Give-away (%)
            </Typography>

            <Typography
                variant="h6"
                color={colors.primary[800]}
              >
                Avg : {giveawayPercentAvg}
            </Typography>
          
            <Box sx={{ 
              height: "85%",
              position: "relative"
            }}>
              <ResponsivePie
                data={giveawayPercentData}
                {...sharedPieProps}
              />
            </Box>
          </Box>

        </Box>

        <Box
          gridColumn="4 / span 9"
          gridRow="3 / span 1"
          sx={{
            backgroundColor: colors.primary[100],
            p: "15px",
            height: "100%",
            minHeight: 0,
            overflow: "hidden",
          }}
        >
          <Typography variant="h5" color={colors.tealAccent[500]} mb="10px">
            Piece Weight Distribution
          </Typography>
          <Box sx={{ height: "calc(100% - 40px)", position: "relative" }}>
            <ResponsiveScatterPlot
              data={scatterData}
              theme={chartTheme}
              key={`scatter-${theme.palette.mode}`}
              {...sharedScatterProps}
            />
          </Box>
        </Box>
      </Box>
    </Box>
  );
};

export default Dashboard;





import React, { useState, useEffect, useMemo } from "react";
import { Box, useTheme, Typography } from "@mui/material";
import { ResponsiveLine } from "@nivo/line";
import { ResponsivePie } from "@nivo/pie";
import { ResponsiveScatterPlot } from "@nivo/scatterplot";
import { tokens } from "../../theme";
import Header from "../../components/Header";
import mockData from "../../data/mockData_json4.json";

// Annotated machine image with per-gate overlay
const AnnotatedMachineImage = ({ colorMap, gateData }) => {
  const theme = useTheme();
  const colors = tokens(theme.palette.mode);

  const annotationPositions = [
    { gate: 1, x1: '50%', y1: '10%', x2: '70%', y2: '5%', program: 'Program A' },
    { gate: 2, x1: '70%', y1: '20%', x2: '90%', y2: '15%', program: 'Program A' },
    { gate: 3, x1: '80%', y1: '30%', x2: '95%', y2: '35%', program: 'Program C' },
    { gate: 4, x1: '70%', y1: '40%', x2: '90%', y2: '50%', program: 'Program D' },
    { gate: 5, x1: '60%', y1: '55%', x2: '85%', y2: '65%', program: 'Program A' },
    { gate: 6, x1: '50%', y1: '65%', x2: '75%', y2: '75%', program: 'Program B' },
    { gate: 7, x1: '40%', y1: '75%', x2: '65%', y2: '85%', program: 'Program C' },
    { gate: 8, x1: '30%', y1: '85%', x2: '60%', y2: '95%', program: 'Program B' },
  ];

  return (
    <Box sx={{ position: 'relative', width: '100%', height: '100%' }}>
      <img
        alt="machine"
        width="90%"
        style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          maxHeight: '80%'
        }}
        src="../../assets/Marelec_Grader_8.png"
      />
      <Box
        component="svg"
        sx={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
      >
        {annotationPositions.map((pos, idx) => {
          const midX = `calc(${pos.x1} + ${(parseFloat(pos.x2) - parseFloat(pos.x1)) * 0.6}%)`;
          return (
            <React.Fragment key={idx}>
              <line x1={pos.x1} y1={pos.y1} x2={midX} y2={pos.y1} stroke={colorMap[pos.program]} strokeWidth={2} />
              <line x1={midX} y1={pos.y1} x2={pos.x2} y2={pos.y2} stroke={colorMap[pos.program]} strokeWidth={2} />
            </React.Fragment>
          );
        })}
      </Box>

      {annotationPositions.map((pos, idx) => {
        // pick correct gate record (array or object)
        const info = gateData
          ? Array.isArray(gateData)
            ? gateData[pos.gate - 1]
            : gateData[pos.gate]
          : {};
        const pieces = info.pieces ?? 0;
        const sumGrams = info.sumGrams ?? 0;

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
              border: `1px solid ${colorMap[pos.program]}`,
              width: '100px',
              boxShadow: 3,
              overflow: 'hidden',
            }}
          >
            <Box sx={{ backgroundColor: colorMap[pos.program], py: 0.1, px: 0.5, textAlign: 'left' }}>
              <Typography variant="body2" color="#fff">
                G{pos.gate}: {pos.program}
              </Typography>
            </Box>
            <Box sx={{ p: 0.5 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', borderBottom: `1px solid ${colors.grey[300]}`, py: 0.1 }}>
                <Typography variant="body2" color={colors.primary[800]} fontWeight="bold">
                  Pieces:
                </Typography>
                <Typography variant="body2" color={colors.primary[800]}> {pieces} </Typography>
              </Box>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', py: 0.1 }}>
                <Typography variant="body2" color={colors.primary[800]} fontWeight="bold">
                  Gram:
                </Typography>
                <Typography variant="body2" color={colors.primary[800]}> {sumGrams.toFixed(1)} </Typography>
              </Box>
            </Box>
          </Box>
        );
      })}
    </Box>
  );
};

const Dashboard = () => {
  const theme = useTheme();
  const colors = tokens(theme.palette.mode);
  const isDarkMode = theme.palette.mode === 'dark';

  // Add state to track visible series
  const [visibleSeries, setVisibleSeries] = useState({
    "Program A": true,
    "Program B": true,
    "Program C": true,
    "Program D": true,
    "Total": true
  });

  // Toggle visibility of a series
  const toggleSeries = (program) => {
    setVisibleSeries(prev => ({
      ...prev,
      [program]: !prev[program]
    }));
  };

  const chartTheme = {
    axis: {
      domain: {
        line: {
          stroke: isDarkMode ? colors.primary[800] : colors.primary[800],
          strokeWidth: 1,
        },
      },
      legend: {
        text: {
          fill: isDarkMode ? colors.primary[800] : colors.primary[800],
        },
      },
      ticks: {
        line: {
          stroke: isDarkMode ? colors.primary[800] : colors.primary[800] ,
          strokeWidth: 1,
        },
        text: {
          fill: isDarkMode ? colors.primary[800] : colors.primary[800],
          fontSize: 11,
        },
      },
    },
    grid: {
      line: {
        stroke: isDarkMode ? colors.primary[800] : colors.primary[800],
        strokeWidth: 1,
      },
    },
    legends: {
      text: {
        fill: isDarkMode ? colors.primary[800] : colors.primary[800],
      },
    },
    tooltip: {
      container: {
        background: isDarkMode ? colors.primary[400] : colors.primary[100],
        color: isDarkMode ? colors.grey[100] : colors.grey[900],
      },
    },
  };

  const {
    timestamps,
    throughput,
    throughput_sum,
    rejects,
    giveaway,
    pie_batch_per_min,
    pie_batch_total,
    pie_giveaway_percent,
    pie_giveaway_gram_batch,
    scatter_distribution
  } = mockData;
  const totalPoints = timestamps.length;
  const windowSize = 60;
  const [index, setIndex] = useState(windowSize - 1);

  // define which program each gate runs, and its caps
  const gateMapping = {
    1: 'Program A', 2: 'Program A', 3: 'Program B', 4: 'Program D',
    5: 'Program B', 6: 'Program A', 7: 'Program C', 8: 'Program C'
  };
  const programLimits = {
    'Program A': { maxPieces: 10, maxGram: 100 },
    'Program B': { maxPieces: 3, maxGram: 200 },
    'Program C': { maxPieces: 4, maxGram: 150 },
    'Program D': { maxPieces: 8, maxGram: 150 },
  };

  // simulate each gate's (pieces, sumGrams) over time
  const gateSimulation = useMemo(() => {
    const sim = [];
    const state = {};
    for (let g = 1; g <= 8; g++) state[g] = { pieces: 0, sumGrams: 0 };

    for (let t = 0; t < totalPoints; t++) {
      const snapshot = {};
      for (let g = 1; g <= 8; g++) {
        const prog = gateMapping[g];
        const { maxPieces, maxGram } = programLimits[prog];
        const prev = state[g].pieces;
        const nextPieces = prev + 1 > maxPieces ? 0 : prev + 1;
        let sum = 0;
        for (let i = 0; i < nextPieces; i++) sum += Math.random() * maxGram;

        state[g] = { pieces: nextPieces, sumGrams: sum };
        snapshot[g] = state[g];
      }
      sim.push(snapshot);
    }
    return sim;
  }, [totalPoints]);

  useEffect(() => {
    const iv = setInterval(() => setIndex(i => (i + 1) % totalPoints), 2000);
    return () => clearInterval(iv);
  }, [totalPoints]);

  const isWrapped = index < windowSize - 1;
  const windowTimestamps = isWrapped
    ? timestamps.slice(0, windowSize)
    : timestamps.slice(index - (windowSize - 1), index + 1);
  const windowData = arr =>
    isWrapped ? arr.slice(0, windowSize) : arr.slice(index - (windowSize - 1), index + 1);

  const colorMap = useMemo(() => ({
    "Program A": colors.tealAccent[500],
    "Program B": colors.redAccent[500],
    "Program C": colors.purpleAccent[500],
    "Program D": colors.orangeAccent[500],
    Total: colors.beigeAccent[400],
  }), [
    colors.tealAccent,
    colors.redAccent,
    colors.purpleAccent,
    colors.orangeAccent,
    colors.beigeAccent,
  ]);

  // Filter data based on visible series
  const throughputData = useMemo(() => {
    const series = Object.entries(throughput)
      .filter(([prog]) => visibleSeries[prog])
      .map(([prog, arr]) => ({
        id: prog,
        color: colorMap[prog],
        data: windowTimestamps.map((t, i) => ({ x: t, y: windowData(arr)[i] })),
      }));
    
    if (visibleSeries["Total"]) {
      series.push({
        id: "Total",
        color: colorMap.Total,
        data: windowTimestamps.map((t, i) => ({ x: t, y: windowData(throughput_sum)[i] })),
      });
    }
    return series;
  }, [throughput, throughput_sum, windowTimestamps, index, colorMap, visibleSeries]);

  const giveawayData = useMemo(() =>
    Object.entries(giveaway)
      .filter(([prog]) => visibleSeries[prog])
      .map(([prog, arr]) => ({
        id: prog,
        color: colorMap[prog],
        data: windowTimestamps.map((t, i) => ({ x: t, y: windowData(arr)[i] })),
      })),
    [giveaway, windowTimestamps, index, colorMap, visibleSeries]
  );

  const rejectsData = useMemo(() => {
    if (!visibleSeries["Total"]) return [];
    
    return [{
      id: "Total",
      color: colorMap.Total,
      data: windowTimestamps.map((t, i) => ({
        x: t,
        y: windowData(rejects)[i],
      })),
    }];
  }, [rejects, windowTimestamps, index, colorMap, visibleSeries]);

  // Filter pie chart data
  const batchPerMinData = useMemo(
    () =>
      pie_batch_per_min[index]
        .filter(d => visibleSeries[d.program])
        .map(d => ({
          id: d.program,
          value: d.value,
          color: colorMap[d.program],
        })),
    [pie_batch_per_min, index, colorMap, visibleSeries]
  );
  
  const batchTotalData = useMemo(
    () =>
      pie_batch_total[index]
        .filter(d => visibleSeries[d.program])
        .map(d => ({
          id: d.program,
          value: d.value,
          color: colorMap[d.program],
        })),
    [pie_batch_total, index, colorMap, visibleSeries]
  );
  
  const giveawayPercentData = useMemo(
    () =>
      pie_giveaway_percent[index]
        .filter(d => visibleSeries[d.program])
        .map(d => ({
          id: d.program,
          value: d.value,
          color: colorMap[d.program],
        })),
    [pie_giveaway_percent, index, colorMap, visibleSeries]
  );
  
  const giveawayGramData = useMemo(
    () =>
      pie_giveaway_gram_batch[index]
        .filter(d => visibleSeries[d.program])
        .map(d => ({
          id: d.program,
          value: d.value,
          color: colorMap[d.program],
        })),
    [pie_giveaway_gram_batch, index, colorMap, visibleSeries]
  );

  const scatterData = useMemo(() => {
    const currentDate = new Date(timestamps[index]);
    const oneHourAgo = new Date(currentDate.getTime() - 3600 * 1000);
  
    const pts = scatter_distribution
      .filter(d => {
        const t = new Date(d.timestamp);
        return t >= oneHourAgo && t <= currentDate;
      })
      .map(d => ({
        x: d.timestamp,
        y: Number(d.weight),
      }));
  
    return [
      {
        id: "Pieces",
        data: pts,
      },
    ];
  }, [scatter_distribution, timestamps, index]);

  const formatTimeLabel = (timestamp) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { 
      hour: '2-digit', 
      minute: '2-digit',
      hour12: false
    });
  };

  const batchPerMinSum = useMemo(() => {
    return batchPerMinData.reduce((sum, item) => sum + item.value, 0);
  }, [batchPerMinData]);

  const batchTotalSum = useMemo(() => {
    return batchTotalData.reduce((sum, item) => sum + item.value, 0);
  }, [batchTotalData]);

  const giveawayGramSum = useMemo(() => {
    const sum = giveawayGramData.reduce((sum, item) => sum + item.value, 0);
    return Number(sum.toFixed(1));
  }, [giveawayGramData]);

  const giveawayPercentAvg = useMemo(() => {
    if (giveawayPercentData.length === 0) return 0;
    const sum = giveawayPercentData.reduce((sum, item) => sum + item.value, 0);
    return Number((sum / giveawayPercentData.length).toFixed(1));
  }, [giveawayPercentData]);

  const sharedLineProps = {
    margin: { top: 10, right: 20, bottom: 50, left: 40 },
    xScale: { type: 'point' },
    yScale: { type: 'linear', min: 'auto', max: 'auto' },
    curve: 'basis',
    enableArea: false,
    useMesh: true,
    axisTop: null,
    axisRight: null,
    pointSize: 0,
    pointColor: { theme: 'background' },
    pointBorderWidth: 2,
    pointBorderColor: { from: 'serieColor' },
    pointLabel: 'yFormatted',
    pointLabelYOffset: -12,
    axisBottom: {
      format: formatTimeLabel,
      tickRotation: 0,
      orient: "bottom",
      tickValues: (() => {
        const firstIndex = 0;
        const lastIndex = windowTimestamps.length - 1;
        const oneThirdIndex = Math.floor(lastIndex / 3);
        const twoThirdsIndex = Math.floor(2 * lastIndex / 3);
        
        return [
          windowTimestamps[firstIndex], 
          windowTimestamps[oneThirdIndex], 
          windowTimestamps[twoThirdsIndex], 
          windowTimestamps[lastIndex]
        ];
      })(),
      tickSize: 5,
      tickPadding: 5,
      axis: { 
        strokeWidth: 1 
      },
      line: { 
        strokeWidth: 1 
      },
    },
    axisLeft: {
      orient: "left",
      tickValues: 3,
      tickSize: 5,
      tickPadding: 5,
      tickRotation: 0,
      axis: { 
        strokeWidth: 1 
      },
      line: { 
        strokeWidth: 1 
      },
      legend: '',
      legendOffset: -35,
      legendPosition: 'middle',
    },
    theme: chartTheme,
    key: `line-chart-${theme.palette.mode}`,
    enableGridX: false,
    enableGridY: false,
  };

  const sharedPieProps = {
    margin: { top: 10, right: 10, bottom: 0, left: 10 },
    innerRadius: 0.75,
    padAngle: 3,
    cornerRadius: 3,
    activeOuterRadiusOffset: 8,
    borderWidth: 1,
    borderColor: { from: 'color', modifiers: [[ 'darker', 0.2 ]] },
    enableArcLinkLabels: false,
    arcLinkLabelsSkipAngle: 10,
    arcLinkLabelsTextColor: "#333333",
    arcLinkLabelsThickness: 2,
    arcLinkLabelsColor: { from: 'color' },
    arcLabelsSkipAngle: 10,
    arcLabelsTextColor: { theme: 'labels.text.fill' },
    valueFormat: ">-.0f",
    colors: ({ id }) => colorMap[id],
    theme: {
      labels: {
        text: {
          fill: tokens('dark').primary[900],
        },
      },
    }
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
        if (!scatterData[0] || !scatterData[0].data || scatterData[0].data.length === 0) {
          return [];
        }
        
        const dataPoints = scatterData[0].data;
        const totalPoints = dataPoints.length;
        
        if (totalPoints < 4) {
          return dataPoints.map(d => d.x);
        }
        
        return [
          dataPoints[0].x, 
          dataPoints[Math.floor(totalPoints * 0.33)].x, 
          dataPoints[Math.floor(totalPoints * 0.66)].x, 
          dataPoints[totalPoints - 1].x
        ];
      })(),
      tickSize: 5,
      tickPadding: 5,
      axis: { 
        strokeWidth: 1 
      },
      line: { 
        strokeWidth: 1 
      },
    },
    axisLeft: { 
      orient: "left",
      tickValues: 3,
      tickSize: 5,
      tickPadding: 5,
      tickRotation: 0,
      axis: { 
        strokeWidth: 1 
      },
      line: { 
        strokeWidth: 1 
      },
      legend: 'weight (g)',
      legendOffset: -35,
      legendPosition: 'middle',
    },
    theme: chartTheme,
    key: `scatter-chart-${theme.palette.mode}`,
    colors: () => colors.tealAccent[500],
    nodeSize: 3,
    useMesh: true,
    enableGridX: false,
    enableGridY: false,
  };

  const throughputProps = {
    ...sharedLineProps,
    axisLeft: {
      ...sharedLineProps.axisLeft,
      legend: 'batch / min',
    }
  };

  const giveawayProps = {
    ...sharedLineProps,
    axisLeft: {
      ...sharedLineProps.axisLeft,
      legend: '%',
    }
  };
  
  const rejectsProps = {
    ...sharedLineProps,
    axisLeft: {
      ...sharedLineProps.axisLeft,
      legend: 'piece / min',
    },
    enableArea: true,
    areaBaselineValue: 0,
    yScale: { 
      type: 'linear', 
      min: 0, 
      max: 'auto' 
    }
  };

  return(
    <Box 
      m="20px" 
      height="calc(100vh - 200px)" 
      maxHeight="calc(100vh - 200px)" 
      sx={{ 
        overflow: "visible",
        display: "flex",
        flexDirection: "column"
      }}
    > 
      <Box display="flex" justifyContent="space-between" alignItems="center" mb="20px" sx={{ m: "0px 0 0 0" }} >
        <Header title="Dashboard" subtitle="Performance Overview" />
        
        <Box 
          display="flex" 
          alignItems="center"
          justifyContent="flex-end"
          gap="20px"
          mr="20px"
        >
          {Object.entries(colorMap).map(([program, color]) => (
            <Box 
              key={program}
              display="flex" 
              alignItems="center" 
              gap="5px"
              onClick={() => toggleSeries(program)}
              sx={{ 
                cursor: 'pointer',
                opacity: visibleSeries[program] ? 1 : 0.4,
                transition: 'all 0.2s',
                '&:hover': {
                  transform: 'scale(1.05)',
                },
                border: visibleSeries[program] ? 'none' : `1px solid ${colors.grey[300]}`,
                borderRadius: '4px',
                padding: '2px 6px',
              }}
            >
              <Box 
                width="12px" 
                height="12px" 
                borderRadius="50%" 
                sx={{ backgroundColor: color }} 
              />
              <Typography variant="h7" color={colors.primary[800]}>
                {program}
              </Typography>
            </Box>
          ))}
        </Box>
      </Box>

      <Box
        display="grid"
        gridTemplateColumns="repeat(12, 1fr)"
        gridTemplateRows="repeat(3, 1fr)"
        gap="20px"
        sx={{
          flex: 1,
          minHeight: 0,
          overflow: "hidden"
        }}
      >
        <Box gridColumn="1 / span 3" gridRow="1 / span 3" sx={{ position: 'relative', overflow: 'hidden' }}>
          <AnnotatedMachineImage colorMap={colorMap} gateData={gateSimulation[index]} />
        </Box>

        <Box
          gridColumn="4 / span 9"
          gridRow="1 / span 1"
          display="grid"
          gridTemplateColumns="repeat(3, 1fr)"
          gap="20px"
          sx={{ minHeight: 0 }}
        >
          <Box sx={{ backgroundColor: colors.primary[100], borderRadius: 1.5, overflow: "hidden"}} p="15px">
            <Typography
                variant="h5"
                color={colors.tealAccent[500]}
              >
                Throughput
            </Typography>
            <ResponsiveLine
              data={throughputData}
              colors={d => d.color}
              theme={chartTheme}
              key={`throughput-${theme.palette.mode}`}
              {...throughputProps}
            />
          </Box>
          <Box sx={{ backgroundColor: colors.primary[100], borderRadius: 1.5, overflow: "hidden"}} p="15px">
            <Typography
                variant="h5"
                color={colors.tealAccent[500]}
              >
                Give-away
            </Typography>
            <ResponsiveLine
              data={giveawayData}
              colors={d => d.color}
              theme={chartTheme}
              key={`giveaway-${theme.palette.mode}`}
              {...giveawayProps}
            />
          </Box>
          <Box sx={{ backgroundColor: colors.primary[100], borderRadius: 1.5, overflow: "hidden"}} p="15px">
            <Typography
                variant="h5"
                color={colors.tealAccent[500]}
              >
                Rejects
            </Typography>
            <ResponsiveLine
              data={rejectsData}
              colors={d => d.color}
              theme={chartTheme}
              key={`rejects-${theme.palette.mode}`}
              {...rejectsProps}
            />
          </Box>
        </Box>

        <Box
          gridColumn="4 / span 9"
          gridRow="2 / span 1"
          display="grid"
          gridTemplateColumns="repeat(4, 1fr)"
          gap="20px"
          height="100%"
          sx={{
            flex: 1,
            minHeight: 0,
            overflow: "hidden"
          }}
        >
          <Box sx={{ 
            backgroundColor: colors.primary[100], 
            borderRadius: 1.5, 
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
            height: "100%"
          }} p="15px">
            <Typography
                variant="h5"
                color={colors.tealAccent[500]}
              >
                Batch per min
            </Typography>

            <Typography
                variant="h6"
                color={colors.primary[800]}
              >
                Sum : {Math.round(batchPerMinSum)}
            </Typography>
          
            <Box sx={{ 
              height: "85%",
              position: "relative"
            }}>
              <ResponsivePie
                data={batchPerMinData}
                {...sharedPieProps}
              />
            </Box>
          </Box>

          <Box sx={{ 
            backgroundColor: colors.primary[100], 
            borderRadius: 1.5, 
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
            height: "100%"
          }} p="15px">
            <Typography
                variant="h5"
                color={colors.tealAccent[500]}
              >
                Batch total
            </Typography>

            <Typography
                variant="h6"
                color={colors.primary[800]}
              >
                Sum : {Math.round(batchTotalSum)}
            </Typography>
          
            <Box sx={{ 
              height: "85%",
              position: "relative"
            }}>
              <ResponsivePie
                data={batchTotalData}
                {...sharedPieProps}
              />
            </Box>
          </Box>

          <Box sx={{ 
            backgroundColor: colors.primary[100], 
            borderRadius: 1.5, 
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
            height: "100%"
          }} p="15px">
            <Typography
                variant="h5"
                color={colors.tealAccent[500]}
              >
                Give-away (g/batch)
            </Typography>

            <Typography
                variant="h6"
                color={colors.primary[800]}
              >
                Sum : {giveawayGramSum}
            </Typography>
          
            <Box sx={{ 
              height: "85%",
              position: "relative"
            }}>
              <ResponsivePie
                data={giveawayGramData}
                {...sharedPieProps}
              />
            </Box>
          </Box>

          <Box sx={{ 
            backgroundColor: colors.primary[100], 
            borderRadius: 1.5, 
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
            height: "100%"
          }} p="15px">
            <Typography
                variant="h5"
                color={colors.tealAccent[500]}
              >
                Give-away (%)
            </Typography>

            <Typography
                variant="h6"
                color={colors.primary[800]}
              >
                Avg : {giveawayPercentAvg}
            </Typography>
          
            <Box sx={{ 
              height: "85%",
              position: "relative"
            }}>
              <ResponsivePie
                data={giveawayPercentData}
                {...sharedPieProps}
              />
            </Box>
          </Box>

        </Box>

        <Box
          gridColumn="4 / span 9"
          gridRow="3 / span 1"
          sx={{
            backgroundColor: colors.primary[100],
            p: "15px",
            height: "100%",
            minHeight: 0,
            overflow: "hidden",
          }}
        >
          <Typography variant="h5" color={colors.tealAccent[500]} mb="10px">
            Piece Weight Distribution
          </Typography>
          <Box sx={{ height: "calc(100% - 40px)", position: "relative" }}>
            <ResponsiveScatterPlot
              data={scatterData}
              theme={chartTheme}
              key={`scatter-${theme.palette.mode}`}
              {...sharedScatterProps}
            />
          </Box>
        </Box>
      </Box>
    </Box>
  );
};

export default Dashboard;





import React, { useState, useEffect, useMemo } from "react";
import { Box, useTheme, Typography } from "@mui/material";
import { ResponsiveLine } from "@nivo/line";
import { ResponsivePie } from "@nivo/pie";
import { ResponsiveScatterPlot } from "@nivo/scatterplot";
import { tokens } from "../../theme";
import Header from "../../components/Header";
import mockData from "../../data/mockData_json4.json";

// Annotated machine image with per-gate overlay
const AnnotatedMachineImage = ({ colorMap, gateData }) => {
  const theme = useTheme();
  const colors = tokens(theme.palette.mode);

  const annotationPositions = [
    { gate: 1, x1: '50%', y1: '10%', x2: '70%', y2: '5%', program: 'Program A' },
    { gate: 2, x1: '70%', y1: '20%', x2: '90%', y2: '15%', program: 'Program A' },
    { gate: 3, x1: '80%', y1: '30%', x2: '95%', y2: '35%', program: 'Program C' },
    { gate: 4, x1: '70%', y1: '40%', x2: '90%', y2: '50%', program: 'Program D' },
    { gate: 5, x1: '60%', y1: '55%', x2: '85%', y2: '65%', program: 'Program A' },
    { gate: 6, x1: '50%', y1: '65%', x2: '75%', y2: '75%', program: 'Program B' },
    { gate: 7, x1: '40%', y1: '75%', x2: '65%', y2: '85%', program: 'Program C' },
    { gate: 8, x1: '30%', y1: '85%', x2: '60%', y2: '95%', program: 'Program B' },
  ];

  return (
    <Box sx={{ position: 'relative', width: '100%', height: '100%' }}>
      <img
        alt="machine"
        // width="90%"
        style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          maxHeight: '100%'
        }}
        src="../../assets/Marelec_Grader_8.png"
      />
      <Box
        component="svg"
        sx={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
      >
        {annotationPositions.map((pos, idx) => {
          const midX = `calc(${pos.x1} + ${(parseFloat(pos.x2) - parseFloat(pos.x1)) * 0.6}%)`;
          return (
            <React.Fragment key={idx}>
              <line x1={pos.x1} y1={pos.y1} x2={midX} y2={pos.y1} stroke={colorMap[pos.program]} strokeWidth={2} />
              <line x1={midX} y1={pos.y1} x2={pos.x2} y2={pos.y2} stroke={colorMap[pos.program]} strokeWidth={2} />
            </React.Fragment>
          );
        })}
      </Box>

      {annotationPositions.map((pos, idx) => {
        // pick correct gate record (array or object)
        const info = gateData
          ? Array.isArray(gateData)
            ? gateData[pos.gate - 1]
            : gateData[pos.gate]
          : {};
        const pieces = info.pieces ?? 0;
        const sumGrams = info.sumGrams ?? 0;

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
              border: `1px solid ${colorMap[pos.program]}`,
              width: '100px',
              boxShadow: 3,
              overflow: 'hidden',
            }}
          >
            <Box sx={{ backgroundColor: colorMap[pos.program], py: 0.1, px: 0.5, textAlign: 'left' }}>
              <Typography variant="body2" color="#fff">
                G{pos.gate}: {pos.program}
              </Typography>
            </Box>
            <Box sx={{ p: 0.5 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', borderBottom: `1px solid ${colors.grey[300]}`, py: 0.1 }}>
                <Typography variant="body2" color={colors.primary[800]} fontWeight="bold">
                  Pieces:
                </Typography>
                <Typography variant="body2" color={colors.primary[800]}> {pieces} </Typography>
              </Box>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', py: 0.1 }}>
                <Typography variant="body2" color={colors.primary[800]} fontWeight="bold">
                  Gram:
                </Typography>
                <Typography variant="body2" color={colors.primary[800]}> {sumGrams.toFixed(1)} </Typography>
              </Box>
            </Box>
          </Box>
        );
      })}
    </Box>
  );
};

const Dashboard = () => {
  const theme = useTheme();
  const colors = tokens(theme.palette.mode);
  const isDarkMode = theme.palette.mode === 'dark';

  // Add state to track visible series
  const [visibleSeries, setVisibleSeries] = useState({
    "Program A": true,
    "Program B": true,
    "Program C": true,
    "Program D": true,
    "Total": true
  });

  // Toggle visibility of a series
  const toggleSeries = (program) => {
    setVisibleSeries(prev => ({
      ...prev,
      [program]: !prev[program]
    }));
  };

  const chartTheme = {
    axis: {
      domain: {
        line: {
          stroke: isDarkMode ? colors.primary[800] : colors.primary[800],
          strokeWidth: 1,
        },
      },
      legend: {
        text: {
          fill: isDarkMode ? colors.primary[800] : colors.primary[800],
        },
      },
      ticks: {
        line: {
          stroke: isDarkMode ? colors.primary[800] : colors.primary[800] ,
          strokeWidth: 1,
        },
        text: {
          fill: isDarkMode ? colors.primary[800] : colors.primary[800],
          fontSize: 11,
        },
      },
    },
    grid: {
      line: {
        stroke: isDarkMode ? colors.primary[800] : colors.primary[800],
        strokeWidth: 1,
      },
    },
    legends: {
      text: {
        fill: isDarkMode ? colors.primary[800] : colors.primary[800],
      },
    },
    tooltip: {
      container: {
        background: isDarkMode ? colors.primary[400] : colors.primary[100],
        color: isDarkMode ? colors.grey[100] : colors.grey[900],
      },
    },
  };

  const {
    timestamps,
    throughput,
    throughput_sum,
    rejects,
    giveaway,
    pie_batch_per_min,
    pie_batch_total,
    pie_giveaway_percent,
    pie_giveaway_gram_batch,
    scatter_distribution
  } = mockData;
  const totalPoints = timestamps.length;
  const windowSize = 60;
  const [index, setIndex] = useState(windowSize - 1);

  // define which program each gate runs, and its caps
  const gateMapping = {
    1: 'Program A', 2: 'Program A', 3: 'Program B', 4: 'Program D',
    5: 'Program B', 6: 'Program A', 7: 'Program C', 8: 'Program C'
  };
  const programLimits = {
    'Program A': { maxPieces: 10, maxGram: 100 },
    'Program B': { maxPieces: 3, maxGram: 200 },
    'Program C': { maxPieces: 4, maxGram: 150 },
    'Program D': { maxPieces: 8, maxGram: 150 },
  };

  // simulate each gate's (pieces, sumGrams) over time
  const gateSimulation = useMemo(() => {
    const sim = [];
    const state = {};
    for (let g = 1; g <= 8; g++) state[g] = { pieces: 0, sumGrams: 0 };

    for (let t = 0; t < totalPoints; t++) {
      const snapshot = {};
      for (let g = 1; g <= 8; g++) {
        const prog = gateMapping[g];
        const { maxPieces, maxGram } = programLimits[prog];
        const prev = state[g].pieces;
        const nextPieces = prev + 1 > maxPieces ? 0 : prev + 1;
        let sum = 0;
        for (let i = 0; i < nextPieces; i++) sum += Math.random() * maxGram;

        state[g] = { pieces: nextPieces, sumGrams: sum };
        snapshot[g] = state[g];
      }
      sim.push(snapshot);
    }
    return sim;
  }, [totalPoints]);

  useEffect(() => {
    const iv = setInterval(() => setIndex(i => (i + 1) % totalPoints), 2000);
    return () => clearInterval(iv);
  }, [totalPoints]);

  const isWrapped = index < windowSize - 1;
  const windowTimestamps = isWrapped
    ? timestamps.slice(0, windowSize)
    : timestamps.slice(index - (windowSize - 1), index + 1);
  const windowData = arr =>
    isWrapped ? arr.slice(0, windowSize) : arr.slice(index - (windowSize - 1), index + 1);

  const colorMap = useMemo(() => ({
    "Program A": colors.tealAccent[500],
    "Program B": colors.redAccent[500],
    "Program C": colors.purpleAccent[500],
    "Program D": colors.orangeAccent[500],
    Total: colors.beigeAccent[400],
  }), [
    colors.tealAccent,
    colors.redAccent,
    colors.purpleAccent,
    colors.orangeAccent,
    colors.beigeAccent,
  ]);

  // Filter data based on visible series
  const throughputData = useMemo(() => {
    const series = Object.entries(throughput)
      .filter(([prog]) => visibleSeries[prog])
      .map(([prog, arr]) => ({
        id: prog,
        color: colorMap[prog],
        data: windowTimestamps.map((t, i) => ({ x: t, y: windowData(arr)[i] })),
      }));
    
    if (visibleSeries["Total"]) {
      series.push({
        id: "Total",
        color: colorMap.Total,
        data: windowTimestamps.map((t, i) => ({ x: t, y: windowData(throughput_sum)[i] })),
      });
    }
    return series;
  }, [throughput, throughput_sum, windowTimestamps, index, colorMap, visibleSeries]);

  const giveawayData = useMemo(() =>
    Object.entries(giveaway)
      .filter(([prog]) => visibleSeries[prog])
      .map(([prog, arr]) => ({
        id: prog,
        color: colorMap[prog],
        data: windowTimestamps.map((t, i) => ({ x: t, y: windowData(arr)[i] })),
      })),
    [giveaway, windowTimestamps, index, colorMap, visibleSeries]
  );

  const rejectsData = useMemo(() => {
    if (!visibleSeries["Total"]) return [];
    
    return [{
      id: "Total",
      color: colorMap.Total,
      data: windowTimestamps.map((t, i) => ({
        x: t,
        y: windowData(rejects)[i],
      })),
    }];
  }, [rejects, windowTimestamps, index, colorMap, visibleSeries]);

  // Filter pie chart data
  const batchPerMinData = useMemo(
    () =>
      pie_batch_per_min[index]
        .filter(d => visibleSeries[d.program])
        .map(d => ({
          id: d.program,
          value: d.value,
          color: colorMap[d.program],
        })),
    [pie_batch_per_min, index, colorMap, visibleSeries]
  );
  
  const batchTotalData = useMemo(
    () =>
      pie_batch_total[index]
        .filter(d => visibleSeries[d.program])
        .map(d => ({
          id: d.program,
          value: d.value,
          color: colorMap[d.program],
        })),
    [pie_batch_total, index, colorMap, visibleSeries]
  );
  
  const giveawayPercentData = useMemo(
    () =>
      pie_giveaway_percent[index]
        .filter(d => visibleSeries[d.program])
        .map(d => ({
          id: d.program,
          value: d.value,
          color: colorMap[d.program],
        })),
    [pie_giveaway_percent, index, colorMap, visibleSeries]
  );
  
  const giveawayGramData = useMemo(
    () =>
      pie_giveaway_gram_batch[index]
        .filter(d => visibleSeries[d.program])
        .map(d => ({
          id: d.program,
          value: d.value,
          color: colorMap[d.program],
        })),
    [pie_giveaway_gram_batch, index, colorMap, visibleSeries]
  );

  const scatterData = useMemo(() => {
    const currentDate = new Date(timestamps[index]);
    const oneHourAgo = new Date(currentDate.getTime() - 3600 * 1000);
  
    const pts = scatter_distribution
      .filter(d => {
        const t = new Date(d.timestamp);
        return t >= oneHourAgo && t <= currentDate;
      })
      .map(d => ({
        x: d.timestamp,
        y: Number(d.weight),
      }));
  
    return [
      {
        id: "Pieces",
        data: pts,
      },
    ];
  }, [scatter_distribution, timestamps, index]);

  const formatTimeLabel = (timestamp) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { 
      hour: '2-digit', 
      minute: '2-digit',
      hour12: false
    });
  };

  const batchPerMinSum = useMemo(() => {
    return batchPerMinData.reduce((sum, item) => sum + item.value, 0);
  }, [batchPerMinData]);

  const batchTotalSum = useMemo(() => {
    return batchTotalData.reduce((sum, item) => sum + item.value, 0);
  }, [batchTotalData]);

  const giveawayGramSum = useMemo(() => {
    const sum = giveawayGramData.reduce((sum, item) => sum + item.value, 0);
    return Number(sum.toFixed(1));
  }, [giveawayGramData]);

  const giveawayPercentAvg = useMemo(() => {
    if (giveawayPercentData.length === 0) return 0;
    const sum = giveawayPercentData.reduce((sum, item) => sum + item.value, 0);
    return Number((sum / giveawayPercentData.length).toFixed(1));
  }, [giveawayPercentData]);

  const sharedLineProps = {
    margin: { top: 10, right: 20, bottom: 50, left: 40 },
    xScale: { type: 'point' },
    yScale: { type: 'linear', min: 'auto', max: 'auto' },
    curve: 'basis',
    enableArea: false,
    useMesh: true,
    axisTop: null,
    axisRight: null,
    pointSize: 0,
    pointColor: { theme: 'background' },
    pointBorderWidth: 2,
    pointBorderColor: { from: 'serieColor' },
    pointLabel: 'yFormatted',
    pointLabelYOffset: -12,
    axisBottom: {
      format: formatTimeLabel,
      tickRotation: 0,
      orient: "bottom",
      tickValues: (() => {
        const firstIndex = 0;
        const lastIndex = windowTimestamps.length - 1;
        const oneThirdIndex = Math.floor(lastIndex / 3);
        const twoThirdsIndex = Math.floor(2 * lastIndex / 3);
        
        return [
          windowTimestamps[firstIndex], 
          windowTimestamps[oneThirdIndex], 
          windowTimestamps[twoThirdsIndex], 
          windowTimestamps[lastIndex]
        ];
      })(),
      tickSize: 5,
      tickPadding: 5,
      axis: { 
        strokeWidth: 1 
      },
      line: { 
        strokeWidth: 1 
      },
    },
    axisLeft: {
      orient: "left",
      tickValues: 3,
      tickSize: 5,
      tickPadding: 5,
      tickRotation: 0,
      axis: { 
        strokeWidth: 1 
      },
      line: { 
        strokeWidth: 1 
      },
      legend: '',
      legendOffset: -35,
      legendPosition: 'middle',
    },
    theme: chartTheme,
    key: `line-chart-${theme.palette.mode}`,
    enableGridX: false,
    enableGridY: false,
  };

  const sharedPieProps = {
    margin: { top: 20, right: 5, bottom: 0, left: 5 },
    innerRadius: 0.65,
    padAngle: 3,
    cornerRadius: 3,
    activeOuterRadiusOffset: 8,
    borderWidth: 1,
    borderColor: { from: 'color', modifiers: [[ 'darker', 0.2 ]] },
    enableArcLinkLabels: false,
    arcLinkLabelsSkipAngle: 10,
    arcLinkLabelsTextColor: "#333333",
    arcLinkLabelsThickness: 2,
    arcLinkLabelsColor: { from: 'color' },
    arcLabelsSkipAngle: 10,
    arcLabelsTextColor: { theme: 'labels.text.fill' },
    valueFormat: ">-.0f",
    colors: ({ id }) => colorMap[id],
    theme: {
      labels: {
        text: {
          fill: tokens('dark').primary[900],
        },
      },
    }
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
        if (!scatterData[0] || !scatterData[0].data || scatterData[0].data.length === 0) {
          return [];
        }
        
        const dataPoints = scatterData[0].data;
        const totalPoints = dataPoints.length;
        
        if (totalPoints < 4) {
          return dataPoints.map(d => d.x);
        }
        
        return [
          dataPoints[0].x, 
          dataPoints[Math.floor(totalPoints * 0.33)].x, 
          dataPoints[Math.floor(totalPoints * 0.66)].x, 
          dataPoints[totalPoints - 1].x
        ];
      })(),
      tickSize: 5,
      tickPadding: 5,
      axis: { 
        strokeWidth: 1 
      },
      line: { 
        strokeWidth: 1 
      },
    },
    axisLeft: { 
      orient: "left",
      tickValues: 3,
      tickSize: 5,
      tickPadding: 5,
      tickRotation: 0,
      axis: { 
        strokeWidth: 1 
      },
      line: { 
        strokeWidth: 1 
      },
      legend: 'weight (g)',
      legendOffset: -35,
      legendPosition: 'middle',
    },
    theme: chartTheme,
    key: `scatter-chart-${theme.palette.mode}`,
    colors: () => colors.tealAccent[500],
    nodeSize: 3,
    useMesh: true,
    enableGridX: false,
    enableGridY: false,
  };

  const throughputProps = {
    ...sharedLineProps,
    axisLeft: {
      ...sharedLineProps.axisLeft,
      legend: 'batch / min',
    }
  };

  const giveawayProps = {
    ...sharedLineProps,
    axisLeft: {
      ...sharedLineProps.axisLeft,
      legend: '%',
    }
  };
  
  const rejectsProps = {
    ...sharedLineProps,
    axisLeft: {
      ...sharedLineProps.axisLeft,
      legend: 'piece / min',
    },
    enableArea: true,
    areaBaselineValue: 0,
    yScale: { 
      type: 'linear', 
      min: 0, 
      max: 'auto' 
    }
  };

  return(
    <Box 
      m="20px" 
      height="calc(100vh - 200px)" 
      maxHeight="calc(100vh - 200px)" 
      sx={{ 
        overflow: "visible",
        display: "flex",
        flexDirection: "column"
      }}
    > 
      <Box display="flex" justifyContent="space-between" alignItems="center" mb="20px" sx={{ m: "0px 0 0 0" }} >
        <Header title="Dashboard" subtitle="Performance Overview" />
        
        <Box 
          display="flex" 
          alignItems="center"
          justifyContent="flex-end"
          gap="20px"
          mr="20px"
        >
          {Object.entries(colorMap).map(([program, color]) => (
            <Box 
              key={program}
              display="flex" 
              alignItems="center" 
              gap="5px"
              onClick={() => toggleSeries(program)}
              sx={{ 
                cursor: 'pointer',
                opacity: visibleSeries[program] ? 1 : 0.4,
                transition: 'all 0.2s',
                '&:hover': {
                  transform: 'scale(1.05)',
                },
                border: visibleSeries[program] ? 'none' : `1px solid ${colors.grey[300]}`,
                borderRadius: '4px',
                padding: '2px 6px',
              }}
            >
              <Box 
                width="12px" 
                height="12px" 
                borderRadius="50%" 
                sx={{ backgroundColor: color }} 
              />
              <Typography variant="h7" color={colors.primary[800]}>
                {program}
              </Typography>
            </Box>
          ))}
        </Box>
      </Box>

      <Box
        display="grid"
        gridTemplateColumns="repeat(12, 1fr)"
        gridTemplateRows="repeat(12, 1fr)"
        gap="20px"
        sx={{
          flex: 1,
          minHeight: 0,
          overflow: "hidden"
        }}
      >
        {/* Pie Charts - Left Column */}
        <Box 
          gridColumn="1 / span 2" 
          gridRow="1 / span 12" 
          display="grid"
          gridTemplateRows="repeat(4, 1fr)"
          gap="5px"
        >
          {/* Batch per min */}
          <Box sx={{ 
            backgroundColor: colors.primary[100], 
            borderRadius: 1.5, 
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
          }} p="15px">
            <Typography variant="h5" color={colors.tealAccent[500]}>
              Batch per min
            </Typography>
            <Typography variant="h6" color={colors.primary[800]} sx={{mb:"-10px"}}>
              Sum : {Math.round(batchPerMinSum)}
            </Typography>
            <Box sx={{ 
              height: "calc(100%)", 
              position: "relative",
              overflow: "hidden" 
            }}>
              <ResponsivePie 
                data={batchPerMinData} 
                {...sharedPieProps} 
              />
            </Box>
          </Box>

          {/* Batch total */}
          <Box sx={{ 
            backgroundColor: colors.primary[100], 
            borderRadius: 1.5, 
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
          }} p="15px">
            <Typography variant="h5" color={colors.tealAccent[500]}>
              Batch total
            </Typography>
            <Typography variant="h6" color={colors.primary[800]} sx={{mb:"-10px"}}>
              Sum : {Math.round(batchTotalSum)}
            </Typography>
            <Box sx={{ 
              height: "calc(100%)", 
              position: "relative",
              overflow: "hidden" 
            }}>
              <ResponsivePie 
                data={batchTotalData} 
                {...sharedPieProps} 
              />
            </Box>
          </Box>

          {/* Give-away (g/batch) */}
          <Box sx={{ 
            backgroundColor: colors.primary[100], 
            borderRadius: 1.5, 
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
          }} p="15px">
            <Typography variant="h5" color={colors.tealAccent[500]}>
              Give-away (g/batch)
            </Typography>
            <Typography variant="h6" color={colors.primary[800]} sx={{mb:"-10px"}}>
              Sum : {giveawayGramSum}
            </Typography>
            <Box sx={{ 
              height: "calc(100%)", 
              position: "relative",
              overflow: "hidden" 
            }}>
              <ResponsivePie 
                data={giveawayGramData} 
                {...sharedPieProps} 
              />
            </Box>
          </Box>

          {/* Give-away (%) */}
          <Box sx={{ 
            backgroundColor: colors.primary[100], 
            borderRadius: 1.5, 
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
          }} p="15px">
            <Typography variant="h5" color={colors.tealAccent[500]}>
              Give-away (%)
            </Typography>
            <Typography variant="h6" color={colors.primary[800]} sx={{mb:"-10px"}}>
              Avg : {giveawayPercentAvg}
            </Typography>
            <Box sx={{ 
              height: "calc(100% )", 
              position: "relative",
              overflow: "hidden" 
            }}>
              <ResponsivePie 
                data={giveawayPercentData} 
                {...sharedPieProps} 
              />
            </Box>
          </Box>
        </Box>

        {/* Machine Image - Top Row */}
        <Box 
          gridColumn="3 / span 10" 
          gridRow="1 / span 4" 
          sx={{ 
            backgroundColor: colors.primary[100], 
            borderRadius: 1.5, 
            overflow: "hidden", 
            position: 'relative' 
          }}
        >
          <AnnotatedMachineImage colorMap={colorMap} gateData={gateSimulation[index]} />
        </Box>

        {/* Scatter Plot - Middle Row */}
        <Box
          gridColumn="3 / span 10"
          gridRow="5 / span 4"
          sx={{
            backgroundColor: colors.primary[100],
            p: "15px",
            borderRadius: 1.5,
            overflow: "hidden",
          }}
        >
          <Typography variant="h5" color={colors.tealAccent[500]} mb="10px">
            Piece Weight Distribution
          </Typography>
          <Box sx={{ height: "calc(100% - 40px)", position: "relative" }}>
            <ResponsiveScatterPlot
              data={scatterData}
              theme={chartTheme}
              key={`scatter-${theme.palette.mode}`}
              {...sharedScatterProps}
            />
          </Box>
        </Box>

        {/* Line Charts - Bottom Row */}
        <Box
          gridColumn="3 / span 10"
          gridRow="9 / span 4"
          display="grid"
          gridTemplateColumns="repeat(3, 1fr)"
          gap="20px"
        >
          <Box sx={{ backgroundColor: colors.primary[100], borderRadius: 1.5, overflow: "hidden"}} p="15px">
            <Typography variant="h5" color={colors.tealAccent[500]}>
              Throughput
            </Typography>
            <ResponsiveLine
              data={throughputData}
              colors={d => d.color}
              theme={chartTheme}
              key={`throughput-${theme.palette.mode}`}
              {...throughputProps}
            />
          </Box>
          <Box sx={{ backgroundColor: colors.primary[100], borderRadius: 1.5, overflow: "hidden"}} p="15px">
            <Typography variant="h5" color={colors.tealAccent[500]}>
              Give-away
            </Typography>
            <ResponsiveLine
              data={giveawayData}
              colors={d => d.color}
              theme={chartTheme}
              key={`giveaway-${theme.palette.mode}`}
              {...giveawayProps}
            />
          </Box>
          <Box sx={{ backgroundColor: colors.primary[100], borderRadius: 1.5, overflow: "hidden"}} p="15px">
            <Typography variant="h5" color={colors.tealAccent[500]}>
              Rejects
            </Typography>
            <ResponsiveLine
              data={rejectsData}
              colors={d => d.color}
              theme={chartTheme}
              key={`rejects-${theme.palette.mode}`}
              {...rejectsProps}
            />
          </Box>
        </Box>
      </Box>
    </Box>
  );
};

export default Dashboard;





import React, { useState, useEffect, useMemo } from "react";
import { Box, useTheme, Typography } from "@mui/material";
import { ResponsiveLine } from "@nivo/line";
import { ResponsivePie } from "@nivo/pie";
import { ResponsiveScatterPlot } from "@nivo/scatterplot";
import { tokens } from "../../theme";
import Header from "../../components/Header";
import mockData from "../../data/mockData_json4.json";

// Annotated machine image with per-gate overlay
const AnnotatedMachineImage = ({ colorMap, gateData }) => {
  const theme = useTheme();
  const colors = tokens(theme.palette.mode);

  const annotationPositions = [
    { gate: 1, x1: '36%', y1: '70%', x2: '10%', y2: '15%', program: 'Program A' },
    { gate: 2, x1: '34%', y1: '60%', x2: '20%', y2: '15%', program: 'Program A' },
    { gate: 3, x1: '33%', y1: '50%', x2: '30%', y2: '15%', program: 'Program C' },
    { gate: 4, x1: '43%', y1: '35%', x2: '40%', y2: '15%', program: 'Program D' },
    { gate: 5, x1: '55%', y1: '75%', x2: '65%', y2: '85%', program: 'Program A' },
    { gate: 6, x1: '50%', y1: '65%', x2: '75%', y2: '85%', program: 'Program B' },
    { gate: 7, x1: '40%', y1: '75%', x2: '85%', y2: '85%', program: 'Program C' },
    { gate: 8, x1: '68%', y1: '35%', x2: '95%', y2: '85%', program: 'Program B' },
  ];

  return (
    <Box sx={{ position: 'relative', width: '100%', height: '100%' }}>
      <img
        alt="machine"
        // width="90%"
        style={{
          position: 'absolute',
          top: '53%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          maxHeight: '120%'
        }}
        src="../../assets/Marelec_Grader_8.png"
      />
      <Box
        component="svg"
        sx={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
      >
        {/* {annotationPositions.map((pos, idx) => {
          const midX = `calc(${pos.x1} + ${(parseFloat(pos.x2) - parseFloat(pos.x1)) * 0.3}%)`;
          return (
            <React.Fragment key={idx}>
              <line x1={pos.x1} y1={pos.y1} x2={midX} y2={pos.y1} stroke={colorMap[pos.program]} strokeWidth={2} />
              <line x1={midX} y1={pos.y1} x2={pos.x2} y2={pos.y2} stroke={colorMap[pos.program]} strokeWidth={2} />
            </React.Fragment>
          );
        })} */}
      </Box>

      {annotationPositions.map((pos, idx) => {
        // pick correct gate record (array or object)
        const info = gateData
          ? Array.isArray(gateData)
            ? gateData[pos.gate - 1]
            : gateData[pos.gate]
          : {};
        const pieces = info.pieces ?? 0;
        const sumGrams = info.sumGrams ?? 0;

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
              border: `1px solid ${colorMap[pos.program]}`,
              width: '100px',
              boxShadow: 3,
              overflow: 'hidden',
            }}
          >
            <Box sx={{ backgroundColor: colorMap[pos.program], py: 0.1, px: 0.5, textAlign: 'left' }}>
              <Typography variant="body2" color="#fff">
                G{pos.gate}: {pos.program}
              </Typography>
            </Box>
            <Box sx={{ p: 0.5 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', borderBottom: `1px solid ${colors.grey[300]}`, py: 0.1 }}>
                <Typography variant="body2" color={colors.primary[800]} fontWeight="bold">
                  Pieces:
                </Typography>
                <Typography variant="body2" color={colors.primary[800]}> {pieces} </Typography>
              </Box>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', py: 0.1 }}>
                <Typography variant="body2" color={colors.primary[800]} fontWeight="bold">
                  Gram:
                </Typography>
                <Typography variant="body2" color={colors.primary[800]}> {sumGrams.toFixed(1)} </Typography>
              </Box>
            </Box>
          </Box>
        );
      })}
    </Box>
  );
};

const Dashboard = () => {
  const theme = useTheme();
  const colors = tokens(theme.palette.mode);
  const isDarkMode = theme.palette.mode === 'dark';

  // Add state to track visible series
  const [visibleSeries, setVisibleSeries] = useState({
    "Program A": true,
    "Program B": true,
    "Program C": true,
    "Program D": true,
    "Total": true
  });

  // Toggle visibility of a series
  const toggleSeries = (program) => {
    setVisibleSeries(prev => ({
      ...prev,
      [program]: !prev[program]
    }));
  };

  const chartTheme = {
    axis: {
      domain: {
        line: {
          stroke: isDarkMode ? colors.primary[800] : colors.primary[800],
          strokeWidth: 1,
        },
      },
      legend: {
        text: {
          fill: isDarkMode ? colors.primary[800] : colors.primary[800],
        },
      },
      ticks: {
        line: {
          stroke: isDarkMode ? colors.primary[800] : colors.primary[800] ,
          strokeWidth: 1,
        },
        text: {
          fill: isDarkMode ? colors.primary[800] : colors.primary[800],
          fontSize: 11,
        },
      },
    },
    grid: {
      line: {
        stroke: isDarkMode ? colors.primary[800] : colors.primary[800],
        strokeWidth: 1,
      },
    },
    legends: {
      text: {
        fill: isDarkMode ? colors.primary[800] : colors.primary[800],
      },
    },
    tooltip: {
      container: {
        background: isDarkMode ? colors.primary[400] : colors.primary[100],
        color: isDarkMode ? colors.grey[100] : colors.grey[900],
      },
    },
  };

  const {
    timestamps,
    throughput,
    throughput_sum,
    rejects,
    giveaway,
    pie_batch_per_min,
    pie_batch_total,
    pie_giveaway_percent,
    pie_giveaway_gram_batch,
    scatter_distribution
  } = mockData;
  const totalPoints = timestamps.length;
  const windowSize = 60;
  const [index, setIndex] = useState(windowSize - 1);

  // define which program each gate runs, and its caps
  const gateMapping = {
    1: 'Program A', 2: 'Program A', 3: 'Program B', 4: 'Program D',
    5: 'Program B', 6: 'Program A', 7: 'Program C', 8: 'Program C'
  };
  const programLimits = {
    'Program A': { maxPieces: 10, maxGram: 100 },
    'Program B': { maxPieces: 3, maxGram: 200 },
    'Program C': { maxPieces: 4, maxGram: 150 },
    'Program D': { maxPieces: 8, maxGram: 150 },
  };

  // simulate each gate's (pieces, sumGrams) over time
  const gateSimulation = useMemo(() => {
    const sim = [];
    const state = {};
    for (let g = 1; g <= 8; g++) state[g] = { pieces: 0, sumGrams: 0 };

    for (let t = 0; t < totalPoints; t++) {
      const snapshot = {};
      for (let g = 1; g <= 8; g++) {
        const prog = gateMapping[g];
        const { maxPieces, maxGram } = programLimits[prog];
        const prev = state[g].pieces;
        const nextPieces = prev + 1 > maxPieces ? 0 : prev + 1;
        let sum = 0;
        for (let i = 0; i < nextPieces; i++) sum += Math.random() * maxGram;

        state[g] = { pieces: nextPieces, sumGrams: sum };
        snapshot[g] = state[g];
      }
      sim.push(snapshot);
    }
    return sim;
  }, [totalPoints]);

  useEffect(() => {
    const iv = setInterval(() => setIndex(i => (i + 1) % totalPoints), 2000);
    return () => clearInterval(iv);
  }, [totalPoints]);

  const isWrapped = index < windowSize - 1;
  const windowTimestamps = isWrapped
    ? timestamps.slice(0, windowSize)
    : timestamps.slice(index - (windowSize - 1), index + 1);
  const windowData = arr =>
    isWrapped ? arr.slice(0, windowSize) : arr.slice(index - (windowSize - 1), index + 1);

  const colorMap = useMemo(() => ({
    "Program A": colors.tealAccent[500],
    "Program B": colors.redAccent[500],
    "Program C": colors.purpleAccent[500],
    "Program D": colors.orangeAccent[500],
    Total: colors.beigeAccent[400],
  }), [
    colors.tealAccent,
    colors.redAccent,
    colors.purpleAccent,
    colors.orangeAccent,
    colors.beigeAccent,
  ]);

  // Filter data based on visible series
  const throughputData = useMemo(() => {
    const series = Object.entries(throughput)
      .filter(([prog]) => visibleSeries[prog])
      .map(([prog, arr]) => ({
        id: prog,
        color: colorMap[prog],
        data: windowTimestamps.map((t, i) => ({ x: t, y: windowData(arr)[i] })),
      }));
    
    if (visibleSeries["Total"]) {
      series.push({
        id: "Total",
        color: colorMap.Total,
        data: windowTimestamps.map((t, i) => ({ x: t, y: windowData(throughput_sum)[i] })),
      });
    }
    return series;
  }, [throughput, throughput_sum, windowTimestamps, index, colorMap, visibleSeries]);

  const giveawayData = useMemo(() =>
    Object.entries(giveaway)
      .filter(([prog]) => visibleSeries[prog])
      .map(([prog, arr]) => ({
        id: prog,
        color: colorMap[prog],
        data: windowTimestamps.map((t, i) => ({ x: t, y: windowData(arr)[i] })),
      })),
    [giveaway, windowTimestamps, index, colorMap, visibleSeries]
  );

  const rejectsData = useMemo(() => {
    if (!visibleSeries["Total"]) return [];
    
    return [{
      id: "Total",
      color: colorMap.Total,
      data: windowTimestamps.map((t, i) => ({
        x: t,
        y: windowData(rejects)[i],
      })),
    }];
  }, [rejects, windowTimestamps, index, colorMap, visibleSeries]);

  // Filter pie chart data
  const batchPerMinData = useMemo(
    () =>
      pie_batch_per_min[index]
        .filter(d => visibleSeries[d.program])
        .map(d => ({
          id: d.program,
          value: d.value,
          color: colorMap[d.program],
        })),
    [pie_batch_per_min, index, colorMap, visibleSeries]
  );
  
  const batchTotalData = useMemo(
    () =>
      pie_batch_total[index]
        .filter(d => visibleSeries[d.program])
        .map(d => ({
          id: d.program,
          value: d.value,
          color: colorMap[d.program],
        })),
    [pie_batch_total, index, colorMap, visibleSeries]
  );
  
  const giveawayPercentData = useMemo(
    () =>
      pie_giveaway_percent[index]
        .filter(d => visibleSeries[d.program])
        .map(d => ({
          id: d.program,
          value: d.value,
          color: colorMap[d.program],
        })),
    [pie_giveaway_percent, index, colorMap, visibleSeries]
  );
  
  const giveawayGramData = useMemo(
    () =>
      pie_giveaway_gram_batch[index]
        .filter(d => visibleSeries[d.program])
        .map(d => ({
          id: d.program,
          value: d.value,
          color: colorMap[d.program],
        })),
    [pie_giveaway_gram_batch, index, colorMap, visibleSeries]
  );

  const scatterData = useMemo(() => {
    const currentDate = new Date(timestamps[index]);
    const oneHourAgo = new Date(currentDate.getTime() - 3600 * 1000);
  
    const pts = scatter_distribution
      .filter(d => {
        const t = new Date(d.timestamp);
        return t >= oneHourAgo && t <= currentDate;
      })
      .map(d => ({
        x: d.timestamp,
        y: Number(d.weight),
      }));
  
    return [
      {
        id: "Pieces",
        data: pts,
      },
    ];
  }, [scatter_distribution, timestamps, index]);

  const formatTimeLabel = (timestamp) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { 
      hour: '2-digit', 
      minute: '2-digit',
      hour12: false
    });
  };

  const batchPerMinSum = useMemo(() => {
    return batchPerMinData.reduce((sum, item) => sum + item.value, 0);
  }, [batchPerMinData]);

  const batchTotalSum = useMemo(() => {
    return batchTotalData.reduce((sum, item) => sum + item.value, 0);
  }, [batchTotalData]);

  const giveawayGramSum = useMemo(() => {
    const sum = giveawayGramData.reduce((sum, item) => sum + item.value, 0);
    return Number(sum.toFixed(1));
  }, [giveawayGramData]);

  const giveawayPercentAvg = useMemo(() => {
    if (giveawayPercentData.length === 0) return 0;
    const sum = giveawayPercentData.reduce((sum, item) => sum + item.value, 0);
    return Number((sum / giveawayPercentData.length).toFixed(1));
  }, [giveawayPercentData]);

  const sharedLineProps = {
    margin: { top: 10, right: 20, bottom: 50, left: 40 },
    xScale: { type: 'point' },
    yScale: { type: 'linear', min: 'auto', max: 'auto' },
    curve: 'basis',
    enableArea: false,
    useMesh: true,
    axisTop: null,
    axisRight: null,
    pointSize: 0,
    pointColor: { theme: 'background' },
    pointBorderWidth: 2,
    pointBorderColor: { from: 'serieColor' },
    pointLabel: 'yFormatted',
    pointLabelYOffset: -12,
    axisBottom: {
      format: formatTimeLabel,
      tickRotation: 0,
      orient: "bottom",
      tickValues: (() => {
        const firstIndex = 0;
        const lastIndex = windowTimestamps.length - 1;
        const oneThirdIndex = Math.floor(lastIndex / 3);
        const twoThirdsIndex = Math.floor(2 * lastIndex / 3);
        
        return [
          windowTimestamps[firstIndex], 
          windowTimestamps[oneThirdIndex], 
          windowTimestamps[twoThirdsIndex], 
          windowTimestamps[lastIndex]
        ];
      })(),
      tickSize: 5,
      tickPadding: 5,
      axis: { 
        strokeWidth: 1 
      },
      line: { 
        strokeWidth: 1 
      },
    },
    axisLeft: {
      orient: "left",
      tickValues: 3,
      tickSize: 5,
      tickPadding: 5,
      tickRotation: 0,
      axis: { 
        strokeWidth: 1 
      },
      line: { 
        strokeWidth: 1 
      },
      legend: '',
      legendOffset: -35,
      legendPosition: 'middle',
    },
    theme: chartTheme,
    key: `line-chart-${theme.palette.mode}`,
    enableGridX: false,
    enableGridY: false,
  };

  const sharedPieProps = {
    margin: { top: 20, right: 5, bottom: 0, left: 5 },
    innerRadius: 0.65,
    padAngle: 3,
    cornerRadius: 3,
    activeOuterRadiusOffset: 8,
    borderWidth: 1,
    borderColor: { from: 'color', modifiers: [[ 'darker', 0.2 ]] },
    enableArcLinkLabels: false,
    arcLinkLabelsSkipAngle: 10,
    arcLinkLabelsTextColor: "#333333",
    arcLinkLabelsThickness: 2,
    arcLinkLabelsColor: { from: 'color' },
    arcLabelsSkipAngle: 10,
    arcLabelsTextColor: { theme: 'labels.text.fill' },
    valueFormat: ">-.0f",
    colors: ({ id }) => colorMap[id],
    theme: {
      labels: {
        text: {
          fill: tokens('dark').primary[900],
        },
      },
    }
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
        if (!scatterData[0] || !scatterData[0].data || scatterData[0].data.length === 0) {
          return [];
        }
        
        const dataPoints = scatterData[0].data;
        const totalPoints = dataPoints.length;
        
        if (totalPoints < 4) {
          return dataPoints.map(d => d.x);
        }
        
        return [
          dataPoints[0].x, 
          dataPoints[Math.floor(totalPoints * 0.33)].x, 
          dataPoints[Math.floor(totalPoints * 0.66)].x, 
          dataPoints[totalPoints - 1].x
        ];
      })(),
      tickSize: 5,
      tickPadding: 5,
      axis: { 
        strokeWidth: 1 
      },
      line: { 
        strokeWidth: 1 
      },
    },
    axisLeft: { 
      orient: "left",
      tickValues: 3,
      tickSize: 5,
      tickPadding: 5,
      tickRotation: 0,
      axis: { 
        strokeWidth: 1 
      },
      line: { 
        strokeWidth: 1 
      },
      legend: 'weight (g)',
      legendOffset: -35,
      legendPosition: 'middle',
    },
    theme: chartTheme,
    key: `scatter-chart-${theme.palette.mode}`,
    colors: () => colors.tealAccent[500],
    nodeSize: 3,
    useMesh: true,
    enableGridX: false,
    enableGridY: false,
  };

  const throughputProps = {
    ...sharedLineProps,
    axisLeft: {
      ...sharedLineProps.axisLeft,
      legend: 'batch / min',
    }
  };

  const giveawayProps = {
    ...sharedLineProps,
    axisLeft: {
      ...sharedLineProps.axisLeft,
      legend: '%',
    }
  };
  
  const rejectsProps = {
    ...sharedLineProps,
    axisLeft: {
      ...sharedLineProps.axisLeft,
      legend: 'piece / min',
    },
    enableArea: true,
    areaBaselineValue: 0,
    yScale: { 
      type: 'linear', 
      min: 0, 
      max: 'auto' 
    }
  };

  return(
    <Box 
      m="20px" 
      height="calc(100vh - 200px)" 
      maxHeight="calc(100vh - 200px)" 
      sx={{ 
        overflow: "visible",
        display: "flex",
        flexDirection: "column"
      }}
    > 
      <Box display="flex" justifyContent="space-between" alignItems="center" mb="20px" sx={{ m: "0px 0 0 0" }} >
        <Header title="Dashboard" subtitle="Performance Overview" />
        
        <Box 
          display="flex" 
          alignItems="center"
          justifyContent="flex-end"
          gap="20px"
          mr="20px"
        >
          {Object.entries(colorMap).map(([program, color]) => (
            <Box 
              key={program}
              display="flex" 
              alignItems="center" 
              gap="5px"
              onClick={() => toggleSeries(program)}
              sx={{ 
                cursor: 'pointer',
                opacity: visibleSeries[program] ? 1 : 0.4,
                transition: 'all 0.2s',
                '&:hover': {
                  transform: 'scale(1.05)',
                },
                border: visibleSeries[program] ? 'none' : `1px solid ${colors.grey[300]}`,
                borderRadius: '4px',
                padding: '2px 6px',
              }}
            >
              <Box 
                width="12px" 
                height="12px" 
                borderRadius="50%" 
                sx={{ backgroundColor: color }} 
              />
              <Typography variant="h7" color={colors.primary[800]}>
                {program}
              </Typography>
            </Box>
          ))}
        </Box>
      </Box>

      <Box
        display="grid"
        gridTemplateColumns="repeat(12, 1fr)"
        gridTemplateRows="repeat(12, 1fr)"
        gap="20px"
        sx={{
          flex: 1,
          minHeight: 0,
          overflow: "hidden"
        }}
      >
        {/* Machine Image - Top Row */}
        <Box 
          gridColumn="1 / span 10" 
          gridRow="1 / span 4" 
          sx={{ 
            backgroundColor: colors.primary[100], 
            borderRadius: 1.5, 
            overflow: "hidden", 
            position: 'relative' 
          }}
        >
          <AnnotatedMachineImage colorMap={colorMap} gateData={gateSimulation[index]} />
        </Box>

        {/* Scatter Plot - Middle Row */}
        <Box
          gridColumn="1 / span 10"
          gridRow="5 / span 4"
          sx={{
            backgroundColor: colors.primary[100],
            p: "15px",
            borderRadius: 1.5,
            overflow: "hidden",
          }}
        >
          <Typography variant="h5" color={colors.tealAccent[500]} mb="10px">
            Piece Weight Distribution
          </Typography>
          <Box sx={{ height: "calc(100% - 40px)", position: "relative" }}>
            <ResponsiveScatterPlot
              data={scatterData}
              theme={chartTheme}
              key={`scatter-${theme.palette.mode}`}
              {...sharedScatterProps}
            />
          </Box>
        </Box>

        {/* Line Charts - Bottom Row */}
        <Box
          gridColumn="1 / span 10"
          gridRow="9 / span 4"
          display="grid"
          gridTemplateColumns="repeat(3, 1fr)"
          gap="20px"
        >
          <Box sx={{ backgroundColor: colors.primary[100], borderRadius: 1.5, overflow: "hidden"}} p="15px">
            <Typography variant="h5" color={colors.tealAccent[500]}>
              Throughput
            </Typography>
            <ResponsiveLine
              data={throughputData}
              colors={d => d.color}
              theme={chartTheme}
              key={`throughput-${theme.palette.mode}`}
              {...throughputProps}
            />
          </Box>
          <Box sx={{ backgroundColor: colors.primary[100], borderRadius: 1.5, overflow: "hidden"}} p="15px">
            <Typography variant="h5" color={colors.tealAccent[500]}>
              Give-away
            </Typography>
            <ResponsiveLine
              data={giveawayData}
              colors={d => d.color}
              theme={chartTheme}
              key={`giveaway-${theme.palette.mode}`}
              {...giveawayProps}
            />
          </Box>
          <Box sx={{ backgroundColor: colors.primary[100], borderRadius: 1.5, overflow: "hidden"}} p="15px">
            <Typography variant="h5" color={colors.tealAccent[500]}>
              Rejects
            </Typography>
            <ResponsiveLine
              data={rejectsData}
              colors={d => d.color}
              theme={chartTheme}
              key={`rejects-${theme.palette.mode}`}
              {...rejectsProps}
            />
          </Box>
        </Box>
        
        {/* Pie Charts - Right Column */}
        <Box 
          gridColumn="11 / span 2" 
          gridRow="1 / span 12" 
          display="grid"
          gridTemplateRows="repeat(4, 1fr)"
          gap="5px"
        >
          {/* Batch per min */}
          <Box sx={{ 
            backgroundColor: colors.primary[100], 
            borderRadius: 1.5, 
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
          }} p="15px">
            <Typography variant="h5" color={colors.tealAccent[500]}>
              Batch per min
            </Typography>
            <Typography variant="h6" color={colors.primary[800]} sx={{mb:"-10px"}}>
              Sum : {Math.round(batchPerMinSum)}
            </Typography>
            <Box sx={{ 
              height: "calc(100%)", 
              position: "relative",
              overflow: "hidden" 
            }}>
              <ResponsivePie 
                data={batchPerMinData} 
                {...sharedPieProps} 
              />
            </Box>
          </Box>

          {/* Batch total */}
          <Box sx={{ 
            backgroundColor: colors.primary[100], 
            borderRadius: 1.5, 
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
          }} p="15px">
            <Typography variant="h5" color={colors.tealAccent[500]}>
              Batch total
            </Typography>
            <Typography variant="h6" color={colors.primary[800]} sx={{mb:"-10px"}}>
              Sum : {Math.round(batchTotalSum)}
            </Typography>
            <Box sx={{ 
              height: "calc(100%)", 
              position: "relative",
              overflow: "hidden" 
            }}>
              <ResponsivePie 
                data={batchTotalData} 
                {...sharedPieProps} 
              />
            </Box>
          </Box>

          {/* Give-away (g/batch) */}
          <Box sx={{ 
            backgroundColor: colors.primary[100], 
            borderRadius: 1.5, 
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
          }} p="15px">
            <Typography variant="h5" color={colors.tealAccent[500]}>
              Give-away (g/batch)
            </Typography>
            <Typography variant="h6" color={colors.primary[800]} sx={{mb:"-10px"}}>
              Sum : {giveawayGramSum}
            </Typography>
            <Box sx={{ 
              height: "calc(100%)", 
              position: "relative",
              overflow: "hidden" 
            }}>
              <ResponsivePie 
                data={giveawayGramData} 
                {...sharedPieProps} 
              />
            </Box>
          </Box>

          {/* Give-away (%) */}
          <Box sx={{ 
            backgroundColor: colors.primary[100], 
            borderRadius: 1.5, 
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
          }} p="15px">
            <Typography variant="h5" color={colors.tealAccent[500]}>
              Give-away (%)
            </Typography>
            <Typography variant="h6" color={colors.primary[800]} sx={{mb:"-10px"}}>
              Avg : {giveawayPercentAvg}
            </Typography>
            <Box sx={{ 
              height: "calc(100% )", 
              position: "relative",
              overflow: "hidden" 
            }}>
              <ResponsivePie 
                data={giveawayPercentData} 
                {...sharedPieProps} 
              />
            </Box>
          </Box>
        </Box>
      </Box>
    </Box>
  );
};

export default Dashboard;




import React, { useState, useEffect, useMemo } from "react";
import { Box, useTheme, Typography } from "@mui/material";
import { ResponsiveLine } from "@nivo/line";
import { ResponsivePie } from "@nivo/pie";
import { ResponsiveScatterPlot } from "@nivo/scatterplot";
import { tokens } from "../../theme";
import Header from "../../components/Header";
import mockData from "../../data/mockData_json5.json";

// Annotated machine image with per-gate overlay
const AnnotatedMachineImage = ({ colorMap, gateData }) => {
  const theme = useTheme();
  const colors = tokens(theme.palette.mode);

  const annotationPositions = [
    { gate: 1, x1: '36%', y1: '70%', x2: '10%', y2: '15%', program: 'Program A' },
    { gate: 2, x1: '34%', y1: '60%', x2: '20%', y2: '15%', program: 'Program A' },
    { gate: 3, x1: '33%', y1: '50%', x2: '30%', y2: '15%', program: 'Program C' },
    { gate: 4, x1: '43%', y1: '35%', x2: '40%', y2: '15%', program: 'Program D' },
    { gate: 5, x1: '55%', y1: '75%', x2: '65%', y2: '85%', program: 'Program A' },
    { gate: 6, x1: '50%', y1: '65%', x2: '75%', y2: '85%', program: 'Program B' },
    { gate: 7, x1: '40%', y1: '75%', x2: '85%', y2: '85%', program: 'Program C' },
    { gate: 8, x1: '68%', y1: '35%', x2: '95%', y2: '85%', program: 'Program B' },
  ];

  return (
    <Box sx={{ position: 'relative', width: '100%', height: '100%' }}>
      <img
        alt="machine"
        // width="90%"
        style={{
          position: 'absolute',
          top: '53%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          maxHeight: '120%'
        }}
        src="../../assets/Marelec_Grader_8.png"
      />
      <Box
        component="svg"
        sx={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
      >
        {/* {annotationPositions.map((pos, idx) => {
          const midX = `calc(${pos.x1} + ${(parseFloat(pos.x2) - parseFloat(pos.x1)) * 0.3}%)`;
          return (
            <React.Fragment key={idx}>
              <line x1={pos.x1} y1={pos.y1} x2={midX} y2={pos.y1} stroke={colorMap[pos.program]} strokeWidth={2} />
              <line x1={midX} y1={pos.y1} x2={pos.x2} y2={pos.y2} stroke={colorMap[pos.program]} strokeWidth={2} />
            </React.Fragment>
          );
        })} */}
      </Box>

      {annotationPositions.map((pos, idx) => {
        // pick correct gate record (array or object)
        const info = gateData
          ? Array.isArray(gateData)
            ? gateData[pos.gate - 1]
            : gateData[pos.gate]
          : {};
        const pieces = info.pieces ?? 0;
        const sumGrams = info.sumGrams ?? 0;

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
              border: `1px solid ${colorMap[pos.program]}`,
              width: '100px',
              boxShadow: 3,
              overflow: 'hidden',
            }}
          >
            <Box sx={{ backgroundColor: colorMap[pos.program], py: 0.1, px: 0.5, textAlign: 'left' }}>
              <Typography variant="body2" color="#fff">
                G{pos.gate}: {pos.program}
              </Typography>
            </Box>
            <Box sx={{ p: 0.5 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', borderBottom: `1px solid ${colors.grey[300]}`, py: 0.1 }}>
                <Typography variant="body2" color={colors.primary[800]} fontWeight="bold">
                  Pieces:
                </Typography>
                <Typography variant="body2" color={colors.primary[800]}> {pieces} </Typography>
              </Box>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', py: 0.1 }}>
                <Typography variant="body2" color={colors.primary[800]} fontWeight="bold">
                  Gram:
                </Typography>
                <Typography variant="body2" color={colors.primary[800]}> {sumGrams.toFixed(1)} </Typography>
              </Box>
            </Box>
          </Box>
        );
      })}
    </Box>
  );
};

const Dashboard = () => {
  const theme = useTheme();
  const colors = tokens(theme.palette.mode);
  const isDarkMode = theme.palette.mode === 'dark';

  // Add state to track visible series
  const [visibleSeries, setVisibleSeries] = useState({
    "Program A": true,
    "Program B": true,
    "Program C": true,
    "Program D": true,
    "Total": true
  });

  // Toggle visibility of a series
  const toggleSeries = (program) => {
    setVisibleSeries(prev => ({
      ...prev,
      [program]: !prev[program]
    }));
  };

  const chartTheme = {
    axis: {
      domain: {
        line: {
          stroke: isDarkMode ? colors.primary[800] : colors.primary[800],
          strokeWidth: 1,
        },
      },
      legend: {
        text: {
          fill: isDarkMode ? colors.primary[800] : colors.primary[800],
        },
      },
      ticks: {
        line: {
          stroke: isDarkMode ? colors.primary[800] : colors.primary[800] ,
          strokeWidth: 1,
        },
        text: {
          fill: isDarkMode ? colors.primary[800] : colors.primary[800],
          fontSize: 11,
        },
      },
    },
    grid: {
      line: {
        stroke: isDarkMode ? colors.primary[800] : colors.primary[800],
        strokeWidth: 1,
      },
    },
    legends: {
      text: {
        fill: isDarkMode ? colors.primary[800] : colors.primary[800],
      },
    },
    tooltip: {
      container: {
        background: isDarkMode ? colors.primary[400] : colors.primary[100],
        color: isDarkMode ? colors.grey[100] : colors.grey[900],
      },
    },
  };

  const {
    timestamps,
    throughput,
    throughput_sum,
    rejects,
    giveaway,
    pie_batch_per_min,
    pie_batch_total,
    pie_giveaway_percent,
    pie_giveaway_gram_batch,
    scatter_distribution
  } = mockData;
  const totalPoints = timestamps.length;
  const windowSize = 60;
  const [index, setIndex] = useState(windowSize - 1);

  // define which program each gate runs, and its caps
  const gateMapping = {
    1: 'Program A', 2: 'Program A', 3: 'Program B', 4: 'Program D',
    5: 'Program B', 6: 'Program A', 7: 'Program C', 8: 'Program C'
  };
  const programLimits = {
    'Program A': { maxPieces: 10, maxGram: 100 },
    'Program B': { maxPieces: 3, maxGram: 200 },
    'Program C': { maxPieces: 4, maxGram: 150 },
    'Program D': { maxPieces: 8, maxGram: 150 },
  };

  // simulate each gate's (pieces, sumGrams) over time
  const gateSimulation = useMemo(() => {
    const sim = [];
    const state = {};
    for (let g = 1; g <= 8; g++) state[g] = { pieces: 0, sumGrams: 0 };

    for (let t = 0; t < totalPoints; t++) {
      const snapshot = {};
      for (let g = 1; g <= 8; g++) {
        const prog = gateMapping[g];
        const { maxPieces, maxGram } = programLimits[prog];
        const prev = state[g].pieces;
        const nextPieces = prev + 1 > maxPieces ? 0 : prev + 1;
        let sum = 0;
        for (let i = 0; i < nextPieces; i++) sum += Math.random() * maxGram;

        state[g] = { pieces: nextPieces, sumGrams: sum };
        snapshot[g] = state[g];
      }
      sim.push(snapshot);
    }
    return sim;
  }, [totalPoints]);

  useEffect(() => {
    const iv = setInterval(() => setIndex(i => (i + 1) % totalPoints), 2000);
    return () => clearInterval(iv);
  }, [totalPoints]);

  const isWrapped = index < windowSize - 1;
  const windowTimestamps = isWrapped
    ? timestamps.slice(0, windowSize)
    : timestamps.slice(index - (windowSize - 1), index + 1);
  const windowData = arr =>
    isWrapped ? arr.slice(0, windowSize) : arr.slice(index - (windowSize - 1), index + 1);

  const colorMap = useMemo(() => ({
    "Program A": colors.tealAccent[500],
    "Program B": colors.redAccent[500],
    "Program C": colors.purpleAccent[500],
    "Program D": colors.orangeAccent[500],
    Total: colors.beigeAccent[400],
  }), [
    colors.tealAccent,
    colors.redAccent,
    colors.purpleAccent,
    colors.orangeAccent,
    colors.beigeAccent,
  ]);

  // Filter data based on visible series
  const throughputData = useMemo(() => {
    const series = Object.entries(throughput)
      .filter(([prog]) => visibleSeries[prog])
      .map(([prog, arr]) => ({
        id: prog,
        color: colorMap[prog],
        data: windowTimestamps.map((t, i) => ({ x: t, y: windowData(arr)[i] })),
      }));
    
    if (visibleSeries["Total"]) {
      series.push({
        id: "Total",
        color: colorMap.Total,
        data: windowTimestamps.map((t, i) => ({ x: t, y: windowData(throughput_sum)[i] })),
      });
    }
    return series;
  }, [throughput, throughput_sum, windowTimestamps, index, colorMap, visibleSeries]);

  const giveawayData = useMemo(() =>
    Object.entries(giveaway)
      .filter(([prog]) => visibleSeries[prog])
      .map(([prog, arr]) => ({
        id: prog,
        color: colorMap[prog],
        data: windowTimestamps.map((t, i) => ({ x: t, y: windowData(arr)[i] })),
      })),
    [giveaway, windowTimestamps, index, colorMap, visibleSeries]
  );

  const rejectsData = useMemo(() => {
    if (!visibleSeries["Total"]) return [];
    
    return [{
      id: "Total",
      color: colorMap.Total,
      data: windowTimestamps.map((t, i) => ({
        x: t,
        y: windowData(rejects)[i],
      })),
    }];
  }, [rejects, windowTimestamps, index, colorMap, visibleSeries]);

  // Filter pie chart data
  const batchPerMinData = useMemo(
    () =>
      pie_batch_per_min[index]
        .filter(d => visibleSeries[d.program])
        .map(d => ({
          id: d.program,
          value: d.value,
          color: colorMap[d.program],
        })),
    [pie_batch_per_min, index, colorMap, visibleSeries]
  );
  
  const batchTotalData = useMemo(
    () =>
      pie_batch_total[index]
        .filter(d => visibleSeries[d.program])
        .map(d => ({
          id: d.program,
          value: d.value,
          color: colorMap[d.program],
        })),
    [pie_batch_total, index, colorMap, visibleSeries]
  );
  
  const giveawayPercentData = useMemo(
    () =>
      pie_giveaway_percent[index]
        .filter(d => visibleSeries[d.program])
        .map(d => ({
          id: d.program,
          value: d.value,
          color: colorMap[d.program],
        })),
    [pie_giveaway_percent, index, colorMap, visibleSeries]
  );
  
  const giveawayGramData = useMemo(
    () =>
      pie_giveaway_gram_batch[index]
        .filter(d => visibleSeries[d.program])
        .map(d => ({
          id: d.program,
          value: d.value,
          color: colorMap[d.program],
        })),
    [pie_giveaway_gram_batch, index, colorMap, visibleSeries]
  );

  const scatterData = useMemo(() => {
    const currentDate = new Date(timestamps[index]);
    const oneHourAgo = new Date(currentDate.getTime() - 3600 * 1000);
  
    const pts = scatter_distribution
      .filter(d => {
        const t = new Date(d.timestamp);
        return t >= oneHourAgo && t <= currentDate;
      })
      .map(d => ({
        x: d.timestamp,
        y: Number(d.weight),
      }));
  
    return [
      {
        id: "Pieces",
        data: pts,
      },
    ];
  }, [scatter_distribution, timestamps, index]);

  const formatTimeLabel = (timestamp) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { 
      hour: '2-digit', 
      minute: '2-digit',
      hour12: false
    });
  };

  const batchPerMinSum = useMemo(() => {
    return batchPerMinData.reduce((sum, item) => sum + item.value, 0);
  }, [batchPerMinData]);

  const batchTotalSum = useMemo(() => {
    return batchTotalData.reduce((sum, item) => sum + item.value, 0);
  }, [batchTotalData]);

  const giveawayGramSum = useMemo(() => {
    const sum = giveawayGramData.reduce((sum, item) => sum + item.value, 0);
    return Number(sum.toFixed(1));
  }, [giveawayGramData]);

  const giveawayPercentAvg = useMemo(() => {
    if (giveawayPercentData.length === 0) return 0;
    const sum = giveawayPercentData.reduce((sum, item) => sum + item.value, 0);
    return Number((sum / giveawayPercentData.length).toFixed(1));
  }, [giveawayPercentData]);

  const sharedLineProps = {
    margin: { top: 10, right: 20, bottom: 50, left: 40 },
    xScale: { type: 'point' },
    yScale: { type: 'linear', min: 'auto', max: 'auto' },
    curve: 'basis',
    enableArea: false,
    useMesh: true,
    axisTop: null,
    axisRight: null,
    pointSize: 0,
    pointColor: { theme: 'background' },
    pointBorderWidth: 2,
    pointBorderColor: { from: 'serieColor' },
    pointLabel: 'yFormatted',
    pointLabelYOffset: -12,
    axisBottom: {
      format: formatTimeLabel,
      tickRotation: 0,
      orient: "bottom",
      tickValues: (() => {
        const firstIndex = 0;
        const lastIndex = windowTimestamps.length - 1;
        const oneThirdIndex = Math.floor(lastIndex / 3);
        const twoThirdsIndex = Math.floor(2 * lastIndex / 3);
        
        return [
          windowTimestamps[firstIndex], 
          windowTimestamps[oneThirdIndex], 
          windowTimestamps[twoThirdsIndex], 
          windowTimestamps[lastIndex]
        ];
      })(),
      tickSize: 5,
      tickPadding: 5,
      axis: { 
        strokeWidth: 1 
      },
      line: { 
        strokeWidth: 1 
      },
    },
    axisLeft: {
      orient: "left",
      tickValues: 3,
      tickSize: 5,
      tickPadding: 5,
      tickRotation: 0,
      axis: { 
        strokeWidth: 1 
      },
      line: { 
        strokeWidth: 1 
      },
      legend: '',
      legendOffset: -35,
      legendPosition: 'middle',
    },
    theme: chartTheme,
    key: `line-chart-${theme.palette.mode}`,
    enableGridX: false,
    enableGridY: false,
  };

  const sharedPieProps = {
    margin: { top: 20, right: 5, bottom: 0, left: 5 },
    innerRadius: 0.65,
    padAngle: 3,
    cornerRadius: 3,
    activeOuterRadiusOffset: 8,
    borderWidth: 1,
    borderColor: { from: 'color', modifiers: [[ 'darker', 0.2 ]] },
    enableArcLinkLabels: false,
    arcLinkLabelsSkipAngle: 10,
    arcLinkLabelsTextColor: "#333333",
    arcLinkLabelsThickness: 2,
    arcLinkLabelsColor: { from: 'color' },
    arcLabelsSkipAngle: 10,
    arcLabelsTextColor: { theme: 'labels.text.fill' },
    valueFormat: ">-.0f",
    colors: ({ id }) => colorMap[id],
    theme: {
      labels: {
        text: {
          fill: tokens('dark').primary[900],
        },
      },
    }
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
        if (!scatterData[0] || !scatterData[0].data || scatterData[0].data.length === 0) {
          return [];
        }
        
        const dataPoints = scatterData[0].data;
        const totalPoints = dataPoints.length;
        
        if (totalPoints < 4) {
          return dataPoints.map(d => d.x);
        }
        
        return [
          dataPoints[0].x, 
          dataPoints[Math.floor(totalPoints * 0.33)].x, 
          dataPoints[Math.floor(totalPoints * 0.66)].x, 
          dataPoints[totalPoints - 1].x
        ];
      })(),
      tickSize: 5,
      tickPadding: 5,
      axis: { 
        strokeWidth: 1 
      },
      line: { 
        strokeWidth: 1 
      },
    },
    axisLeft: { 
      orient: "left",
      tickValues: 3,
      tickSize: 5,
      tickPadding: 5,
      tickRotation: 0,
      axis: { 
        strokeWidth: 1 
      },
      line: { 
        strokeWidth: 1 
      },
      legend: 'weight (g)',
      legendOffset: -35,
      legendPosition: 'middle',
    },
    theme: chartTheme,
    key: `scatter-chart-${theme.palette.mode}`,
    colors: () => colors.tealAccent[500],
    nodeSize: 3,
    useMesh: true,
    enableGridX: false,
    enableGridY: false,
  };

  const throughputProps = {
    ...sharedLineProps,
    axisLeft: {
      ...sharedLineProps.axisLeft,
      legend: 'batch / min',
    }
  };

  const giveawayProps = {
    ...sharedLineProps,
    axisLeft: {
      ...sharedLineProps.axisLeft,
      legend: '%',
    }
  };
  
  const rejectsProps = {
    ...sharedLineProps,
    axisLeft: {
      ...sharedLineProps.axisLeft,
      legend: 'piece / min',
    },
    enableArea: true,
    areaBaselineValue: 0,
    yScale: { 
      type: 'linear', 
      min: 0, 
      max: 'auto' 
    }
  };

  return(
    <Box 
      m="20px" 
      height="calc(100vh - 200px)" 
      maxHeight="calc(100vh - 200px)" 
      sx={{ 
        overflow: "visible",
        display: "flex",
        flexDirection: "column"
      }}
    > 
      <Box display="flex" justifyContent="space-between" alignItems="center" mb="20px" sx={{ m: "0px 0 0 0" }} >
        <Header title="Dashboard" subtitle="Performance Overview" />
        
        <Box 
          display="flex" 
          alignItems="center"
          justifyContent="flex-end"
          gap="20px"
          mr="20px"
        >
          {Object.entries(colorMap).map(([program, color]) => (
            <Box 
              key={program}
              display="flex" 
              alignItems="center" 
              gap="5px"
              onClick={() => toggleSeries(program)}
              sx={{ 
                cursor: 'pointer',
                opacity: visibleSeries[program] ? 1 : 0.4,
                transition: 'all 0.2s',
                '&:hover': {
                  transform: 'scale(1.05)',
                },
                border: visibleSeries[program] ? 'none' : `1px solid ${colors.grey[300]}`,
                borderRadius: '4px',
                padding: '2px 6px',
              }}
            >
              <Box 
                width="12px" 
                height="12px" 
                borderRadius="50%" 
                sx={{ backgroundColor: color }} 
              />
              <Typography variant="h7" color={colors.primary[800]}>
                {program}
              </Typography>
            </Box>
          ))}
        </Box>
      </Box>

      <Box
        display="grid"
        gridTemplateColumns="repeat(12, 1fr)"
        gridTemplateRows="repeat(12, 1fr)"
        gap="20px"
        sx={{
          flex: 1,
          minHeight: 0,
          overflow: "hidden"
        }}
      >
        {/* Machine Image - Top Row */}
        <Box 
          gridColumn="1 / span 10" 
          gridRow="1 / span 4" 
          sx={{ 
            backgroundColor: colors.primary[100], 
            borderRadius: 1.5, 
            overflow: "hidden", 
            position: 'relative' 
          }}
        >
          <AnnotatedMachineImage colorMap={colorMap} gateData={gateSimulation[index]} />
        </Box>

        {/* Scatter Plot - Middle Row */}
        <Box
          gridColumn="1 / span 10"
          gridRow="5 / span 4"
          sx={{
            backgroundColor: colors.primary[100],
            p: "15px",
            borderRadius: 1.5,
            overflow: "hidden",
          }}
        >
          <Typography variant="h5" color={colors.tealAccent[500]} mb="10px">
            Piece Weight Distribution
          </Typography>
          <Box sx={{ height: "calc(100% - 40px)", position: "relative" }}>
            <ResponsiveScatterPlot
              data={scatterData}
              theme={chartTheme}
              key={`scatter-${theme.palette.mode}`}
              {...sharedScatterProps}
            />
          </Box>
        </Box>

        {/* Line Charts - Bottom Row */}
        <Box
          gridColumn="1 / span 10"
          gridRow="9 / span 4"
          display="grid"
          gridTemplateColumns="repeat(3, 1fr)"
          gap="20px"
        >
          <Box sx={{ backgroundColor: colors.primary[100], borderRadius: 1.5, overflow: "hidden"}} p="15px">
            <Typography variant="h5" color={colors.tealAccent[500]}>
              Throughput
            </Typography>
            <ResponsiveLine
              data={throughputData}
              colors={d => d.color}
              theme={chartTheme}
              key={`throughput-${theme.palette.mode}`}
              {...throughputProps}
            />
          </Box>
          <Box sx={{ backgroundColor: colors.primary[100], borderRadius: 1.5, overflow: "hidden"}} p="15px">
            <Typography variant="h5" color={colors.tealAccent[500]}>
              Give-away
            </Typography>
            <ResponsiveLine
              data={giveawayData}
              colors={d => d.color}
              theme={chartTheme}
              key={`giveaway-${theme.palette.mode}`}
              {...giveawayProps}
            />
          </Box>
          <Box sx={{ backgroundColor: colors.primary[100], borderRadius: 1.5, overflow: "hidden"}} p="15px">
            <Typography variant="h5" color={colors.tealAccent[500]}>
              Rejects
            </Typography>
            <ResponsiveLine
              data={rejectsData}
              colors={d => d.color}
              theme={chartTheme}
              key={`rejects-${theme.palette.mode}`}
              {...rejectsProps}
            />
          </Box>
        </Box>
        
        {/* Pie Charts - Right Column */}
        <Box 
          gridColumn="11 / span 2" 
          gridRow="1 / span 12" 
          display="grid"
          gridTemplateRows="repeat(4, 1fr)"
          gap="5px"
        >
          {/* Batch per min */}
          <Box sx={{ 
            backgroundColor: colors.primary[100], 
            borderRadius: 1.5, 
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
          }} p="15px">
            <Typography variant="h5" color={colors.tealAccent[500]}>
              Batch per min
            </Typography>
            <Typography variant="h6" color={colors.primary[800]} sx={{mb:"-10px"}}>
              Sum : {Math.round(batchPerMinSum)}
            </Typography>
            <Box sx={{ 
              height: "calc(100%)", 
              position: "relative",
              overflow: "hidden" 
            }}>
              <ResponsivePie 
                data={batchPerMinData} 
                {...sharedPieProps} 
              />
            </Box>
          </Box>

          {/* Batch total */}
          <Box sx={{ 
            backgroundColor: colors.primary[100], 
            borderRadius: 1.5, 
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
          }} p="15px">
            <Typography variant="h5" color={colors.tealAccent[500]}>
              Batch total
            </Typography>
            <Typography variant="h6" color={colors.primary[800]} sx={{mb:"-10px"}}>
              Sum : {Math.round(batchTotalSum)}
            </Typography>
            <Box sx={{ 
              height: "calc(100%)", 
              position: "relative",
              overflow: "hidden" 
            }}>
              <ResponsivePie 
                data={batchTotalData} 
                {...sharedPieProps} 
              />
            </Box>
          </Box>

          {/* Give-away (g/batch) */}
          <Box sx={{ 
            backgroundColor: colors.primary[100], 
            borderRadius: 1.5, 
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
          }} p="15px">
            <Typography variant="h5" color={colors.tealAccent[500]}>
              Give-away (g/batch)
            </Typography>
            <Typography variant="h6" color={colors.primary[800]} sx={{mb:"-10px"}}>
              Sum : {giveawayGramSum}
            </Typography>
            <Box sx={{ 
              height: "calc(100%)", 
              position: "relative",
              overflow: "hidden" 
            }}>
              <ResponsivePie 
                data={giveawayGramData} 
                {...sharedPieProps} 
              />
            </Box>
          </Box>

          {/* Give-away (%) */}
          <Box sx={{ 
            backgroundColor: colors.primary[100], 
            borderRadius: 1.5, 
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
          }} p="15px">
            <Typography variant="h5" color={colors.tealAccent[500]}>
              Give-away (%)
            </Typography>
            <Typography variant="h6" color={colors.primary[800]} sx={{mb:"-10px"}}>
              Avg : {giveawayPercentAvg}
            </Typography>
            <Box sx={{ 
              height: "calc(100% )", 
              position: "relative",
              overflow: "hidden" 
            }}>
              <ResponsivePie 
                data={giveawayPercentData} 
                {...sharedPieProps} 
              />
            </Box>
          </Box>
        </Box>
      </Box>
    </Box>
  );
};

export default Dashboard;






import React, { useState, useEffect, useMemo } from "react";
import { Box, useTheme, Typography } from "@mui/material";
import { ResponsiveLine } from "@nivo/line";
import { ResponsivePie } from "@nivo/pie";
import { ResponsiveScatterPlot } from "@nivo/scatterplot";
import { tokens } from "../../theme";
import Header from "../../components/Header";
import mockData from "../../data/mockData_json6.json";

// Annotated machine image with per-gate overlay
const AnnotatedMachineImage = ({ colorMap, gateData }) => {
  const theme = useTheme();
  const colors = tokens(theme.palette.mode);

  const annotationPositions = [
    { gate: 1, x1: '36%', y1: '70%', x2: '10%', y2: '15%', program: 'Program A' },
    { gate: 2, x1: '34%', y1: '60%', x2: '20%', y2: '15%', program: 'Program A' },
    { gate: 3, x1: '33%', y1: '50%', x2: '30%', y2: '15%', program: 'Program C' },
    { gate: 4, x1: '43%', y1: '35%', x2: '40%', y2: '15%', program: 'Program D' },
    { gate: 5, x1: '55%', y1: '75%', x2: '65%', y2: '85%', program: 'Program A' },
    { gate: 6, x1: '50%', y1: '65%', x2: '75%', y2: '85%', program: 'Program B' },
    { gate: 7, x1: '40%', y1: '75%', x2: '85%', y2: '85%', program: 'Program C' },
    { gate: 8, x1: '68%', y1: '35%', x2: '95%', y2: '85%', program: 'Program B' },
  ];

  return (
    <Box sx={{ position: 'relative', width: '100%', height: '100%' }}>
      <img
        alt="machine"
        // width="90%"
        style={{
          position: 'absolute',
          top: '53%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          maxHeight: '120%'
        }}
        src="../../assets/Marelec_Grader_8.png"
      />
      <Box
        component="svg"
        sx={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
      >
        {/* {annotationPositions.map((pos, idx) => {
          const midX = `calc(${pos.x1} + ${(parseFloat(pos.x2) - parseFloat(pos.x1)) * 0.3}%)`;
          return (
            <React.Fragment key={idx}>
              <line x1={pos.x1} y1={pos.y1} x2={midX} y2={pos.y1} stroke={colorMap[pos.program]} strokeWidth={2} />
              <line x1={midX} y1={pos.y1} x2={pos.x2} y2={pos.y2} stroke={colorMap[pos.program]} strokeWidth={2} />
            </React.Fragment>
          );
        })} */}
      </Box>

      {annotationPositions.map((pos, idx) => {
        // pick correct gate record (array or object)
        const info = gateData
          ? Array.isArray(gateData)
            ? gateData[pos.gate - 1]
            : gateData[pos.gate]
          : {};
        const pieces = info.pieces ?? 0;
        const sumGrams = info.sumGrams ?? 0;

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
              border: `1px solid ${colorMap[pos.program]}`,
              width: '100px',
              boxShadow: 3,
              overflow: 'hidden',
            }}
          >
            <Box sx={{ backgroundColor: colorMap[pos.program], py: 0.1, px: 0.5, textAlign: 'left' }}>
              <Typography variant="body2" color="#fff">
                G{pos.gate}: {pos.program}
              </Typography>
            </Box>
            <Box sx={{ p: 0.5 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', borderBottom: `1px solid ${colors.grey[300]}`, py: 0.1 }}>
                <Typography variant="body2" color={colors.primary[800]} fontWeight="bold">
                  Pieces:
                </Typography>
                <Typography variant="body2" color={colors.primary[800]}> {pieces} </Typography>
              </Box>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', py: 0.1 }}>
                <Typography variant="body2" color={colors.primary[800]} fontWeight="bold">
                  Gram:
                </Typography>
                <Typography variant="body2" color={colors.primary[800]}> {sumGrams.toFixed(1)} </Typography>
              </Box>
            </Box>
          </Box>
        );
      })}
    </Box>
  );
};

const Dashboard = () => {
  const theme = useTheme();
  const colors = tokens(theme.palette.mode);
  const isDarkMode = theme.palette.mode === 'dark';

  // Add state to track visible series
  const [visibleSeries, setVisibleSeries] = useState({
    "Program A": true,
    "Program B": true,
    "Program C": true,
    "Program D": true,
    "Total": true
  });

  // Toggle visibility of a series
  const toggleSeries = (program) => {
    setVisibleSeries(prev => ({
      ...prev,
      [program]: !prev[program]
    }));
  };

  const chartTheme = {
    axis: {
      domain: {
        line: {
          stroke: isDarkMode ? colors.primary[800] : colors.primary[800],
          strokeWidth: 1,
        },
      },
      legend: {
        text: {
          fill: isDarkMode ? colors.primary[800] : colors.primary[800],
        },
      },
      ticks: {
        line: {
          stroke: isDarkMode ? colors.primary[800] : colors.primary[800] ,
          strokeWidth: 1,
        },
        text: {
          fill: isDarkMode ? colors.primary[800] : colors.primary[800],
          fontSize: 11,
        },
      },
    },
    grid: {
      line: {
        stroke: isDarkMode ? colors.primary[800] : colors.primary[800],
        strokeWidth: 1,
      },
    },
    legends: {
      text: {
        fill: isDarkMode ? colors.primary[800] : colors.primary[800],
      },
    },
    tooltip: {
      container: {
        background: isDarkMode ? colors.primary[400] : colors.primary[100],
        color: isDarkMode ? colors.grey[100] : colors.grey[900],
      },
    },
  };

  const {
    timestamps,
    throughput,
    throughput_sum,
    rejects,
    giveaway,
    pie_batch_per_min,
    pie_batch_total,
    pie_giveaway_percent,
    pie_giveaway_gram_batch,
    scatter_distribution
  } = mockData;
  const totalPoints = timestamps.length;
  const windowSize = 60;
  const [index, setIndex] = useState(windowSize - 1);

  // define which program each gate runs, and its caps
  const gateMapping = {
    1: 'Program A', 2: 'Program A', 3: 'Program B', 4: 'Program D',
    5: 'Program B', 6: 'Program A', 7: 'Program C', 8: 'Program C'
  };
  const programLimits = {
    'Program A': { maxPieces: 10, maxGram: 100 },
    'Program B': { maxPieces: 3, maxGram: 200 },
    'Program C': { maxPieces: 4, maxGram: 150 },
    'Program D': { maxPieces: 8, maxGram: 150 },
  };

  // simulate each gate's (pieces, sumGrams) over time
  const gateSimulation = useMemo(() => {
    const sim = [];
    const state = {};
    for (let g = 1; g <= 8; g++) state[g] = { pieces: 0, sumGrams: 0 };

    for (let t = 0; t < totalPoints; t++) {
      const snapshot = {};
      for (let g = 1; g <= 8; g++) {
        const prog = gateMapping[g];
        const { maxPieces, maxGram } = programLimits[prog];
        const prev = state[g].pieces;
        const nextPieces = prev + 1 > maxPieces ? 0 : prev + 1;
        let sum = 0;
        for (let i = 0; i < nextPieces; i++) sum += Math.random() * maxGram;

        state[g] = { pieces: nextPieces, sumGrams: sum };
        snapshot[g] = state[g];
      }
      sim.push(snapshot);
    }
    return sim;
  }, [totalPoints]);

  useEffect(() => {
    const iv = setInterval(() => setIndex(i => (i + 1) % totalPoints), 2000);
    return () => clearInterval(iv);
  }, [totalPoints]);

  const isWrapped = index < windowSize - 1;
  const windowTimestamps = isWrapped
    ? timestamps.slice(0, windowSize)
    : timestamps.slice(index - (windowSize - 1), index + 1);
  const windowData = arr =>
    isWrapped ? arr.slice(0, windowSize) : arr.slice(index - (windowSize - 1), index + 1);

  const colorMap = useMemo(() => ({
    "Program A": colors.tealAccent[500],
    "Program B": colors.redAccent[500],
    "Program C": colors.purpleAccent[500],
    "Program D": colors.orangeAccent[500],
    Total: colors.beigeAccent[400],
  }), [
    colors.tealAccent,
    colors.redAccent,
    colors.purpleAccent,
    colors.orangeAccent,
    colors.beigeAccent,
  ]);

  // Filter data based on visible series
  const throughputData = useMemo(() => {
    const series = Object.entries(throughput)
      .filter(([prog]) => visibleSeries[prog])
      .map(([prog, arr]) => ({
        id: prog,
        color: colorMap[prog],
        data: windowTimestamps.map((t, i) => ({ x: t, y: windowData(arr)[i] })),
      }));
    
    if (visibleSeries["Total"]) {
      series.push({
        id: "Total",
        color: colorMap.Total,
        data: windowTimestamps.map((t, i) => ({ x: t, y: windowData(throughput_sum)[i] })),
      });
    }
    return series;
  }, [throughput, throughput_sum, windowTimestamps, index, colorMap, visibleSeries]);

  const giveawayData = useMemo(() =>
    Object.entries(giveaway)
      .filter(([prog]) => visibleSeries[prog])
      .map(([prog, arr]) => ({
        id: prog,
        color: colorMap[prog],
        data: windowTimestamps.map((t, i) => ({ x: t, y: windowData(arr)[i] })),
      })),
    [giveaway, windowTimestamps, index, colorMap, visibleSeries]
  );

  const rejectsData = useMemo(() => {
    if (!visibleSeries["Total"]) return [];
    
    return [{
      id: "Total",
      color: colorMap.Total,
      data: windowTimestamps.map((t, i) => ({
        x: t,
        y: windowData(rejects)[i],
      })),
    }];
  }, [rejects, windowTimestamps, index, colorMap, visibleSeries]);

  // Filter pie chart data
  const batchPerMinData = useMemo(
    () =>
      pie_batch_per_min[index]
        .filter(d => visibleSeries[d.program])
        .map(d => ({
          id: d.program,
          value: d.value,
          color: colorMap[d.program],
        })),
    [pie_batch_per_min, index, colorMap, visibleSeries]
  );
  
  const batchTotalData = useMemo(
    () =>
      pie_batch_total[index]
        .filter(d => visibleSeries[d.program])
        .map(d => ({
          id: d.program,
          value: d.value,
          color: colorMap[d.program],
        })),
    [pie_batch_total, index, colorMap, visibleSeries]
  );
  
  const giveawayPercentData = useMemo(
    () =>
      pie_giveaway_percent[index]
        .filter(d => visibleSeries[d.program])
        .map(d => ({
          id: d.program,
          value: d.value,
          color: colorMap[d.program],
        })),
    [pie_giveaway_percent, index, colorMap, visibleSeries]
  );
  
  const giveawayGramData = useMemo(
    () =>
      pie_giveaway_gram_batch[index]
        .filter(d => visibleSeries[d.program])
        .map(d => ({
          id: d.program,
          value: d.value,
          color: colorMap[d.program],
        })),
    [pie_giveaway_gram_batch, index, colorMap, visibleSeries]
  );

  const scatterData = useMemo(() => {
    const currentDate = new Date(timestamps[index]);
    const oneHourAgo = new Date(currentDate.getTime() - 3600 * 1000);
  
    const pts = scatter_distribution
      .filter(d => {
        const t = new Date(d.timestamp);
        return t >= oneHourAgo && t <= currentDate;
      })
      .map(d => ({
        x: d.timestamp,
        y: Number(d.weight),
      }));
  
    return [
      {
        id: "Pieces",
        data: pts,
      },
    ];
  }, [scatter_distribution, timestamps, index]);

  const formatTimeLabel = (timestamp) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { 
      hour: '2-digit', 
      minute: '2-digit',
      hour12: false
    });
  };

  const batchPerMinSum = useMemo(() => {
    return batchPerMinData.reduce((sum, item) => sum + item.value, 0);
  }, [batchPerMinData]);

  const batchTotalSum = useMemo(() => {
    return batchTotalData.reduce((sum, item) => sum + item.value, 0);
  }, [batchTotalData]);

  const giveawayGramSum = useMemo(() => {
    const sum = giveawayGramData.reduce((sum, item) => sum + item.value, 0);
    return Number(sum.toFixed(1));
  }, [giveawayGramData]);

  const giveawayPercentAvg = useMemo(() => {
    if (giveawayPercentData.length === 0) return 0;
    const sum = giveawayPercentData.reduce((sum, item) => sum + item.value, 0);
    return Number((sum / giveawayPercentData.length).toFixed(1));
  }, [giveawayPercentData]);

  const sharedLineProps = {
    margin: { top: 10, right: 20, bottom: 50, left: 40 },
    xScale: { type: 'point' },
    yScale: { type: 'linear', min: 'auto', max: 'auto' },
    curve: 'basis',
    enableArea: false,
    useMesh: true,
    axisTop: null,
    axisRight: null,
    pointSize: 0,
    pointColor: { theme: 'background' },
    pointBorderWidth: 2,
    pointBorderColor: { from: 'serieColor' },
    pointLabel: 'yFormatted',
    pointLabelYOffset: -12,
    axisBottom: {
      format: formatTimeLabel,
      tickRotation: 0,
      orient: "bottom",
      tickValues: (() => {
        const firstIndex = 0;
        const lastIndex = windowTimestamps.length - 1;
        const oneThirdIndex = Math.floor(lastIndex / 3);
        const twoThirdsIndex = Math.floor(2 * lastIndex / 3);
        
        return [
          windowTimestamps[firstIndex], 
          windowTimestamps[oneThirdIndex], 
          windowTimestamps[twoThirdsIndex], 
          windowTimestamps[lastIndex]
        ];
      })(),
      tickSize: 5,
      tickPadding: 5,
      axis: { 
        strokeWidth: 1 
      },
      line: { 
        strokeWidth: 1 
      },
    },
    axisLeft: {
      orient: "left",
      tickValues: 3,
      tickSize: 5,
      tickPadding: 5,
      tickRotation: 0,
      axis: { 
        strokeWidth: 1 
      },
      line: { 
        strokeWidth: 1 
      },
      legend: '',
      legendOffset: -35,
      legendPosition: 'middle',
    },
    theme: chartTheme,
    key: `line-chart-${theme.palette.mode}`,
    enableGridX: false,
    enableGridY: false,
  };

  const sharedPieProps = {
    margin: { top: 20, right: 5, bottom: 0, left: 5 },
    innerRadius: 0.65,
    padAngle: 3,
    cornerRadius: 3,
    activeOuterRadiusOffset: 8,
    borderWidth: 1,
    borderColor: { from: 'color', modifiers: [[ 'darker', 0.2 ]] },
    enableArcLinkLabels: false,
    arcLinkLabelsSkipAngle: 10,
    arcLinkLabelsTextColor: "#333333",
    arcLinkLabelsThickness: 2,
    arcLinkLabelsColor: { from: 'color' },
    arcLabelsSkipAngle: 10,
    arcLabelsTextColor: { theme: 'labels.text.fill' },
    valueFormat: ">-.0f",
    colors: ({ id }) => colorMap[id],
    theme: {
      labels: {
        text: {
          fill: tokens('dark').primary[900],
        },
      },
    }
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
        if (!scatterData[0] || !scatterData[0].data || scatterData[0].data.length === 0) {
          return [];
        }
        
        const dataPoints = scatterData[0].data;
        const totalPoints = dataPoints.length;
        
        if (totalPoints < 4) {
          return dataPoints.map(d => d.x);
        }
        
        return [
          dataPoints[0].x, 
          dataPoints[Math.floor(totalPoints * 0.33)].x, 
          dataPoints[Math.floor(totalPoints * 0.66)].x, 
          dataPoints[totalPoints - 1].x
        ];
      })(),
      tickSize: 5,
      tickPadding: 5,
      axis: { 
        strokeWidth: 1 
      },
      line: { 
        strokeWidth: 1 
      },
    },
    axisLeft: { 
      orient: "left",
      tickValues: 3,
      tickSize: 5,
      tickPadding: 5,
      tickRotation: 0,
      axis: { 
        strokeWidth: 1 
      },
      line: { 
        strokeWidth: 1 
      },
      legend: 'weight (g)',
      legendOffset: -35,
      legendPosition: 'middle',
    },
    theme: chartTheme,
    key: `scatter-chart-${theme.palette.mode}`,
    colors: () => colors.tealAccent[500],
    nodeSize: 3,
    useMesh: true,
    enableGridX: false,
    enableGridY: false,
  };

  const throughputProps = {
    ...sharedLineProps,
    axisLeft: {
      ...sharedLineProps.axisLeft,
      legend: 'batch / min',
    }
  };

  const giveawayProps = {
    ...sharedLineProps,
    axisLeft: {
      ...sharedLineProps.axisLeft,
      legend: '%',
    }
  };
  
  const rejectsProps = {
    ...sharedLineProps,
    axisLeft: {
      ...sharedLineProps.axisLeft,
      legend: 'piece / min',
    },
    enableArea: true,
    areaBaselineValue: 0,
    yScale: { 
      type: 'linear', 
      min: 0, 
      max: 'auto' 
    }
  };

  return(
    <Box 
      m="20px" 
      height="calc(100vh - 200px)" 
      maxHeight="calc(100vh - 200px)" 
      sx={{ 
        overflow: "visible",
        display: "flex",
        flexDirection: "column"
      }}
    > 
      <Box display="flex" justifyContent="space-between" alignItems="center" mb="20px" sx={{ m: "0px 0 0 0" }} >
        <Header title="Dashboard" subtitle="Performance Overview" />
        
        <Box 
          display="flex" 
          alignItems="center"
          justifyContent="flex-end"
          gap="20px"
          mr="20px"
        >
          {Object.entries(colorMap).map(([program, color]) => (
            <Box 
              key={program}
              display="flex" 
              alignItems="center" 
              gap="5px"
              onClick={() => toggleSeries(program)}
              sx={{ 
                cursor: 'pointer',
                opacity: visibleSeries[program] ? 1 : 0.4,
                transition: 'all 0.2s',
                '&:hover': {
                  transform: 'scale(1.05)',
                },
                border: visibleSeries[program] ? 'none' : `1px solid ${colors.grey[300]}`,
                borderRadius: '4px',
                padding: '2px 6px',
              }}
            >
              <Box 
                width="12px" 
                height="12px" 
                borderRadius="50%" 
                sx={{ backgroundColor: color }} 
              />
              <Typography variant="h7" color={colors.primary[800]}>
                {program}
              </Typography>
            </Box>
          ))}
        </Box>
      </Box>

      <Box
        display="grid"
        gridTemplateColumns="repeat(12, 1fr)"
        gridTemplateRows="repeat(12, 1fr)"
        gap="20px"
        sx={{
          flex: 1,
          minHeight: 0,
          overflow: "hidden"
        }}
      >
        {/* Machine Image - Top Row */}
        <Box 
          gridColumn="1 / span 10" 
          gridRow="1 / span 4" 
          sx={{ 
            backgroundColor: colors.primary[100], 
            borderRadius: 1.5, 
            overflow: "hidden", 
            position: 'relative' 
          }}
        >
          <AnnotatedMachineImage colorMap={colorMap} gateData={gateSimulation[index]} />
        </Box>

        {/* Scatter Plot - Middle Row */}
        <Box
          gridColumn="1 / span 10"
          gridRow="5 / span 4"
          sx={{
            backgroundColor: colors.primary[100],
            p: "15px",
            borderRadius: 1.5,
            overflow: "hidden",
          }}
        >
          <Typography variant="h5" color={colors.tealAccent[500]} mb="10px">
            Piece Weight Distribution
          </Typography>
          <Box sx={{ height: "calc(100% - 40px)", position: "relative" }}>
            <ResponsiveScatterPlot
              data={scatterData}
              theme={chartTheme}
              key={`scatter-${theme.palette.mode}`}
              {...sharedScatterProps}
            />
          </Box>
        </Box>

        {/* Line Charts - Bottom Row */}
        <Box
          gridColumn="1 / span 10"
          gridRow="9 / span 4"
          display="grid"
          gridTemplateColumns="repeat(3, 1fr)"
          gap="20px"
        >
          <Box sx={{ backgroundColor: colors.primary[100], borderRadius: 1.5, overflow: "hidden"}} p="15px">
            <Typography variant="h5" color={colors.tealAccent[500]}>
              Throughput
            </Typography>
            <ResponsiveLine
              data={throughputData}
              colors={d => d.color}
              theme={chartTheme}
              key={`throughput-${theme.palette.mode}`}
              {...throughputProps}
            />
          </Box>
          <Box sx={{ backgroundColor: colors.primary[100], borderRadius: 1.5, overflow: "hidden"}} p="15px">
            <Typography variant="h5" color={colors.tealAccent[500]}>
              Give-away
            </Typography>
            <ResponsiveLine
              data={giveawayData}
              colors={d => d.color}
              theme={chartTheme}
              key={`giveaway-${theme.palette.mode}`}
              {...giveawayProps}
            />
          </Box>
          <Box sx={{ backgroundColor: colors.primary[100], borderRadius: 1.5, overflow: "hidden"}} p="15px">
            <Typography variant="h5" color={colors.tealAccent[500]}>
              Rejects
            </Typography>
            <ResponsiveLine
              data={rejectsData}
              colors={d => d.color}
              theme={chartTheme}
              key={`rejects-${theme.palette.mode}`}
              {...rejectsProps}
            />
          </Box>
        </Box>
        
        {/* Pie Charts - Right Column */}
        <Box 
          gridColumn="11 / span 2" 
          gridRow="1 / span 12" 
          display="grid"
          gridTemplateRows="repeat(4, 1fr)"
          gap="5px"
        >
          {/* Batch per min */}
          <Box sx={{ 
            backgroundColor: colors.primary[100], 
            borderRadius: 1.5, 
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
          }} p="15px">
            <Typography variant="h5" color={colors.tealAccent[500]}>
              Batch per min
            </Typography>
            <Typography variant="h6" color={colors.primary[800]} sx={{mb:"-10px"}}>
              Sum : {Math.round(batchPerMinSum)}
            </Typography>
            <Box sx={{ 
              height: "calc(100%)", 
              position: "relative",
              overflow: "hidden" 
            }}>
              <ResponsivePie 
                data={batchPerMinData} 
                {...sharedPieProps} 
              />
            </Box>
          </Box>

          {/* Batch total */}
          <Box sx={{ 
            backgroundColor: colors.primary[100], 
            borderRadius: 1.5, 
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
          }} p="15px">
            <Typography variant="h5" color={colors.tealAccent[500]}>
              Batch total
            </Typography>
            <Typography variant="h6" color={colors.primary[800]} sx={{mb:"-10px"}}>
              Sum : {Math.round(batchTotalSum)}
            </Typography>
            <Box sx={{ 
              height: "calc(100%)", 
              position: "relative",
              overflow: "hidden" 
            }}>
              <ResponsivePie 
                data={batchTotalData} 
                {...sharedPieProps} 
              />
            </Box>
          </Box>

          {/* Give-away (g/batch) */}
          <Box sx={{ 
            backgroundColor: colors.primary[100], 
            borderRadius: 1.5, 
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
          }} p="15px">
            <Typography variant="h5" color={colors.tealAccent[500]}>
              Give-away (g/batch)
            </Typography>
            <Typography variant="h6" color={colors.primary[800]} sx={{mb:"-10px"}}>
              Sum : {giveawayGramSum}
            </Typography>
            <Box sx={{ 
              height: "calc(100%)", 
              position: "relative",
              overflow: "hidden" 
            }}>
              <ResponsivePie 
                data={giveawayGramData} 
                {...sharedPieProps} 
              />
            </Box>
          </Box>

          {/* Give-away (%) */}
          <Box sx={{ 
            backgroundColor: colors.primary[100], 
            borderRadius: 1.5, 
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
          }} p="15px">
            <Typography variant="h5" color={colors.tealAccent[500]}>
              Give-away (%)
            </Typography>
            <Typography variant="h6" color={colors.primary[800]} sx={{mb:"-10px"}}>
              Avg : {giveawayPercentAvg}
            </Typography>
            <Box sx={{ 
              height: "calc(100% )", 
              position: "relative",
              overflow: "hidden" 
            }}>
              <ResponsivePie 
                data={giveawayPercentData} 
                {...sharedPieProps} 
              />
            </Box>
          </Box>
        </Box>
      </Box>
    </Box>
  );
};

export default Dashboard;




import React, { useState, useMemo } from "react";
import {
  Box,
  FormControl,
  Typography,
  InputLabel,
  Select,
  MenuItem,
  useTheme,
  Slider,
  TextField,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Button,
} from "@mui/material";
import { ResponsiveLine } from "@nivo/line";
import { tokens } from "../../theme";
import Header from "../../components/Header";
import mockData from "../../data/mockData_json7.json";
import { useAppContext } from "../../context/AppContext";

const Simulation = () => {
  const theme = useTheme();
  const colors = tokens(theme.palette.mode);

  // Add mapping for batch details if necessary
  const batchMapping = {
    "Simulation 1": "Batch 0927268",
    "Simulation 2": "Batch 1761081",
    // Add other mappings as needed
  };

  // Use context state instead of local state
  const { selectedSimulation, setSelectedSimulation, sliderValue, setSliderValue } = useAppContext();

  // Find the selected simulation object
  const simulation = selectedSimulation 
    ? mockData.pareto_simulations.find((sim) => sim.id === selectedSimulation)
    : null;
    
  // Get batch details if a simulation is selected
  const batchDetails = selectedSimulation && mockData.batch_details
    ? mockData.batch_details.find((batch) => batch.id === (batchMapping[selectedSimulation] || selectedSimulation))
    : null;

  // Extract x-values for slider if a simulation is selected
  const xValues = simulation?.data.map((pt) => pt.x) || [];
  const minX = xValues.length > 0 ? Math.min(...xValues) : 0;
  const maxX = xValues.length > 0 ? Math.max(...xValues) : 0;
  const step = xValues.length > 1 ? xValues[1] - xValues[0] : 1;

  // Updated handlers that use context state
  const handleSimulationChange = (event) => {
    setSelectedSimulation(event.target.value);
    setSliderValue(minX);
  };
  
  const handleSliderChange = (event, value) => {
    setSliderValue(value);
  };

  // Compute interpolated current point based on slider
  const currentPoint = useMemo(() => {
    if (!simulation) return { x: 0, y: 0 };
    const dataArr = simulation.data;
    if (sliderValue <= dataArr[0].x) {
      return { x: dataArr[0].x, y: dataArr[0].y };
    }
    for (let i = 0; i < dataArr.length - 1; i++) {
      const p0 = dataArr[i];
      const p1 = dataArr[i + 1];
      if (sliderValue >= p0.x && sliderValue <= p1.x) {
        const t = (sliderValue - p0.x) / (p1.x - p0.x);
        return { x: sliderValue, y: p0.y + t * (p1.y - p0.y) };
      }
    }
    const last = dataArr[dataArr.length - 1];
    return { x: last.x, y: last.y };
  }, [sliderValue, simulation]);

  // Prepare Nivo data
  const chartData = simulation ? [
    {
      id: simulation.id,
      data: simulation.data.map((point) => ({ x: point.x, y: point.y })),
    },
  ] : [];

  // Custom layer for highlight dot
  const HighlightPoint = ({ xScale, yScale }) => (
    <g>
      <circle
        cx={xScale(currentPoint.x)}
        cy={yScale(currentPoint.y)}
        r={6}
        fill={colors.redAccent[500]}
        stroke={colors.primary[800]}
        strokeWidth={0.5}
      />
    </g>
  );

  // Custom layer for filling the area above the curve
  const OutsideAreaLayer = ({ xScale, yScale, points }) => {
    if (!points || points.length === 0) return null;
    
    // Get chart boundaries
    const chartHeight = yScale(0); // Get the y coordinate for 0
    const chartMaxY = yScale.domain()[1]; // Get the maximum y value
    
    // Create a path that goes around the outside of the chart
    let pathData = "";
    
    // Start at the first point
    pathData += `M ${xScale(points[0].data.x)} ${yScale(points[0].data.y)} `;
    
    // Draw the line connecting all data points
    points.forEach(point => {
      pathData += `L ${xScale(point.data.x)} ${yScale(point.data.y)} `;
    });
    
    // Complete the path by going around the top and back to start
    const lastPoint = points[points.length - 1];
    pathData += `L ${xScale(lastPoint.data.x)} ${yScale(chartMaxY)} `;
    pathData += `L ${xScale(0)} ${yScale(chartMaxY)} `;
    pathData += `L ${xScale(0)} ${yScale(points[0].data.y)} `;
    pathData += "Z";
    
    return (
      <path
        d={pathData}
        fill={colors.tealAccent[500]}
        fillOpacity={0.0}
        stroke="none"
      />
    );
  };

  // Chart theme
  const chartTheme = {
    axis: {
      domain: {
        line: { stroke: colors.primary[800], strokeWidth: 1 },
      },
      legend: { text: { fill: colors.primary[800] } },
      ticks: {
        line: { stroke: colors.primary[800], strokeWidth: 1 },
        text: { fill: colors.primary[800], fontSize: 11 },
      },
    },
    grid: { line: { stroke: colors.primary[800], strokeWidth: 1 } },
    legends: { text: { fill: colors.primary[800] } },
    tooltip: {
      container: { background: colors.primary[100], color: colors.grey[900] },
    },
  };

  // Shared line chart props
  const sharedLineProps = {
    margin: { top: 10, right: 20, bottom: 50, left: 40 },
    xScale: { type: "linear", min: 0, max: "auto" },
    yScale: { type: "linear", min: 0, max: "auto" },
    curve: "basis",
    enableArea: false,
    useMesh: true,
    axisTop: null,
    axisRight: null,
    pointSize: 0,
    pointColor: { theme: "background" },
    pointBorderWidth: 2,
    pointBorderColor: { from: "serieColor" },
    pointLabel: "yFormatted",
    pointLabelYOffset: -12,
    axisBottom: {
      tickRotation: 0,
      orient: "bottom",
      tickSize: 5,
      tickPadding: 5,
      axis: { strokeWidth: 1 },
      line: { strokeWidth: 1 },
      legend: "Rejects / min",
      legendPosition: "middle",
      legendOffset: 35,
    },
    axisLeft: {
      orient: "left",
      tickValues: 3,
      tickSize: 5,
      tickPadding: 5,
      axis: { strokeWidth: 1 },
      line: { strokeWidth: 1 },
      legend: "Give-away (%)",
      legendPosition: "middle",
      legendOffset: -35,
    },
    theme: chartTheme,
    key: `line-chart-${theme.palette.mode}`,
    enableGridX: false,
    enableGridY: false,
    colors: colors.tealAccent[500],
    layers: [
      "grid",
      "axes",
      OutsideAreaLayer,
      "areas",
      "crosshair",
      "lines",
      "points",
      "slices",
      "mesh",
      HighlightPoint,
      "legends",
    ],
  };

  return (
    <Box m="20px">
      <Header title="Simulation" subtitle="Real-time digital twin" />

      <Box mt="70px" display="flex" flexDirection="column" gap={4}>
        <Box display="flex" gap={4}>
          {/* Left column: Batch Selection and Simulated Result */}
          <Box flex={1} maxWidth="500px" display="flex" flexDirection="column" gap={4}>
            {/* Batch Selection */}
            <Box>
              <Typography
                variant="h4"
                fontWeight="bold"
                sx={{ mb: 2, color: colors.tealAccent[500] }}
              >
                Batch Selection
              </Typography>
              
              <FormControl fullWidth>
                <InputLabel id="simulation-select-label" color="secondary">
                  Select Batch
                </InputLabel>
                <Select
                  labelId="simulation-select-label"
                  value={selectedSimulation}
                  label="Select Batch"
                  onChange={handleSimulationChange}
                  color="secondary"
                >
                  {mockData.pareto_simulations.map((sim) => (
                    <MenuItem key={sim.id} value={sim.id}>
                      {sim.id}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Box>

            {/* Simulated Result */}
            {selectedSimulation && (
              <Box>
                <Typography
                  variant="h4"
                  fontWeight="bold"
                  sx={{ mb: 2, color: colors.tealAccent[500] }}
                >
                  Simulated Result
                </Typography>
                
                <Box 
                  sx={{
                    border: `1px solid ${colors.primary[800]}`,
                    borderRadius: '16px',
                    padding: 3,
                    width: "100%",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    alignSelf: "stretch",
                    justifyContent: "space-between",
                  }}
                >
                  {/* Chart */}
                  <Box height="400px" width="400px">
                    <ResponsiveLine data={chartData} {...sharedLineProps} />
                  </Box>

                  {/* Slider & coordinate display with custom colors */}
                  <Box width={500}>
                    <Box my={2} mx={9} width="100%">
                      <Slider
                        min={minX}
                        max={maxX}
                        step={step}
                        value={sliderValue}
                        onChange={handleSliderChange}
                        aria-labelledby="x-slider"
                        sx={{
                          color: colors.tealAccent[500],
                          width: "75%",
                          '& .MuiSlider-thumb': {
                            height: 16,
                            width: 16,
                            '&:hover, &.Mui-focusVisible': {
                              boxShadow: `0px 0px 0px 4px ${colors.tealAccent[200]}`,
                            },
                            '&.Mui-active': {
                              boxShadow: `0px 0px 0px 6px ${colors.redAccent[500]}`,
                            },
                          },
                          '& .MuiSlider-rail': {
                            opacity: 0.5,
                            backgroundColor: colors.primary[500],
                            height: 2,
                          },
                          '& .MuiSlider-track': {
                            height: 2,
                          },
                        }}
                      />
                    </Box>
                    <Box display="flex" gap={2} mt={2} mx={9} width="100%">
                      <TextField
                        label="Rejects / min"
                        value={currentPoint.x.toFixed(1)}
                        variant="outlined"
                        size="small"
                        InputProps={{ 
                          readOnly: true,
                          disableUnderline: true
                        }}
                        color="secondary"
                        sx={{
                          '& .MuiOutlinedInput-root': {
                            backgroundColor: colors.primary[200],
                            '& fieldset': {
                              borderColor: 'transparent'
                            },
                            '&:hover fieldset': {
                              borderColor: colors.primary[500],
                            },
                            '&.Mui-focused fieldset': {
                              borderColor: colors.primary[500],
                            },
                          },
                          '& .MuiFormLabel-root': {
                            color: colors.tealAccent[500],
                            margin: '-5px 0 0 -11px'
                          },
                          '& .MuiInputBase-input': {
                            cursor: 'default',
                            userSelect: 'none',
                          }
                        }}
                      />
                      <TextField
                        label="Give-away (%)"
                        value={currentPoint.y.toFixed(2)}
                        variant="outlined"
                        size="small"
                        InputProps={{ 
                          readOnly: true,
                          disableUnderline: true
                        }}
                        color="secondary"
                        sx={{
                          '& .MuiOutlinedInput-root': {
                            backgroundColor: colors.primary[200],
                            '& fieldset': {
                              borderColor: 'transparent',
                            },
                            '&:hover fieldset': {
                              borderColor: colors.primary[500],
                            },
                            '&.Mui-focused fieldset': {
                              borderColor: colors.primary[500],
                            },
                          },
                          '& .MuiFormLabel-root': {
                            color: colors.tealAccent[500],
                            margin: '-5px 0 0 -11px'
                          },
                          '& .MuiInputBase-input': {
                            cursor: 'default',
                            userSelect: 'none',
                          }
                        }}
                      />
                    </Box>
                  </Box>
                </Box>
              </Box>
            )}
          </Box>

          {/* Right: Batch Information */}
          {selectedSimulation && batchDetails && (
            <Box
              flex={1}
              sx={{
                overflowY: "auto",
                maxHeight: "calc(100vh - 200px)",
                pr: 2,
              }}
            >
              <Typography
                variant="h4"
                fontWeight="bold"
                sx={{ mb: 2, color: colors.tealAccent[500] }}
              >
                Batch Information
              </Typography>
              
              {/* Program Settings - Following Settings page style */}
              <Typography variant="h5" fontWeight="bold" sx={{ mb: 2 }}>
                Program Settings
              </Typography>
              
              {batchDetails.programs.map((program, i) => (
                <Box
                  key={i}
                  mb={2}
                  p={2}
                  sx={{ backgroundColor: colors.primary[200], borderRadius: 1 }}
                >
                  <Box display="flex" justifyContent="space-between" alignItems="center">
                    <Typography color="secondary" variant="h5" fontWeight="bold">
                      {program.name} - Gates : {program.gates.join(" , ")}
                    </Typography>
                  </Box>

                  {/* Three-column grid for details */}
                  <Box display="grid" gridTemplateColumns="repeat(6, 1fr)" gap={1} mt={1}>
                    {/* <Typography variant="body2">
                      <strong>Gates:</strong> {program.gates.join(", ")}
                    </Typography> */}
                    <Typography variant="body2">
                      <strong>Piece limit (min):</strong> {program.settings.min_piece_weight} g
                    </Typography>
                    <Typography variant="body2">
                      <strong>Piece limit (max):</strong> {program.settings.max_piece_weight} g
                    </Typography>
                    <Typography variant="body2">
                      <strong>Batch limit (min weight):</strong> {program.settings.min_batch_weight} g
                    </Typography>
                    <Typography variant="body2">
                      <strong>Batch limit (max weight):</strong> {program.settings.max_batch_weight} g
                    </Typography>
                    <Typography variant="body2">
                      <strong>Batch limit (min pieces):</strong> {program.settings.min_batch_pieces}
                    </Typography>
                    <Typography variant="body2">
                      <strong>Batch limit (max pieces):</strong> {program.settings.max_batch_pieces}
                    </Typography>
                  </Box>
                </Box>
              ))}
              
              {/* Batch Results - Separate sections for Program and Gate */}
              <Typography variant="h5" fontWeight="bold" sx={{ mt: 4, mb: 2 }}>
                Batch Results - Programs
              </Typography>
              
              <Box
                mb={2}
                p={2}
                sx={{ backgroundColor: colors.primary[200], borderRadius: 1 }}
              >
                {batchDetails.results
                  .filter(result => result.type === 'program')
                  .map((result, index) => (
                    <Box 
                      key={`program-${index}`} 
                      mb={index < batchDetails.results.filter(r => r.type === 'program').length - 1 ? 2 : 0}
                    >
                      <Box display="flex" justifyContent="space-between" alignItems="center">
                        <Typography color="secondary" variant="h6" fontWeight="bold">
                          {result.name}
                        </Typography>
                      </Box>

                      {/* Three-column grid for details */}
                      <Box display="grid" gridTemplateColumns="repeat(3, 1fr)" gap={2} mt={1}>
                        <Typography variant="body2">
                          <strong>Total Products:</strong> {result.total_products}
                        </Typography>
                        <Typography variant="body2">
                          <strong>Average Weight:</strong> {result.avg_weight.toFixed(2)} g
                        </Typography>
                        <Typography variant="body2">
                          <strong>Give-away (%):</strong> {result.giveaway_percent.toFixed(2)}%
                        </Typography>
                      </Box>
                      {index < batchDetails.results.filter(r => r.type === 'program').length - 1 && (
                        <Box mt={2} sx={{ borderBottom: `1px solid ${colors.primary[300]}` }}></Box>
                      )}
                    </Box>
                  ))}
              </Box>
              
              <Typography variant="h5" fontWeight="bold" sx={{ mt: 4, mb: 2 }}>
                Batch Results - Gates
              </Typography>

              {batchDetails.programs.map((program) => (
                <React.Fragment key={`gate-group-${program.name}`}>
                  {batchDetails.results
                    .filter(result => result.type === 'gate' && result.program === program.name)
                    .length > 0 && (
                      <Box
                        mb={2}
                        p={2}
                        sx={{ backgroundColor: colors.primary[200], borderRadius: 1 }}
                      >
                        <Typography color="secondary" variant="h6" fontWeight="bold" mb={1}>
                          {program.name} - Gates
                        </Typography>
                        
                        {batchDetails.results
                          .filter(result => result.type === 'gate' && result.program === program.name)
                          .map((result, gateIndex, filteredArray) => (
                            <Box 
                              key={`gate-${program.name}-${gateIndex}`} 
                              ml={2}
                              mb={gateIndex < filteredArray.length - 1 ? 2 : 0}
                            >
                              <Box display="grid" gridTemplateColumns="repeat(4, 1fr)" gap={2} mt={1}>
                                <Typography variant="body2">
                                  <strong>Gate {result.gate}</strong>
                                </Typography>
                                <Typography variant="body2">
                                  <strong>Products:</strong> {result.total_products}
                                </Typography>
                                <Typography variant="body2">
                                  <strong>Avg Weight:</strong> {result.avg_weight.toFixed(2)} g
                                </Typography>
                                <Typography variant="body2">
                                  <strong>Give-away:</strong> {result.giveaway_percent.toFixed(2)}%
                                </Typography>
                              </Box>
                              {gateIndex < filteredArray.length - 1 && (
                                <Box mt={2} sx={{ borderBottom: `1px dashed ${colors.primary[300]}` }}></Box>
                              )}
                            </Box>
                          ))}
                      </Box>
                    )}
                </React.Fragment>
              ))}
            </Box>
          )}
        </Box>
      </Box>
    </Box>
  );
};

export default Simulation;





