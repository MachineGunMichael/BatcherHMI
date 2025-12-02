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
import { ResponsiveBar } from "@nivo/bar";
import { tokens } from "../../theme";
import Header from "../../components/Header";
// import mockData from "../../data/mockData_json7.json"; // TEMPORARILY DISABLED
import { useAppContext } from "../../context/AppContext";

const Simulation = () => {
  const theme = useTheme();
  const colors = tokens(theme.palette.mode);
  const isDarkMode = theme.palette.mode === 'dark';

  // Define chartTheme to match Dashboard implementation
  const chartTheme = {
    axis: {
      domain: {
        line: {
          stroke: 'transparent',
          strokeWidth: 0,
        },
      },
      legend: {
        text: {
          fill: isDarkMode ? colors.primary[800] : colors.primary[800],
        },
      },
      ticks: {
        line: {
          stroke: isDarkMode ? colors.primary[800] : colors.primary[800],
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
        stroke: 'transparent',
        strokeWidth: 0,
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

  // Add mapping for batch details if necessary
  const batchMapping = {
    "Simulation 1": "Batch 0927268",
    "Simulation 2": "Batch 1761081",
    // Add other mappings as needed
  };

  // Add safer context access with console logging to debug
  const context = useAppContext();
  console.log("Simulation context:", context);
  
  // Use safe fallbacks if context isn't available
  const selectedSimulation = context?.selectedSimulation || "";
  const setSelectedSimulation = context?.setSelectedSimulation || (() => {
    console.log("Warning: setSelectedSimulation is not available");
  });
  const sliderValue = context?.sliderValue || 0;
  const setSliderValue = context?.setSliderValue || (() => {
    console.log("Warning: setSliderValue is not available");
  });

  // Find the selected simulation object
  // TEMPORARILY DISABLED - mockData
  const simulation = null;
  // const simulation = selectedSimulation 
  //   ? mockData.pareto_simulations.find((sim) => sim.id === selectedSimulation)
  //   : null;
    
  // Get batch details if a simulation is selected
  // TEMPORARILY DISABLED - mockData
  const batchDetails = null;
  // const batchDetails = selectedSimulation && mockData.batch_details
  //   ? mockData.batch_details.find((batch) => batch.id === (batchMapping[selectedSimulation] || selectedSimulation))
  //   : null;

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

  // First, set up the state and functions for the selectable programs
  const [visibleSeries, setVisibleSeries] = useState({
    "Program A": true,
    "Program B": true,
    "Program C": true,
    "Program D": true,
  });

  const toggleSeries = (program) => {
    setVisibleSeries(prev => ({
      ...prev,
      [program]: !prev[program]
    }));
  };

  const colorMap = useMemo(() => ({
    "Program A": colors.tealAccent[500],
    "Program B": colors.redAccent[500],
    "Program C": colors.purpleAccent[500],
    "Program D": colors.orangeAccent[500],
  }), [colors]);

  // Filter chart data based on visible series
  const programTotalProductsData = useMemo(() => {
    if (!batchDetails) return [];
    
    return batchDetails.results
      .filter(result => result.type === 'program' && visibleSeries[result.name])
      .map(result => ({
        program: result.name,
        value: result.total_products,
        programColor: colorMap[result.name],
      }));
  }, [batchDetails, visibleSeries, colorMap]);

  const programAvgWeightData = useMemo(() => {
    if (!batchDetails) return [];
    
    return batchDetails.results
      .filter(result => result.type === 'program' && visibleSeries[result.name])
      .map(result => ({
        program: result.name,
        value: Math.round(result.avg_weight), // No decimals
        programColor: colorMap[result.name],
      }));
  }, [batchDetails, visibleSeries, colorMap]);

  const programGiveawayData = useMemo(() => {
    if (!batchDetails) return [];
    
    return batchDetails.results
      .filter(result => result.type === 'program' && visibleSeries[result.name])
      .map(result => ({
        program: result.name,
        value: parseFloat(result.giveaway_percent.toFixed(2)),
        programColor: colorMap[result.name],
      }));
  }, [batchDetails, visibleSeries, colorMap]);

  // Update the bar chart props to include the theme and key
  const sharedBarProps = {
    padding: 0.3,
    margin: { top: 20, right: 20, bottom: 20, left: 60 }, 
    valueScale: { type: 'linear' },
    indexScale: { type: 'band', round: true },
    borderColor: { from: 'color', modifiers: [['darker', 1.6]] },
    axisTop: null,
    axisRight: null,
    axisBottom: {
      tickSize: 0,
      tickPadding: 0,
      tickRotation: 0,
      tickValues: [],
      legend: '',
      legendPosition: 'middle',
      legendOffset: 0,
      axis: { strokeWidth: 0 },
      line: { strokeWidth: 0 },
    },
    axisLeft: {
      tickSize: 5,
      tickPadding: 5,
      tickRotation: 0,
      legend: '',
      legendPosition: 'middle',
      legendOffset: -40,
      axis: { strokeWidth: 0 },
      line: { strokeWidth: 0 },
    },
    labelSkipWidth: 12,
    labelSkipHeight: 12,
    labelTextColor: '#FFFFFF',
    enableGridY: false,
    enableGridX: false,
    theme: chartTheme,
    key: `bar-chart-${theme.palette.mode}`,
  };

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
      axis: { strokeWidth: 0 },
      line: { strokeWidth: 0 },
      legend: "Rejects / min",
      legendPosition: "middle",
      legendOffset: 35,
    },
    axisLeft: {
      orient: "left",
      tickValues: 3,
      tickSize: 5,
      tickPadding: 5,
      axis: { strokeWidth: 0 },
      line: { strokeWidth: 0 },
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

      <Box 
        mt="70px" // Reduced from 70px to 40px
        display="flex" 
        flexDirection="column" 
        gap={4}
        sx={{
          width: "100%",
          overflow: "hidden",
        }}
      >
        <Box 
          display="flex" 
          gap={4}
          sx={{
            width: "100%",
            overflow: "hidden",
            transition: "all 0.3s ease"
          }}
        >
          {/* Left column: Batch Selection and Simulated Result */}
          <Box 
            flex="0 0 auto"
            maxWidth="500px" 
            display="flex" 
            flexDirection="column" 
            gap={4}
          >
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
                  {/* TEMPORARILY DISABLED - mockData */}
                  {/* {mockData.pareto_simulations.map((sim) => (
                    <MenuItem key={sim.id} value={sim.id}>
                      {sim.id}
                    </MenuItem>
                  ))} */}
                  <MenuItem value="">No simulations available</MenuItem>
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
              flex="1 1 auto"
              sx={{
                overflowY: "auto",
                maxHeight: "calc(100vh - 200px)",
                pr: 4,
                width: "100%",
                minWidth: 0,
                transition: "all 0.3s ease",
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
              {/* <Typography variant="h5" fontWeight="bold" sx={{ mb: 2 }}>
                Program Settings
              </Typography> */}
              
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
                  <Box sx={{ mt: 1 }}>
                    {/* Labels row with reduced bottom margin */}
                    <Box display="grid" gridTemplateColumns="repeat(6, 1fr)" gap={2} sx={{ mb: 0.1 }}>
                      <Typography variant="body2">
                        <strong>Piece limit</strong> 
                      </Typography>
                      <Typography variant="body2">
                        <strong>Piece limit</strong> 
                      </Typography>
                      <Typography variant="body2">
                        <strong>Batch limit</strong> 
                      </Typography>
                      <Typography variant="body2">
                        <strong>Batch limit</strong> 
                      </Typography>
                      <Typography variant="body2">
                        <strong>Batch limit</strong> 
                      </Typography>
                      <Typography variant="body2">
                        <strong>Batch limit</strong> 
                      </Typography>
                    </Box>

                    {/* Attributes row with reduced top margin but normal bottom margin */}
                    <Box display="grid" gridTemplateColumns="repeat(6, 1fr)" gap={2} sx={{ mt: 0, mb: 1 }}>
                      <Typography variant="body2">
                        <strong>(min)</strong> 
                      </Typography>
                      <Typography variant="body2">
                        <strong>(max)</strong> 
                      </Typography>
                      <Typography variant="body2">
                        <strong>(min weight)</strong> 
                      </Typography>
                      <Typography variant="body2">
                        <strong>(max weight)</strong> 
                      </Typography>
                      <Typography variant="body2">
                        <strong>(min pieces)</strong> 
                      </Typography>
                      <Typography variant="body2">
                        <strong>(max pieces)</strong> 
                      </Typography>
                    </Box>
                    
                    {/* Values row with normal margins */}
                    <Box display="grid" gridTemplateColumns="repeat(6, 1fr)" gap={2}>
                      <Typography variant="body2">
                        {program.settings.min_piece_weight} g
                      </Typography>
                      <Typography variant="body2">
                        {program.settings.max_piece_weight} g
                      </Typography>
                      <Typography variant="body2">
                        {program.settings.min_batch_weight} g
                      </Typography>
                      <Typography variant="body2">
                        {program.settings.max_batch_weight} g
                      </Typography>
                      <Typography variant="body2">
                        {program.settings.min_batch_pieces}
                      </Typography>
                      <Typography variant="body2">
                        {program.settings.max_batch_pieces}
                      </Typography>
                    </Box>
                  </Box>
                </Box>
              ))}

              {/* Batch Results Programs */}
              <Box mt={4}>
                <Box display="flex" alignItems="center" justifyContent="space-between" mb="20px">
                  <Typography
                    variant="h4"
                    fontWeight="bold"
                    sx={{ color: colors.tealAccent[500] }}
                  >
                    Batch Results Programs
                  </Typography>
                  
                  {/* Program selectors - aligned to the right */}
                  <Box 
                    display="flex" 
                    alignItems="center"
                    gap="15px"
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
                        <Typography variant="body2" color={colors.primary[800]}>
                          {program}
                        </Typography>
                      </Box>
                    ))}
                  </Box>
                </Box>

                {/* The grid of three charts */}
                <Box
                  display="grid"
                  gridTemplateColumns="repeat(3, 1fr)"
                  gap={3}
                  sx={{
                    width: "100%",
                    minWidth: 0,
                  }}
                >
                  {/* Chart 1 - Total Products */}
                  <Box sx={{ width: "100%", minWidth: 0 }}>
                    <Typography variant="h5" color={colors.tealAccent[500]} mb={1}>
                      Total Products
                    </Typography>
                    <Box height="300px" width="100%">
                      <ResponsiveBar
                        data={programTotalProductsData}
                        keys={['value']}
                        indexBy="program"
                        colors={({ data }) => data.programColor}
                        theme={chartTheme}
                        key={`total-products-${theme.palette.mode}`}
                        {...sharedBarProps}
                      />
                    </Box>
                  </Box>

                  {/* Chart 2 - Average Weight */}
                  <Box sx={{ width: "100%", minWidth: 0 }}>
                    <Typography variant="h5" color={colors.tealAccent[500]} mb={1}>
                      Average Weight (g)
                    </Typography>
                    <Box height="300px" width="100%">
                      <ResponsiveBar
                        data={programAvgWeightData}
                        keys={['value']}
                        indexBy="program"
                        colors={({ data }) => data.programColor}
                        valueFormat=" >-~" // No decimals
                        theme={chartTheme}
                        key={`avg-weight-${theme.palette.mode}`}
                        {...sharedBarProps}
                      />
                    </Box>
                  </Box>

                  {/* Chart 3 - Give-away */}
                  <Box sx={{ width: "100%", minWidth: 0 }}>
                    <Typography variant="h5" color={colors.tealAccent[500]} mb={1}>
                      Give-away (%)
                    </Typography>
                    <Box height="300px" width="100%">
                      <ResponsiveBar
                        data={programGiveawayData}
                        keys={['value']}
                        indexBy="program"
                        colors={({ data }) => data.programColor}
                        theme={chartTheme}
                        key={`giveaway-${theme.palette.mode}`}
                        {...sharedBarProps}
                      />
                    </Box>
                  </Box>
                </Box>
              </Box>
              
              {/* Batch Results - Programs */}
              {/* <Typography
                variant="h4"
                fontWeight="bold"
                sx={{ mt: 3, mb: 2, color: colors.tealAccent[500] }}
              >
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
                      mb={index < batchDetails.results.filter(r => r.type === 'program').length - 1 ? 1 : 0}
                    >
                      <Box display="flex" justifyContent="space-between" alignItems="center" sx={{ mb: 0.5 }}>
                        <Typography color="secondary" variant="h6" fontWeight="bold">
                          {result.name}
                        </Typography>
                      </Box>

                      <Box display="grid" gridTemplateColumns="repeat(3, 1fr)" gap={1} mt={0.5}>
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
                        <Box mt={1} sx={{ borderBottom: `1px solid ${colors.primary[300]}` }}></Box>
                      )}
                    </Box>
                  ))}
              </Box> */}
              
              {/* Batch Results - Gates */}
              <Typography
                variant="h4"
                fontWeight="bold"
                sx={{ mt: 3, mb: 2, color: colors.tealAccent[500] }}
              >
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
                              mb={gateIndex < filteredArray.length - 1 ? 1 : 0}
                            >
                              <Box display="grid" gridTemplateColumns="repeat(4, 1fr)" gap={1} mt={0.5}>
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
                                <Box mt={1} sx={{ borderBottom: `1px dashed ${colors.primary[300]}` }}></Box>
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