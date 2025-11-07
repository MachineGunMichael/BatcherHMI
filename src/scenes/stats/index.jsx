import React, { useState, useEffect, useMemo } from "react";
import {
  Box,
  FormControl,
  Typography,
  InputLabel,
  Select,
  MenuItem,
  useTheme,
  Paper,
} from "@mui/material";
import { ResponsiveBar } from "@nivo/bar";
import { ResponsivePie } from "@nivo/pie";
import { tokens } from "../../theme";
import Header from "../../components/Header";

const API_BASE = process.env.REACT_APP_API_BASE || "http://localhost:5001";

const Stats = () => {
  const theme = useTheme();
  const colors = tokens(theme.palette.mode);
  const isDarkMode = theme.palette.mode === 'dark';

  const [programs, setPrograms] = useState([]);
  const [selectedProgramId, setSelectedProgramId] = useState(() => {
    // Initialize from localStorage if available
    return localStorage.getItem('stats_selected_program_id') || "";
  });
  const [programStats, setProgramStats] = useState(null);
  const [recipeStats, setRecipeStats] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [pieceDistribution, setPieceDistribution] = useState(null);
  const [loading, setLoading] = useState(true);
  const [visibleRecipes, setVisibleRecipes] = useState({});

  // Table styling constants
  const TABLE_HEADER1_HEIGHT = '20px';   // First header row (grouped)
  const TABLE_HEADER1_PADDING = 0;
  const TABLE_HEADER2_HEIGHT = '20px';   // Second header row (detail)
  const TABLE_HEADER2_PADDING = 0;
  const TABLE_ROW_HEIGHT = '20px';
  const TABLE_ROW_PADDING = 0.5;

  // Color palette for recipes
  const recipeColors = [
    colors.tealAccent[500],
    colors.orangeAccent[500],
    colors.purpleAccent[500],
    colors.redAccent[500],
    colors.tealAccent[300],
    colors.orangeAccent[300],
    colors.purpleAccent[300],
    colors.redAccent[300],
  ];

  // Pie chart colors for weight distribution
  const weightColors = [
    colors.tealAccent[500],  // Batched weight
    colors.purpleAccent[500], // Reject weight
    colors.orangeAccent[500], // Giveaway weight
  ];

  // Chart theme
  const chartTheme = {
    axis: {
      domain: { line: { stroke: 'transparent', strokeWidth: 0 } },
      legend: { text: { fill: isDarkMode ? colors.primary[800] : colors.primary[800] } },
      ticks: {
        line: { stroke: isDarkMode ? colors.primary[800] : colors.primary[800], strokeWidth: 1 },
        text: { fill: isDarkMode ? colors.primary[800] : colors.primary[800], fontSize: 11 },
      },
    },
    grid: { line: { stroke: 'transparent', strokeWidth: 0 } },
    legends: { text: { fill: isDarkMode ? colors.primary[800] : colors.primary[800] } },
    tooltip: {
      container: {
        background: isDarkMode ? colors.primary[400] : colors.primary[100],
        color: isDarkMode ? colors.grey[100] : colors.grey[900],
      },
    },
  };

  // Load programs on mount
  useEffect(() => {
    fetchPrograms();
  }, []);

  // Load program details when selection changes
  useEffect(() => {
    if (selectedProgramId) {
      fetchProgramDetails(selectedProgramId);
    }
  }, [selectedProgramId]);

  const getAuthHeaders = () => {
    const token = localStorage.getItem('token');
    return {
      'Content-Type': 'application/json',
      'Authorization': token ? `Bearer ${token}` : ''
    };
  };

  const fetchPrograms = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/stats/programs`, {
        headers: getAuthHeaders()
      });
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      console.log("Fetched programs:", data);
      // Ensure data is an array
      setPrograms(Array.isArray(data) ? data : []);
      setLoading(false);
    } catch (error) {
      console.error("Error fetching programs:", error);
      setPrograms([]); // Set empty array on error
      setLoading(false);
    }
  };

  const fetchProgramDetails = async (programId) => {
    try {
      // Fetch program stats
      const statsResponse = await fetch(`${API_BASE}/api/stats/programs/${programId}`, {
        headers: getAuthHeaders()
      });
      const stats = await statsResponse.json();
      setProgramStats(stats);

      // Fetch recipe stats for this program
      const recipeResponse = await fetch(`${API_BASE}/api/stats/programs/${programId}/recipes`, {
        headers: getAuthHeaders()
      });
      const recipes = await recipeResponse.json();
      setRecipeStats(recipes);

      // Fetch assignments for this program
      const assignResponse = await fetch(`${API_BASE}/api/stats/programs/${programId}/assignments`, {
        headers: getAuthHeaders()
      });
      const assignData = await assignResponse.json();
      console.log("Fetched assignments:", assignData);
      setAssignments(assignData.assignments || []);

      // Fetch piece weight distribution for this program
      try {
        const piecesResponse = await fetch(`${API_BASE}/api/stats/programs/${programId}/pieces`, {
          headers: getAuthHeaders()
        });
        if (piecesResponse.ok) {
          const piecesData = await piecesResponse.json();
          console.log("Fetched pieces distribution:", piecesData);
          console.log("Number of bins:", piecesData.bins?.length);
          console.log("Total pieces:", piecesData.totalPieces);
          setPieceDistribution(piecesData);
        } else {
          console.error("Failed to fetch pieces:", piecesResponse.status, piecesResponse.statusText);
          setPieceDistribution(null);
        }
      } catch (piecesError) {
        console.error("Error fetching pieces distribution:", piecesError);
        setPieceDistribution(null);
      }
    } catch (error) {
      console.error("Error fetching program details:", error);
    }
  };

  // Create recipe-to-color mapping
  const recipeColorMap = useMemo(() => {
    const uniqueRecipes = [...new Set(assignments.map(a => a.recipe_name))].filter(Boolean);
    const colorMap = {};
    uniqueRecipes.forEach((recipe, index) => {
      colorMap[recipe] = recipeColors[index % recipeColors.length];
    });
    return colorMap;
  }, [assignments]);

  // Initialize visible recipes when recipeStats changes
  useEffect(() => {
    if (recipeStats.length > 0) {
      const initialVisibility = {};
      recipeStats.forEach(recipe => {
        // Only initialize if not already set
        if (visibleRecipes[recipe.recipe_name] === undefined) {
          initialVisibility[recipe.recipe_name] = true;
        }
      });
      if (Object.keys(initialVisibility).length > 0) {
        setVisibleRecipes(prev => ({ ...prev, ...initialVisibility }));
      }
    }
  }, [recipeStats]);

  // Create gate assignment grid data
  const gateGridData = useMemo(() => {
    if (!assignments.length) return { gates: [1, 2, 3, 4, 5, 6, 7, 8], recipes: [], grid: {} };

    // Always show gates 1-8
    const gates = [1, 2, 3, 4, 5, 6, 7, 8];
    const recipes = Array.from(new Set(assignments.map(a => a.recipe_name))).filter(Boolean);

    const grid = {};
    assignments.forEach(a => {
      if (!grid[a.recipe_name]) grid[a.recipe_name] = {};
      grid[a.recipe_name][a.gate] = true;
    });

    return { gates, recipes, grid };
  }, [assignments]);

  // Get recipe specifications (from first matching assignment)
  const getRecipeSpec = (recipeName) => {
    const assignment = assignments.find(a => a.recipe_name === recipeName);
    return assignment || {};
  };

  // Prepare pie chart data for weight distribution
  const weightDistributionData = useMemo(() => {
    if (!programStats) return [];

    return [
      {
        id: "Batched",
        label: "Batched Weight",
        value: programStats.total_batched_weight_g,
        color: weightColors[0]
      },
      {
        id: "Rejected",
        label: "Reject Weight",
        value: programStats.total_reject_weight_g,
        color: weightColors[1]
      },
      {
        id: "Giveaway",
        label: "Giveaway",
        value: programStats.total_giveaway_weight_g,
        color: weightColors[2]
      }
    ].filter(item => item.value > 0);
  }, [programStats]);

  const handleProgramChange = (event) => {
    const programId = event.target.value;
    setSelectedProgramId(programId);
    // Save to localStorage to persist across navigation
    localStorage.setItem('stats_selected_program_id', programId);
  };

  if (loading) {
    return <Box m="20px"><Typography>Loading...</Typography></Box>;
  }

  return (
    <Box m="20px">
      <Header title="Stats" subtitle="Historic Program & Recipe Analysis" />

      <Box 
        mt="40px" 
        display="flex" 
        flexDirection="column" 
        gap={8}
        sx={{
          overflowY: "auto",
          maxHeight: "calc(100vh - 200px)",
          pr: 2,
          pb: 4
        }}
      >
        
        {/* Program Selection */}
            <Box>
              <Typography
                variant="h4"
                fontWeight="bold"
                sx={{ mb: 2, color: colors.tealAccent[500] }}
              >
            Program Selection
              </Typography>
              
          <FormControl fullWidth sx={{ maxWidth: "500px" }}>
            <InputLabel id="program-select-label" color="secondary">
              Select Program
                </InputLabel>
                <Select
              labelId="program-select-label"
              value={selectedProgramId}
              label="Select Program"
              onChange={handleProgramChange}
                  color="secondary"
                >
              {programs.map((prog) => (
                <MenuItem key={prog.id} value={prog.id}>
                  {prog.name}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Box>

        {/* Program Information - Only show when program is selected */}
        {selectedProgramId && assignments.length > 0 && (
              <Box>
                <Typography
                  variant="h4"
                  fontWeight="bold"
                  sx={{ mb: 1, color: colors.tealAccent[500] }}
                >
                  Program Information
                </Typography>
                
                {/* Time Range Display */}
                {programStats && programStats.start_ts && programStats.end_ts && (
                  <Typography
                    variant="body2"
                    sx={{ 
                      mb: 2,
                      color: isDarkMode ? colors.primary[1000] : colors.primary[1000],
                      fontStyle: 'italic'
                    }}
                  >
                    {new Date(programStats.start_ts).toLocaleString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit'
                    })}
                    {' → '}
                    {new Date(programStats.end_ts).toLocaleString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit'
                    })}
                  </Typography>
                )}
                
            {/* Assignment Grid + Recipe Specs - Combined Table */}
            <Paper sx={{ p: 3, backgroundColor: colors.primary[200] }}>
              <Box display="grid" gridTemplateColumns="250px repeat(8, 20px) 60px repeat(6, 80px)" gap="2px">
                {/* Header Level 1 - Grouped headers */}
                <Box sx={{ p: TABLE_HEADER1_PADDING, display: 'flex', alignItems: 'center', minHeight: TABLE_HEADER1_HEIGHT }}>
                  <Typography variant="body2" fontWeight="bold">Recipe</Typography>
                </Box>
                <Box sx={{ p: TABLE_HEADER1_PADDING, display: 'flex', alignItems: 'center', minHeight: TABLE_HEADER1_HEIGHT, gridColumn: 'span 8' }}>
                  <Typography variant="body2" fontWeight="bold">Gates</Typography>
                </Box>
                {/* Spacer column */}
                <Box/>
                <Box sx={{ pl: TABLE_HEADER2_PADDING, display: 'flex', alignItems: 'center', justifyContent: 'flex-start', minHeight: TABLE_HEADER1_HEIGHT, gridColumn: 'span 2' }}>
                  <Typography variant="body2" fontWeight="bold">Piece Weight</Typography>
                </Box>
                <Box sx={{ pl: TABLE_HEADER2_PADDING, display: 'flex', alignItems: 'center', justifyContent: 'flex-start', minHeight: TABLE_HEADER1_HEIGHT, gridColumn: 'span 2' }}>
                  <Typography variant="body2" fontWeight="bold">Batch Weight</Typography>
                </Box>
                <Box sx={{ pl: TABLE_HEADER2_PADDING, display: 'flex', alignItems: 'center', justifyContent: 'flex-start', minHeight: TABLE_HEADER1_HEIGHT, gridColumn: 'span 2' }}>
                  <Typography variant="body2" fontWeight="bold">Pieces</Typography>
                </Box>

                {/* Header Level 2 - Detail headers */}
                <Box sx={{ p: TABLE_HEADER2_PADDING, display: 'flex', alignItems: 'center', minHeight: TABLE_HEADER2_HEIGHT, mb: 1 }}>
                  {/* Empty cell for Recipe column */}
                </Box>
                {[1, 2, 3, 4, 5, 6, 7, 8].map(gate => (
                  <Box key={gate} sx={{ p: TABLE_HEADER2_PADDING, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: TABLE_HEADER2_HEIGHT, mb: 1 }}>
                    <Typography variant="body2" fontWeight="bold">{gate}</Typography>
                  </Box>
                ))}
                {/* Spacer column */}
                <Box sx={{ mb: 1 }}/>
                <Box sx={{ p: TABLE_HEADER2_PADDING, display: 'flex', alignItems: 'center', minHeight: TABLE_HEADER2_HEIGHT, mb: 1 }}>
                  <Typography variant="body2" fontWeight="bold">Min</Typography>
                </Box>
                <Box sx={{ p: TABLE_HEADER2_PADDING, display: 'flex', alignItems: 'center', minHeight: TABLE_HEADER2_HEIGHT, mb: 1 }}>
                  <Typography variant="body2" fontWeight="bold">Max</Typography>
                </Box>
                <Box sx={{ p: TABLE_HEADER2_PADDING, display: 'flex', alignItems: 'center', minHeight: TABLE_HEADER2_HEIGHT, mb: 1 }}>
                  <Typography variant="body2" fontWeight="bold">Min</Typography>
                </Box>
                <Box sx={{ p: TABLE_HEADER2_PADDING, display: 'flex', alignItems: 'center', minHeight: TABLE_HEADER2_HEIGHT, mb: 1 }}>
                  <Typography variant="body2" fontWeight="bold">Max</Typography>
                </Box>
                <Box sx={{ p: TABLE_HEADER2_PADDING, display: 'flex', alignItems: 'center', minHeight: TABLE_HEADER2_HEIGHT, mb: 1 }}>
                  <Typography variant="body2" fontWeight="bold">Min</Typography>
                </Box>
                <Box sx={{ p: TABLE_HEADER2_PADDING, display: 'flex', alignItems: 'center', minHeight: TABLE_HEADER2_HEIGHT, mb: 1 }}>
                  <Typography variant="body2" fontWeight="bold">Max</Typography>
                </Box>

                {/* Recipe rows */}
                {gateGridData.recipes.map(recipe => {
                  const spec = getRecipeSpec(recipe);
                  return (
                    <React.Fragment key={recipe}>
                      {/* Recipe name - left-aligned, full width */}
                      <Box sx={{ p: TABLE_ROW_PADDING, display: 'flex', alignItems: 'center', minHeight: TABLE_ROW_HEIGHT }}>
                        <Typography variant="body2">{recipe}</Typography>
                      </Box>
                      
                      {/* Gate assignments - square boxes */}
                      {[1, 2, 3, 4, 5, 6, 7, 8].map(gate => (
                        <Box 
                          key={`${recipe}-${gate}`} 
                      sx={{
                            backgroundColor: gateGridData.grid[recipe]?.[gate] ? recipeColorMap[recipe] : undefined,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            minHeight: TABLE_ROW_HEIGHT,
                            height: TABLE_ROW_HEIGHT
                          }}
                        />
                      ))}
                      
                      {/* Spacer column - same background as container */}
                      <Box />
                      
                      {/* Recipe specifications - centered */}
                      <Box sx={{ p: TABLE_ROW_PADDING, display: 'flex', alignItems: 'center', justifyContent: 'left', minHeight: TABLE_ROW_HEIGHT }}>
                        <Typography variant="body2">{spec.piece_min_weight_g || '-'}</Typography>
                      </Box>
                      <Box sx={{ p: TABLE_ROW_PADDING, display: 'flex', alignItems: 'center', justifyContent: 'left', minHeight: TABLE_ROW_HEIGHT }}>
                        <Typography variant="body2">{spec.piece_max_weight_g || '-'}</Typography>
                      </Box>
                      <Box sx={{ p: TABLE_ROW_PADDING, display: 'flex', alignItems: 'center', justifyContent: 'left', minHeight: TABLE_ROW_HEIGHT }}>
                        <Typography variant="body2">{spec.batch_min_weight_g || '-'}</Typography>
                      </Box>
                      <Box sx={{ p: TABLE_ROW_PADDING, display: 'flex', alignItems: 'center', justifyContent: 'left', minHeight: TABLE_ROW_HEIGHT }}>
                        <Typography variant="body2">{spec.batch_max_weight_g || '-'}</Typography>
                      </Box>
                      <Box sx={{ p: TABLE_ROW_PADDING, display: 'flex', alignItems: 'center', justifyContent: 'left', minHeight: TABLE_ROW_HEIGHT }}>
                        <Typography variant="body2">{spec.min_pieces_per_batch || '-'}</Typography>
                      </Box>
                      <Box sx={{ p: TABLE_ROW_PADDING, display: 'flex', alignItems: 'center', justifyContent: 'left', minHeight: TABLE_ROW_HEIGHT }}>
                        <Typography variant="body2">{spec.max_pieces_per_batch || '-'}</Typography>
                      </Box>
                    </React.Fragment>
                  );
                })}
              </Box>
            </Paper>
          </Box>
        )}

        {/* Program Total Stats */}
        {selectedProgramId && programStats && (
          <Box>
              <Typography
                variant="h4"
                fontWeight="bold"
                sx={{ mb: 2, color: colors.tealAccent[500] }}
              >
              Program Total Stats
              </Typography>
              
            <Box display="flex" gap={3} alignItems="flex-start" flexWrap="wrap">
              {/* Total Batches */}
              <Box sx={{ minWidth: '150px' }}>
                <Typography variant="h5" fontWeight="bold" color={colors.tealAccent[500]} mb={1}>
                  Total Batches
                </Typography>
                <Typography variant="h3" fontWeight="bold">
                  {(programStats.total_batches ?? 0).toLocaleString()}
                </Typography>
              </Box>

              {/* Total Pieces */}
              <Box sx={{ minWidth: '150px' }}>
                <Typography variant="h5" fontWeight="bold" color={colors.tealAccent[500]} mb={1}>
                  Total Pieces
                </Typography>
                <Typography variant="h3" fontWeight="bold">
                  {((programStats.total_items_batched ?? 0) + (programStats.total_items_rejected ?? 0)).toLocaleString()}
                </Typography>
                <Box display="flex" flexDirection="column" gap={1} mt={1}>
                  <Typography variant="body1">
                    Batched: <strong>{(programStats.total_items_batched ?? 0).toLocaleString()}</strong>
                  </Typography>
                  <Typography variant="body1">
                    Rejected: <strong>{(programStats.total_items_rejected ?? 0).toLocaleString()}</strong>
                  </Typography>
                </Box>
              </Box>

              {/* Total Giveaway Percentage */}
              <Box sx={{ minWidth: '150px' }}>
                <Typography variant="h5" fontWeight="bold" color={colors.tealAccent[500]} mb={1}>
                  Total Giveaway
                </Typography>
                <Typography variant="h3" fontWeight="bold">
                  {(((programStats.total_giveaway_weight_g ?? 0) / (programStats.total_batched_weight_g ?? 1)) * 100).toFixed(2)}%
                </Typography>
                <Typography variant="body1" mt={1}>
                  {((programStats.total_giveaway_weight_g ?? 0) / 1000).toFixed(2)} kg of {((programStats.total_batched_weight_g ?? 0) / 1000).toFixed(2)} kg
                </Typography>
              </Box>

              {/* Total Weight */}
              <Box sx={{ minWidth: '150px' }}>
                <Typography variant="h5" fontWeight="bold" color={colors.tealAccent[500]} mb={1}>
                  Total Weight
                </Typography>
                <Typography variant="h3" fontWeight="bold">
                  {(((programStats.total_batched_weight_g ?? 0) + (programStats.total_reject_weight_g ?? 0)) / 1000).toFixed(2)} kg
                </Typography>
                <Typography variant="body1" mt={1}>
                  Average piece weight: <strong>
                    {(((programStats.total_batched_weight_g ?? 0) + (programStats.total_reject_weight_g ?? 0)) / 
                      Math.max(1, (programStats.total_items_batched ?? 0) + (programStats.total_items_rejected ?? 0))).toFixed(2)} g
                  </strong>
                </Typography>
              </Box>

              {/* Weight Distribution Pie Chart */}
              <Box sx={{ minWidth: '250px', maxWidth: '400px' }}>
                <Typography variant="h5" fontWeight="bold" color={colors.tealAccent[500]} mb={1}>
                  Weight Distribution
                </Typography>
                <Box height="210px">
                  <ResponsivePie
                    data={weightDistributionData}
                    theme={chartTheme}
                    margin={{ top: 20, right: 20, bottom: 20, left: 20 }}
                    innerRadius={0.65}
                    padAngle={3}
                    cornerRadius={3}
                    activeOuterRadiusOffset={8}
                    colors={({ data }) => data.color}
                    borderWidth={1}
                    borderColor={{ from: 'color', modifiers: [['darker', 0.2]] }}
                    arcLinkLabelsSkipAngle={0}
                    arcLinkLabelsTextColor={colors.primary[800]}
                    arcLinkLabelsThickness={2}
                    arcLinkLabelsColor={{ from: 'color' }}
                    arcLabelsSkipAngle={0}
                    arcLabelsTextColor="#ffffff"
                    valueFormat={value => `${(value / 1000).toFixed(1)}kg`}
                    tooltip={({ datum }) => (
                      <div style={{
                        padding: '9px 12px',
                        background: isDarkMode ? colors.primary[400] : colors.primary[100],
                        color: isDarkMode ? colors.grey[100] : colors.grey[900],
                        borderRadius: '4px'
                      }}>
                        <strong>{datum.label}:</strong> {(datum.value / 1000).toFixed(2)} kg
                      </div>
                    )}
                  />
                </Box>
              </Box>

              {/* Piece Weight Distribution Bar Chart */}
              <Box sx={{ minWidth: '300px', maxWidth: '400px' }}>
                <Typography variant="h5" fontWeight="bold" color={colors.tealAccent[500]} mb={0.5}>
                  Piece Weight Distribution
                </Typography>
                {pieceDistribution && pieceDistribution.totalPieces > 0 && (
                  <Typography variant="body2" color={colors.grey[500]} mb={1}>
                    {pieceDistribution.totalPieces.toLocaleString()} pieces • {pieceDistribution.minWeight}g - {pieceDistribution.maxWeight}g
                  </Typography>
                )}
                {pieceDistribution && pieceDistribution.bins && pieceDistribution.bins.length > 0 ? (
                  <Box height="230px">
                    <ResponsiveBar
                      data={(() => {
                        // Filter out bins with 0 count for cleaner display
                        const nonZeroBins = pieceDistribution.bins.filter(bin => bin.count > 0);
                        return nonZeroBins.map(bin => ({
                          id: bin.label,
                          label: bin.label,
                          value: bin.count,
                          rangeStart: bin.rangeStart,
                          rangeEnd: bin.rangeEnd
                        }));
                      })()}
                      theme={chartTheme}
                      keys={['value']}
                      indexBy="id"
                      margin={{ top: 20, right: 20, bottom: 60, left: 60 }}
                      padding={0.2}
                      minValue={0}
                      colors={colors.tealAccent[500]}
                      borderColor={{ from: 'color', modifiers: [['darker', 0.2]] }}
                      axisBottom={{
                        tickSize: 0,
                        tickPadding: 8,
                        tickRotation: -45,
                        tickValues: (() => {
                          // Only show ticks for bins with data
                          const nonZeroBins = pieceDistribution.bins.filter(bin => bin.count > 0);
                          if (nonZeroBins.length <= 8) return nonZeroBins.map(b => b.label);
                          
                          // Select exactly 8 evenly distributed ticks
                          const step = Math.floor(nonZeroBins.length / 7); // 7 intervals = 8 ticks
                          const ticks = [];
                          for (let i = 0; i < nonZeroBins.length; i += step) {
                            if (ticks.length < 8) {
                              ticks.push(nonZeroBins[i].label);
                            }
                          }
                          return ticks;
                        })()
                      }}
                      axisLeft={{
                        tickSize: 5,
                        tickPadding: 5,
                        tickRotation: 0,
                        legend: 'Pieces',
                        legendPosition: 'middle',
                        legendOffset: -45,
                        tickValues: (() => {
                          const maxCount = Math.max(...pieceDistribution.bins.map(b => b.count));
                          const step = Math.ceil(maxCount / 8);
                          const ticks = [];
                          for (let i = 0; i <= maxCount && ticks.length <= 8; i += step) {
                            ticks.push(i);
                          }
                          return ticks;
                        })()
                      }}
                      enableLabel={false}
                      enableGridY={false}
                      tooltip={({ id, value, data }) => (
                        <div style={{
                          padding: '9px 12px',
                          background: isDarkMode ? colors.primary[400] : colors.primary[100],
                          color: isDarkMode ? colors.grey[100] : colors.grey[900],
                          borderRadius: '4px'
                        }}>
                          <strong>{data.rangeStart}g - {data.rangeEnd}g</strong><br />
                          {value.toLocaleString()} pieces
                        </div>
                      )}
                    />
                  </Box>
                ) : (
                  <Box height="230px" display="flex" alignItems="center" justifyContent="center">
                    <Typography variant="body2" color={colors.grey[500]}>
                      {pieceDistribution === null ? 'Loading piece data...' : 'No piece data available'}
                    </Typography>
                  </Box>
                )}
              </Box>
            </Box>
          </Box>
        )}

        {/* Recipe Total Stats */}
        {selectedProgramId && recipeStats.length > 0 && (
          <Box>
            <Box display="flex" alignItems="center" justifyContent="space-between" mb="20px">
              <Typography
                variant="h4"
                fontWeight="bold"
                sx={{ color: colors.tealAccent[500] }}
              >
                Recipe Total Stats
              </Typography>
              
              {/* Recipe selectors - aligned to the right */}
              <Box 
                display="flex" 
                alignItems="center"
                gap="15px"
              >
                {recipeStats.map((recipe) => {
                  const recipeColor = recipeColorMap[recipe.recipe_name] || colors.grey[500];
                  return (
                    <Box 
                      key={recipe.recipe_name}
                      display="flex" 
                      alignItems="center" 
                      gap="5px"
                      onClick={() => {
                        setVisibleRecipes(prev => ({
                          ...prev,
                          [recipe.recipe_name]: !prev[recipe.recipe_name]
                        }));
                      }}
                      sx={{ 
                        cursor: 'pointer',
                        opacity: visibleRecipes[recipe.recipe_name] !== false ? 1 : 0.4,
                        transition: 'all 0.2s',
                        '&:hover': {
                          transform: 'scale(1.05)',
                        },
                        border: visibleRecipes[recipe.recipe_name] !== false ? 'none' : `1px solid ${colors.grey[300]}`,
                        borderRadius: '4px',
                        padding: '2px 6px',
                      }}
                    >
                      <Box 
                        width="12px" 
                        height="12px" 
                        borderRadius="50%" 
                        sx={{ backgroundColor: recipeColor }} 
                      />
                      <Typography variant="body2" color={colors.primary[800]}>
                        {recipe.recipe_name}
                      </Typography>
                    </Box>
                  );
                })}
              </Box>
            </Box>

            {/* The grid of four charts */}
            <Box
              display="grid"
              gridTemplateColumns="repeat(4, 1fr)"
              gap={5}
              sx={{
                width: "100%",
                minWidth: 0,
              }}
            >
              {/* Chart 1 - Total Batches */}
              <Box sx={{ width: "100%", minWidth: 0 }}>
                <Typography variant="h5" color={colors.tealAccent[500]} mb={1}>
                  Total Batches
                </Typography>
                <Box height="300px" width="100%">
                  <ResponsiveBar
                    data={recipeStats
                      .filter(r => visibleRecipes[r.recipe_name] !== false)
                      .map(r => ({
                        recipe: r.recipe_name,
                        value: r.total_batches,
                        recipeColor: recipeColorMap[r.recipe_name] || colors.grey[500]
                      }))}
                    keys={['value']}
                    indexBy="recipe"
                    colors={({ data }) => data.recipeColor}
                    theme={chartTheme}
                    padding={0.3}
                    margin={{ top: 20, right: 20, bottom: 20, left: 60 }}
                    valueScale={{ type: 'linear' }}
                    indexScale={{ type: 'band', round: true }}
                    borderColor={{ from: 'color', modifiers: [['darker', 1.6]] }}
                    axisTop={null}
                    axisRight={null}
                    axisBottom={{
                      tickSize: 0,
                      tickPadding: 0,
                      tickRotation: 0,
                      tickValues: [],
                      legend: '',
                      legendPosition: 'middle',
                      legendOffset: 0,
                    }}
                    axisLeft={{
                      tickSize: 5,
                      tickPadding: 5,
                      tickRotation: 0,
                      legend: '',
                      legendPosition: 'middle',
                      legendOffset: -40,
                    }}
                    labelSkipWidth={12}
                    labelSkipHeight={12}
                    enableGridY={false}
                    labelTextColor="#ffffff"
                  />
                </Box>
              </Box>

              {/* Chart 2 - Average Weight per Batch */}
              <Box sx={{ width: "100%", minWidth: 0 }}>
                <Typography variant="h5" color={colors.tealAccent[500]} mb={1}>
                  Average Weight (g)
                </Typography>
                <Box height="300px" width="100%">
                  <ResponsiveBar
                    data={recipeStats
                      .filter(r => visibleRecipes[r.recipe_name] !== false)
                      .map(r => {
                        const avgWeight = r.total_batches > 0 ? (r.total_weight_processed_g / r.total_batches) : 0;
                        return {
                          recipe: r.recipe_name,
                          value: avgWeight,
                          recipeColor: recipeColorMap[r.recipe_name] || colors.grey[500]
                        };
                      })}
                    keys={['value']}
                    indexBy="recipe"
                    colors={({ data }) => data.recipeColor}
                    valueFormat={value => value.toFixed(1)}
                    theme={chartTheme}
                    padding={0.3}
                    margin={{ top: 20, right: 20, bottom: 20, left: 60 }}
                    valueScale={{ type: 'linear' }}
                    indexScale={{ type: 'band', round: true }}
                    borderColor={{ from: 'color', modifiers: [['darker', 1.6]] }}
                    axisTop={null}
                    axisRight={null}
                    axisBottom={{
                      tickSize: 0,
                      tickPadding: 0,
                      tickRotation: 0,
                      tickValues: [],
                      legend: '',
                      legendPosition: 'middle',
                      legendOffset: 0,
                    }}
                    axisLeft={{
                      tickSize: 5,
                      tickPadding: 5,
                      tickRotation: 0,
                      legend: '',
                      legendPosition: 'middle',
                      legendOffset: -40,
                    }}
                    labelSkipWidth={12}
                    labelSkipHeight={12}
                    enableGridY={false}
                    labelTextColor="#ffffff"
                  />
                </Box>
              </Box>

              {/* Chart 3 - Average Items per Batch */}
              <Box sx={{ width: "100%", minWidth: 0 }}>
                <Typography variant="h5" color={colors.tealAccent[500]} mb={1}>
                  Average Items
                </Typography>
                <Box height="300px" width="100%">
                  <ResponsiveBar
                    data={recipeStats
                      .filter(r => visibleRecipes[r.recipe_name] !== false)
                      .map(r => ({
                        recipe: r.recipe_name,
                        value: r.total_batches > 0 ? (r.total_items_batched / r.total_batches) : 0,
                        recipeColor: recipeColorMap[r.recipe_name] || colors.grey[500]
                      }))}
                    keys={['value']}
                    indexBy="recipe"
                    colors={({ data }) => data.recipeColor}
                    valueFormat={value => value.toFixed(1)}
                    theme={chartTheme}
                    padding={0.3}
                    margin={{ top: 20, right: 20, bottom: 20, left: 60 }}
                    valueScale={{ type: 'linear' }}
                    indexScale={{ type: 'band', round: true }}
                    borderColor={{ from: 'color', modifiers: [['darker', 1.6]] }}
                    axisTop={null}
                    axisRight={null}
                    axisBottom={{
                      tickSize: 0,
                      tickPadding: 0,
                      tickRotation: 0,
                      tickValues: [],
                      legend: '',
                      legendPosition: 'middle',
                      legendOffset: 0,
                    }}
                    axisLeft={{
                      tickSize: 5,
                      tickPadding: 5,
                      tickRotation: 0,
                      legend: '',
                      legendPosition: 'middle',
                      legendOffset: -40,
                    }}
                    labelSkipWidth={12}
                    labelSkipHeight={12}
                    enableGridY={false}
                    labelTextColor="#ffffff"
                  />
                </Box>
              </Box>

              {/* Chart 4 - Giveaway Pie Chart */}
              <Box sx={{ width: "80%", minWidth: 0 }}>
                <Typography variant="h5" color={colors.tealAccent[500]} mb={1}>
                  Giveaway (%)
                </Typography>
                <Box height="300px" width="100%">
                  <ResponsivePie
                    data={recipeStats
                      .filter(r => visibleRecipes[r.recipe_name] !== false && r.total_giveaway_pct != null)
                      .map(r => ({
                        id: r.recipe_name,
                        label: r.recipe_name,
                        value: r.total_giveaway_pct || 0,
                        color: recipeColorMap[r.recipe_name] || colors.grey[500]
                      }))}
                    theme={chartTheme}
                    margin={{ top: 20, right: 20, bottom: 20, left: 20 }}
                    innerRadius={0.65}
                    padAngle={3}
                    cornerRadius={3}
                    activeOuterRadiusOffset={8}
                    colors={({ data }) => data.color}
                    borderWidth={1}
                    borderColor={{ from: 'color', modifiers: [['darker', 0.2]] }}
                    enableArcLinkLabels={false}
                    arcLabelsSkipAngle={10}
                    arcLabelsTextColor="#ffffff"
                    valueFormat={value => `${(value || 0).toFixed(2)}%`}
                    tooltip={({ datum }) => (
                      <div style={{
                        padding: '9px 12px',
                        background: isDarkMode ? colors.primary[400] : colors.primary[100],
                        color: isDarkMode ? colors.grey[100] : colors.grey[900],
                        borderRadius: '4px'
                      }}>
                        <strong>{datum.label}:</strong> {(datum.value || 0).toFixed(2)}%
                      </div>
                    )}
                  />
                </Box>
              </Box>
            </Box>
          </Box>
        )}
      
      </Box>
    </Box>
  );
};

export default Stats;
