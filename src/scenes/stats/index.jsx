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
import { ResponsiveSunburst } from "@nivo/sunburst";
import { ResponsiveBoxPlot } from "@nivo/boxplot";
import { ResponsiveLine } from "@nivo/line";
import { ResponsiveScatterPlot } from "@nivo/scatterplot";
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
  const [gateDwellData, setGateDwellData] = useState(null);
  const [historyData, setHistoryData] = useState(null);
  const [pieceWeights, setPieceWeights] = useState([]);
  const [loading, setLoading] = useState(true);
  const [visibleRecipes, setVisibleRecipes] = useState({});
  const [allRecipes, setAllRecipes] = useState([]); // All recipes for display name lookup
  
  // Separate visibility state for sunburst charts
  const [visiblePiecesCategories, setVisiblePiecesCategories] = useState({
    batched: true,
    rejected: true
  });
  const [visibleWeightCategories, setVisibleWeightCategories] = useState({
    batched: true,
    rejected: true,
    giveaway: true
  });

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
        background: isDarkMode ? colors.primary[600] : colors.primary[200],
        color: isDarkMode ? colors.grey[100] : colors.grey[900],
      },
    },
  };

  // Shared tooltip style for custom tooltips (avoids duplicating theme colors)
  const tooltipStyle = {
    padding: '9px 12px',
    background: isDarkMode ? colors.primary[600] : colors.primary[200],
    color: isDarkMode ? colors.grey[100] : colors.grey[900],
    borderRadius: '4px',
  };

  // Load programs and recipes on mount
  useEffect(() => {
    fetchPrograms();
    fetchAllRecipes();
  }, []);

  // Fetch all recipes for display name lookup
  const fetchAllRecipes = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/settings/recipes`, {
        headers: getAuthHeaders()
      });
      if (response.ok) {
        const data = await response.json();
        setAllRecipes(data.recipes || []);
      }
    } catch (error) {
      console.error("Error fetching recipes for display names:", error);
    }
  };

  // Build display name mapping from recipes
  const recipeDisplayNames = useMemo(() => {
    const map = {};
    allRecipes.forEach(recipe => {
      if (recipe.name && recipe.display_name) {
        map[recipe.name] = recipe.display_name;
      }
    });
    return map;
  }, [allRecipes]);

  // Helper to get display name for a recipe (returns display_name if available, otherwise formatted name)
  const getDisplayName = (recipeName) => {
    if (!recipeName) return '';
    const displayName = recipeDisplayNames[recipeName];
    if (displayName) return displayName;
    // Format: remove R_ prefix and _NA_0 suffix for cleaner display
    let formatted = recipeName;
    if (formatted.startsWith("R_")) formatted = formatted.substring(2);
    if (formatted.endsWith("_NA_0")) formatted = formatted.slice(0, -5);
    return formatted;
  };

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

      // Fetch piece weight distribution histogram for this program
      try {
        const piecesResponse = await fetch(`${API_BASE}/api/stats/programs/${programId}/pieces-histogram`, {
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

      // Fetch gate dwell times for this program
      try {
        const dwellResponse = await fetch(`${API_BASE}/api/stats/programs/${programId}/gate-dwell`, {
          headers: getAuthHeaders()
        });
        if (dwellResponse.ok) {
          const dwellData = await dwellResponse.json();
          console.log("Fetched gate dwell data:", dwellData);
          setGateDwellData(dwellData);
        } else {
          console.error("Failed to fetch gate dwell:", dwellResponse.status, dwellResponse.statusText);
          setGateDwellData(null);
        }
      } catch (dwellError) {
        console.error("Error fetching gate dwell data:", dwellError);
        setGateDwellData(null);
      }

      // Fetch per-minute history data for this program
      try {
        const historyResponse = await fetch(`${API_BASE}/api/stats/programs/${programId}/history`, {
          headers: getAuthHeaders()
        });
        if (historyResponse.ok) {
          const historyData = await historyResponse.json();
          console.log("Fetched history data:", historyData);
          setHistoryData(historyData);
        } else {
          console.error("Failed to fetch history:", historyResponse.status, historyResponse.statusText);
          setHistoryData(null);
        }
      } catch (historyError) {
        console.error("Error fetching history data:", historyError);
        setHistoryData(null);
      }

      // Fetch piece weights for scatter plot
      try {
        const piecesResponse = await fetch(`${API_BASE}/api/stats/programs/${programId}/pieces`, {
          headers: getAuthHeaders()
        });
        if (piecesResponse.ok) {
          const piecesData = await piecesResponse.json();
          console.log("Fetched piece weights:", piecesData.scatterPoints?.length || 0, "scatter points,", piecesData.trendLine?.length || 0, "trend points");
          setPieceWeights(piecesData);
        } else {
          console.error("Failed to fetch piece weights:", piecesResponse.status, piecesResponse.statusText);
          setPieceWeights({ scatterPoints: [], trendLine: [] });
        }
      } catch (piecesError) {
        console.error("Error fetching piece weights:", piecesError);
        setPieceWeights({ scatterPoints: [], trendLine: [] });
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
        mt="72px" 
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
                    {new Date(programStats.start_ts).toLocaleString(undefined, {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit'
                    })}
                    {' → '}
                    {new Date(programStats.end_ts).toLocaleString(undefined, {
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
                        <Typography variant="body2">{getDisplayName(recipe)}</Typography>
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
              Program Stats
              </Typography>
              
            <Box 
              display="grid" 
              gridTemplateColumns="1fr 1fr 1fr 1fr 1.5fr 1.5fr" 
              gap={3}
              sx={{
                width: "100%",
                minWidth: 0,
                overflow: "visible",
              }}
            >
              {/* Total Batches */}
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="h5" fontWeight="bold" color={colors.tealAccent[500]} mb={1}>
                  Total Batches
                </Typography>
                <Typography variant="h3" fontWeight="bold">
                  {(programStats.total_batches ?? 0).toLocaleString()}
                    </Typography>
                  </Box>

              {/* Total Pieces */}
              <Box sx={{ minWidth: 0 }}>
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
              <Box sx={{ minWidth: 0 }}>
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
              <Box sx={{ minWidth: 0 }}>
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
              <Box sx={{ minWidth: 0, gridColumn: "span 1", overflow: "visible" }}>
                <Typography variant="h5" fontWeight="bold" color={colors.tealAccent[500]} mb={1}>
                  Weight Distribution
                      </Typography>
                <Box height="210px" sx={{ overflow: "visible", "& svg": { overflow: "visible" } }}>
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
                      <div style={tooltipStyle}>
                        <strong>{datum.label}:</strong> {(datum.value / 1000).toFixed(2)} kg
                      </div>
                    )}
                  />
                </Box>
              </Box>

              {/* Piece Weight Distribution Bar Chart */}
              <Box sx={{ minWidth: 0, gridColumn: "span 1" }}>
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
                        <div style={tooltipStyle}>
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
            <Box mb="20px">
                  <Typography
                    variant="h4"
                    fontWeight="bold"
                    sx={{ color: colors.tealAccent[500] }}
                  >
                Recipe Stats
                  </Typography>
            </Box>

            {/* Key Insights */}
            <Box mb={5}>
              <Typography variant="h5" color={colors.tealAccent[500]} mb={1.5}>
                Key Insights
              </Typography>
              {(() => {
                // Calculate insights - use sum of recipe batches as the real total
                const totalRecipeBatches = recipeStats.reduce((sum, r) => sum + (r.total_batches || 0), 0);
                
                // Find recipe with most batches
                const mostBatchesRecipe = recipeStats.reduce((max, r) => 
                  (r.total_batches || 0) > (max.total_batches || 0) ? r : max
                , recipeStats[0] || {});
                const mostBatchesPercent = totalRecipeBatches > 0 
                  ? ((mostBatchesRecipe.total_batches || 0) / totalRecipeBatches * 100).toFixed(0)
                  : 0;
                
                // Find recipe with highest giveaway
                const highestGiveawayRecipe = recipeStats.reduce((max, r) => 
                  (r.total_giveaway_pct || 0) > (max.total_giveaway_pct || 0) ? r : max
                , recipeStats[0] || {});
                
                // Find recipe with most pieces
                const mostPiecesRecipe = recipeStats.reduce((max, r) => 
                  (r.total_items_batched || 0) > (max.total_items_batched || 0) ? r : max
                , recipeStats[0] || {});
                const mostPiecesCount = (mostPiecesRecipe.total_items_batched || 0).toLocaleString();
                
                return (
                  <Box display="flex" flexDirection="column" gap={0.5}>
                    <Box display="flex" alignItems="center" gap={1}>
                      <span style={{ color: colors.tealAccent[500], minWidth: '20px', display: 'inline-block' }}>✓</span>
                      <Typography variant="body1" sx={{ color: colors.primary[800] }}>
                        Recipe <strong>{getDisplayName(mostBatchesRecipe.recipe_name)}</strong> processed <strong>{mostBatchesPercent}%</strong> of all batches
                      </Typography>
                    </Box>
                    <Box display="flex" alignItems="center" gap={1}>
                      <span style={{ color: colors.redAccent[500], minWidth: '20px', display: 'inline-block' }}>⚠</span>
                      <Typography variant="body1" sx={{ color: colors.primary[800] }}>
                        Recipe <strong>{getDisplayName(highestGiveawayRecipe.recipe_name)}</strong> has highest giveaway at <strong>{(highestGiveawayRecipe.total_giveaway_pct || 0).toFixed(2)}%</strong>
                      </Typography>
                    </Box>
                    <Box display="flex" alignItems="center" gap={1}>
                      <span style={{ color: colors.tealAccent[500], minWidth: '20px', display: 'inline-block' }}>✓</span>
                      <Typography variant="body1" sx={{ color: colors.primary[800] }}>
                        Recipe <strong>{getDisplayName(mostPiecesRecipe.recipe_name)}</strong> processed the most pieces at <strong>{mostPiecesCount}</strong> pieces
                      </Typography>
                    </Box>
                  </Box>
                );
              })()}
            </Box>

            {/* First Row - Recipe Legend + Three Bar Charts */}
            <Box
              display="grid"
              gridTemplateColumns="repeat(4, 1fr)"
              gap={5}
              sx={{
                width: "100%",
                minWidth: 0,
              }}
            >

              {/* Recipe Legend - Single Column */}
              <Box sx={{ width: "100%", minWidth: 0 }}>
                <Typography variant="h5" color={colors.tealAccent[500]} mb={1}>
                  Recipes
                </Typography>
                  <Box 
                    display="flex" 
                  flexDirection="column"
                  gap="8px"
                  mt={2}
                  >
                  {recipeStats.map((recipe) => {
                    const recipeColor = recipeColorMap[recipe.recipe_name] || colors.grey[500];
                    return (
                      <Box 
                        key={recipe.recipe_name}
                        display="flex" 
                        alignItems="center" 
                        gap="8px"
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
                          padding: '4px 8px',
                        }}
                      >
                        <Box 
                          width="12px" 
                          height="12px" 
                          borderRadius="50%" 
                          sx={{ backgroundColor: recipeColor, flexShrink: 0 }} 
                        />
                        <Typography variant="body2" color={colors.primary[800]} >
                          {getDisplayName(recipe.recipe_name)}
                        </Typography>
                      </Box>
                    );
                  })}
                  </Box>
                </Box>

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
                        recipe: getDisplayName(r.recipe_name),
                        value: r.total_batches,
                        recipeColor: recipeColorMap[r.recipe_name] || colors.grey[500]
                      }))}
                        keys={['value']}
                    indexBy="recipe"
                    colors={({ data }) => data.recipeColor}
                        theme={chartTheme}
                    valueFormat={value => value.toFixed(1)}
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
                  Average Weight per Batch (g)
                    </Typography>
                    <Box height="300px" width="100%">
                      <ResponsiveBar
                    data={recipeStats
                      .filter(r => visibleRecipes[r.recipe_name] !== false)
                      .map(r => {
                        const avgWeight = r.total_batches > 0 ? (r.total_weight_processed_g / r.total_batches) : 0;
                        return {
                          recipe: getDisplayName(r.recipe_name),
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

              {/* Chart 3 - Average Pieces per Batch */}
                  <Box sx={{ width: "100%", minWidth: 0 }}>
                    <Typography variant="h5" color={colors.tealAccent[500]} mb={1}>
                  Average Pieces per Batch
                    </Typography>
                    <Box height="300px" width="100%">
                      <ResponsiveBar
                    data={recipeStats
                      .filter(r => visibleRecipes[r.recipe_name] !== false)
                      .map(r => ({
                        recipe: getDisplayName(r.recipe_name),
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
              </Box>
              
            {/* Second Row - Giveaway Pie + Sunburst Charts */}
            <Box
              display="grid"
              gridTemplateColumns="repeat(3, 1fr)"
              gap={5}
              sx={{
                width: "100%",
                minWidth: 0,
                mt: 5,
              }}
            >
              {/* Giveaway Pie Chart */}
              <Box sx={{ width: "100%", minWidth: 0 }}>
                <Typography variant="h5" color={colors.tealAccent[500]} mb={1}>
                  Giveaway (%)
              </Typography>
              
                {/* Spacer to match sunburst legend height */}
                <Box mb={9.0} />
                
                <Box height="300px" width="100%">
                  <ResponsivePie
                    data={recipeStats
                      .filter(r => visibleRecipes[r.recipe_name] !== false && r.total_giveaway_pct != null)
                      .map(r => ({
                        id: getDisplayName(r.recipe_name),
                        label: getDisplayName(r.recipe_name),
                        value: r.total_giveaway_pct || 0,
                        color: recipeColorMap[r.recipe_name] || colors.grey[500]
                      }))}
                    theme={chartTheme}
                    margin={{ top: 20, right: 20, bottom: 20, left: 20 }}
                    innerRadius={0.70}
                    padAngle={3}
                    cornerRadius={3}
                    activeOuterRadiusOffset={8}
                    colors={({ data }) => data.color}
                    borderWidth={1}
                    borderColor={{ from: 'color', modifiers: [['darker', 0.2]] }}
                    enableArcLinkLabels={false}
                    arcLabelsSkipAngle={10}
                    arcLabelsTextColor="#ffffff"
                    valueFormat={value => `${(value || 0).toFixed(2)}`}
                    tooltip={({ datum }) => (
                      <div style={tooltipStyle}>
                        <strong>{datum.label}:</strong> {(datum.value || 0).toFixed(2)}%
                      </div>
                    )}
                  />
                </Box>
              </Box>

              {/* Sunburst 1 - Total Eligible Pieces Breakdown */}
              <Box sx={{ width: "100%", minWidth: 0 }}>
                <Typography variant="h5" color={colors.tealAccent[500]} mb={1}>
                  Total Pieces
                </Typography>
                
                  {/* Legend for Pieces Sunburst */}
                  <Box display="flex" flexDirection="column" gap={1} mb={2}>
                    {/* Inner Ring (Eligible) */}
                    <Box display="flex" alignItems="center" gap={1}>
                      <Typography variant="body2" sx={{ fontWeight: 'bold', width: 90 }}>
                        Inner Ring:
                      </Typography>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Typography variant="body2">Eligible</Typography>
                      </Box>
                    </Box>
                    
                    {/* Outer Rings (Constituents) */}
                    <Box display="flex" alignItems="center" gap={1}>
                      <Typography variant="body2" sx={{ fontWeight: 'bold', width: 90 }}>
                        Outer Rings:
                      </Typography>
                      <Box display="flex" gap={2} flexWrap="wrap">
                        <Box
                          onClick={() => setVisiblePiecesCategories(prev => ({ ...prev, batched: !prev.batched }))}
                          display="flex" 
                          alignItems="center" 
                          gap="5px"
                          sx={{ 
                            cursor: 'pointer',
                            opacity: visiblePiecesCategories.batched ? 1 : 0.4,
                            transition: 'all 0.2s',
                            '&:hover': {
                              transform: 'scale(1.05)',
                            },
                            border: visiblePiecesCategories.batched ? '1px solid transparent' : `1px solid ${colors.grey[300]}`,
                            borderRadius: '4px',
                            padding: '2px 6px',
                          }}
                        >
                          <Box 
                            width="12px" 
                            height="12px" 
                            borderRadius="50%" 
                            sx={{ backgroundColor: '#3b3b3b' }} 
                          />
                          <Typography variant="body2" color={colors.primary[800]}>
                            Batched
                          </Typography>
                        </Box>
                        <Box
                          onClick={() => setVisiblePiecesCategories(prev => ({ ...prev, rejected: !prev.rejected }))}
                          display="flex" 
                          alignItems="center" 
                          gap="5px"
                          sx={{ 
                            cursor: 'pointer',
                            opacity: visiblePiecesCategories.rejected ? 1 : 0.4,
                            transition: 'all 0.2s',
                            '&:hover': {
                              transform: 'scale(1.05)',
                            },
                            border: visiblePiecesCategories.rejected ? '1px solid transparent' : `1px solid ${colors.grey[300]}`,
                            borderRadius: '4px',
                            padding: '2px 6px',
                          }}
                        >
                          <Box 
                            width="12px" 
                            height="12px" 
                            borderRadius="50%" 
                            sx={{ backgroundColor: '#858585' }} 
                          />
                          <Typography variant="body2" color={colors.primary[800]}>
                            Rejected
                        </Typography>
                        </Box>
                      </Box>
                    </Box>
                      </Box>

                <Box height="300px" width="100%">
                  <ResponsiveSunburst
                    key={`pieces-sunburst-${selectedProgramId}-${visiblePiecesCategories.batched}-${visiblePiecesCategories.rejected}`}
                    data={(() => {
                      // Build flat list of outer ring segments
                      const outerRingSegments = [];
                      
                      recipeStats
                        .filter(r => visibleRecipes[r.recipe_name] !== false)
                        .forEach(r => {
                          const baseColor = recipeColorMap[r.recipe_name] || colors.grey[500];
                          const colorKey = Object.keys(colors).find(key => 
                            key.includes('Accent') && Object.values(colors[key]).includes(baseColor)
                          );
                          const colorFamily = colorKey ? colors[colorKey] : colors.tealAccent;
                          
                          const batchedValue = r.total_items_batched || 0;
                          const rejectedValue = r.total_items_rejected || 0;
                          const totalValue = batchedValue + rejectedValue;
                          
                          // Add an "inner ring" entry for this recipe
                          // Children ALWAYS present - hidden ones use background color for "gap" effect
                          const displayName = getDisplayName(r.recipe_name);
                          outerRingSegments.push({
                            name: displayName,
                            color: baseColor,
                            children: [
                              {
                                name: `${displayName}_Batched`,
                                // Use page background color if hidden to create "gap" effect (white/dark)
                                color: visiblePiecesCategories.batched ? colorFamily[400] : colors.primary[100],
                                value: batchedValue,
                                hidden: !visiblePiecesCategories.batched // Flag for label filtering
                              },
                              {
                                name: `${displayName}_Rejected`,
                                // Use page background color if hidden to create "gap" effect (white/dark)
                                color: visiblePiecesCategories.rejected ? colorFamily[300] : colors.primary[100],
                                value: rejectedValue,
                                hidden: !visiblePiecesCategories.rejected // Flag for label filtering
                              }
                            ]
                          });
                        });
                      
                      return {
                        name: "root",
                        children: outerRingSegments
                      };
                    })()}
                    margin={{ top: 20, right: 20, bottom: 20, left: 20 }}
                    id="name"
                    value="value"
                    cornerRadius={7}
                    borderWidth={3}
                    borderColor={colors.primary[100]}
                    colors={({ data }) => data.color}
                    childColor="noinherit"
                    inheritColorFromParent={false}
                    enableArcLabels={true}
                    arcLabelsSkipAngle={10}
                    arcLabel={d => {
                      // Show labels on BOTH inner ring (depth 1) and outer rings (depth 2)
                      // depth 0 = root (no label), depth 1 = recipes (inner ring), depth 2 = batched/rejected (outer rings)
                      if (d.depth === 0) {
                        return ''; // No label on root
                      }
                      if (d.data.hidden) {
                        return ''; // Don't show label for hidden categories
                      }
                      if (d.value === 0 || !d.value) {
                        return ''; // Don't show label for zero values
                      }
                      return d.value.toLocaleString(); // Show labels on both inner and outer rings
                    }}
                    arcLabelsTextColor="#ffffff"
                    theme={chartTheme}
                    tooltip={({ id, value, color }) => (
                      <div style={{ ...tooltipStyle, border: `1px solid ${color}` }}>
                        <strong style={{ color }}>{id}:</strong> {value.toLocaleString()} pieces
                      </div>
                    )}
                  />
                </Box>
              </Box>

              {/* Sunburst 2 - Total Eligible Weight Breakdown */}
              <Box sx={{ width: "100%", minWidth: 0 }}>
                <Typography variant="h5" color={colors.tealAccent[500]} mb={1}>
                  Total Weight (kg)
                        </Typography>
                
                  {/* Legend for Weight Sunburst */}
                  <Box display="flex" flexDirection="column" gap={1} mb={2}>
                    {/* Inner Ring (Eligible) */}
                    <Box display="flex" alignItems="center" gap={1}>
                      <Typography variant="body2" sx={{ fontWeight: 'bold', width: 90 }}>
                        Inner Ring:
                        </Typography>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Typography variant="body2">Eligible</Typography>
                      </Box>
                    </Box>
                    
                    {/* Outer Rings (Constituents) */}
                    <Box display="flex" alignItems="center" gap={1}>
                      <Typography variant="body2" sx={{ fontWeight: 'bold', width: 90 }}>
                        Outer Rings:
                      </Typography>
                      <Box display="flex" gap={2} flexWrap="wrap">
                        <Box
                          onClick={() => setVisibleWeightCategories(prev => ({ ...prev, batched: !prev.batched }))}
                          display="flex" 
                          alignItems="center" 
                          gap="5px"
                          sx={{ 
                            cursor: 'pointer',
                            opacity: visibleWeightCategories.batched ? 1 : 0.4,
                            transition: 'all 0.2s',
                            '&:hover': {
                              transform: 'scale(1.05)',
                            },
                            border: visibleWeightCategories.batched ? '1px solid transparent' : `1px solid ${colors.grey[300]}`,
                            borderRadius: '4px',
                            padding: '2px 6px',
                          }}
                        >
                          <Box 
                            width="12px" 
                            height="12px" 
                            borderRadius="50%" 
                            sx={{ backgroundColor: '#3b3b3b' }} 
                          />
                          <Typography variant="body2" color={colors.primary[800]}>
                            Batched
              </Typography>
                        </Box>
                        <Box
                          onClick={() => setVisibleWeightCategories(prev => ({ ...prev, rejected: !prev.rejected }))}
                          display="flex" 
                          alignItems="center" 
                          gap="5px"
                          sx={{ 
                            cursor: 'pointer',
                            opacity: visibleWeightCategories.rejected ? 1 : 0.4,
                            transition: 'all 0.2s',
                            '&:hover': {
                              transform: 'scale(1.05)',
                            },
                            border: visibleWeightCategories.rejected ? '1px solid transparent' : `1px solid ${colors.grey[300]}`,
                            borderRadius: '4px',
                            padding: '2px 6px',
                          }}
                        >
                          <Box 
                            width="12px" 
                            height="12px" 
                            borderRadius="50%" 
                            sx={{ backgroundColor: '#858585' }} 
                          />
                          <Typography variant="body2" color={colors.primary[800]}>
                            Rejected
                        </Typography>
                        </Box>
                        <Box
                          onClick={() => setVisibleWeightCategories(prev => ({ ...prev, giveaway: !prev.giveaway }))}
                          display="flex" 
                          alignItems="center" 
                          gap="5px"
                          sx={{ 
                            cursor: 'pointer',
                            opacity: visibleWeightCategories.giveaway ? 1 : 0.4,
                            transition: 'all 0.2s',
                            '&:hover': {
                              transform: 'scale(1.05)',
                            },
                            border: visibleWeightCategories.giveaway ? '1px solid transparent' : `1px solid ${colors.grey[300]}`,
                            borderRadius: '4px',
                            padding: '2px 6px',
                          }}
                        >
                          <Box 
                            width="12px" 
                            height="12px" 
                            borderRadius="50%" 
                            sx={{ backgroundColor: '#c2c2c2' }} 
                          />
                          <Typography variant="body2" color={colors.primary[800]}>
                            Giveaway
                          </Typography>
                        </Box>
                      </Box>
                    </Box>
                  </Box>
                
                <Box height="300px" width="100%">
                  <ResponsiveSunburst
                    key={`weight-sunburst-${selectedProgramId}-${visibleWeightCategories.batched}-${visibleWeightCategories.rejected}-${visibleWeightCategories.giveaway}`}
                    data={{
                      name: "root",
                      children: recipeStats
                        .filter(r => visibleRecipes[r.recipe_name] !== false)
                        .map(r => {
                          const baseColor = recipeColorMap[r.recipe_name] || colors.grey[500];
                          
                          const colorKey = Object.keys(colors).find(key => 
                            key.includes('Accent') && Object.values(colors[key]).includes(baseColor)
                          );
                          const colorFamily = colorKey ? colors[colorKey] : colors.tealAccent;
                          
                          const batchedValue = r.total_batched_weight_g || 0;
                          const rejectedValue = r.total_reject_weight_g || 0;
                          const giveawayValue = r.total_giveaway_weight_g || 0;
                          const displayName = getDisplayName(r.recipe_name);
                          
                          // Children ALWAYS present - hidden ones use background color for "gap" effect
                          const children = [
                            {
                              name: `${displayName}_Batched`,
                              // Use page background color if hidden to create "gap" effect (white/dark)
                              color: visibleWeightCategories.batched ? colorFamily[400] : colors.primary[100],
                              value: batchedValue,
                              hidden: !visibleWeightCategories.batched // Flag for label filtering
                            },
                            {
                              name: `${displayName}_Rejected`,
                              // Use page background color if hidden to create "gap" effect (white/dark)
                              color: visibleWeightCategories.rejected ? colorFamily[300] : colors.primary[100],
                              value: rejectedValue,
                              hidden: !visibleWeightCategories.rejected // Flag for label filtering
                            },
                            {
                              name: `${displayName}_Giveaway`,
                              // Use page background color if hidden to create "gap" effect (white/dark)
                              color: visibleWeightCategories.giveaway ? colorFamily[200] : colors.primary[100],
                              value: giveawayValue,
                              hidden: !visibleWeightCategories.giveaway // Flag for label filtering
                            }
                          ];
                          
                          return {
                            name: displayName,
                            color: baseColor,
                            children
                          };
                        })
                    }}
                    margin={{ top: 20, right: 20, bottom: 20, left: 20 }}
                    id="name"
                    value="value"
                    cornerRadius={7}
                    borderWidth={3}
                    borderColor={colors.primary[100]}
                    colors={({ data }) => data.color}
                    childColor="noinherit"
                    inheritColorFromParent={false}
                    enableArcLabels={true}
                    arcLabelsSkipAngle={10}
                    arcLabel={d => {
                      // Show labels on BOTH inner ring (depth 1) and outer rings (depth 2)
                      // depth 0 = root (no label), depth 1 = recipes (inner ring), depth 2 = batched/rejected/giveaway (outer rings)
                      if (d.depth === 0) {
                        return ''; // No label on root
                      }
                      if (d.data.hidden) {
                        return ''; // Don't show label for hidden categories
                      }
                      if (d.value === 0 || !d.value) {
                        return ''; // Don't show label for zero values
                      }
                      return (d.value / 1000).toFixed(1); // Show labels on both inner and outer rings, in kg
                    }}
                    arcLabelsTextColor="#ffffff"
                    theme={chartTheme}
                    tooltip={({ id, value, color }) => (
                      <div style={{ ...tooltipStyle, border: `1px solid ${color}` }}>
                        <strong style={{ color }}>{id}:</strong> {(value / 1000).toFixed(2)} kg
                      </div>
                    )}
                  />
                </Box>
              </Box>
            </Box>
          </Box>
        )}

        {/* Recipe History Section */}
        {selectedProgramId && historyData && Object.keys(historyData.batches || {}).length > 0 && (() => {
          // Transform InfluxDB data for Nivo Line charts
          // historyData.batches: { recipeName: [{t: timestamp_ms, v: value}, ...], ... }
          // historyData.weight: { recipeName: [{t: timestamp_ms, v: value}, ...], ... }
          
          const transformToLineData = (dataByRecipe) => {
            return Object.entries(dataByRecipe)
              .filter(([recipeName]) => visibleRecipes[recipeName] !== false)
              .map(([recipeName, points]) => ({
                id: recipeName,
                color: recipeColorMap[recipeName] || colors.grey[500],
                data: points.map(p => ({
                  x: new Date(p.t), // Convert timestamp to Date object
                  y: p.v
                }))
              }));
          };

          const batchesLineData = transformToLineData(historyData.batches || {});
          const piecesLineData = transformToLineData(historyData.pieces || {});
          const weightLineData = transformToLineData(historyData.weight || {});

          return (
            <Box mt={6}>
              <Typography variant="h4" fontWeight="bold" color={colors.tealAccent[500]} mb={3}>
                History
              </Typography>
              
              {/* All Three Charts on One Row */}
              <Box
                display="grid"
                gridTemplateColumns="1fr 1fr 1fr"
                gap={3}
              >
                {/* Batches Processed Chart */}
                <Box sx={{ width: "100%", minWidth: 0 }}>
                  <Typography variant="h5" color={colors.tealAccent[500]} mb={1}>
                    Batches per Minute
                                </Typography>
                  <Box height="300px" width="100%">
                    <ResponsiveLine
                      data={batchesLineData}
                      theme={chartTheme}
                      colors={{ datum: 'color' }}
                      margin={{ top: 20, right: 20, bottom: 50, left: 50 }}
                      xScale={{
                        type: 'time',
                        format: 'native',
                        useUTC: false
                      }}
                      xFormat="time:%Y-%m-%d %H:%M"
                      yScale={{
                        type: 'linear',
                        min: 0,
                        max: 'auto'
                      }}
                      axisBottom={{
                        format: (value) => value.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                        tickRotation: -45,
                        tickValues: 5,
                        legend: '',
                        legendOffset: 0,
                        legendPosition: 'middle'
                      }}
                      axisLeft={{
                        legend: '',
                        legendOffset: 0,
                        legendPosition: 'middle'
                      }}
                      enablePoints={false}
                      enableGridX={false}
                      enableGridY={true}
                      enableArea={true}
                      curve="monotoneX"
                      lineWidth={2}
                      useMesh={true}
                      legends={[]}
                    />
                  </Box>
                </Box>
                {/* Pieces Processed Chart */}
                <Box sx={{ width: "100%", minWidth: 0 }}>
                  <Typography variant="h5" color={colors.tealAccent[500]} mb={1}>
                    Pieces per Minute
                                </Typography>
                  <Box height="300px" width="100%">
                    <ResponsiveLine
                      data={piecesLineData}
                      theme={chartTheme}
                      colors={{ datum: 'color' }}
                      margin={{ top: 20, right: 20, bottom: 50, left: 50 }}
                      xScale={{
                        type: 'time',
                        format: 'native',
                        useUTC: false
                      }}
                      xFormat="time:%Y-%m-%d %H:%M"
                      yScale={{
                        type: 'linear',
                        min: 0,
                        max: 'auto'
                      }}
                      axisBottom={{
                        format: (value) => value.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                        tickRotation: -45,
                        tickValues: 5,
                        legend: '',
                        legendOffset: 0,
                        legendPosition: 'middle'
                      }}
                      axisLeft={{
                        legend: '',
                        legendOffset: 0,
                        legendPosition: 'middle'
                      }}
                      enablePoints={false}
                      enableGridX={false}
                      enableGridY={true}
                      enableArea={true}
                      curve="monotoneX"
                      lineWidth={2}
                      useMesh={true}
                      legends={[]}
                    />
                  </Box>
                </Box>

                {/* Weight Processed Chart */}
                <Box sx={{ width: "100%", minWidth: 0 }}>
                  <Typography variant="h5" color={colors.tealAccent[500]} mb={1}>
                    Weight per Minute (kg)
                                </Typography>
                  <Box height="300px" width="100%">
                    <ResponsiveLine
                      data={weightLineData}
                      theme={chartTheme}
                      colors={{ datum: 'color' }}
                      margin={{ top: 20, right: 20, bottom: 50, left: 50 }}
                      xScale={{
                        type: 'time',
                        format: 'native',
                        useUTC: false
                      }}
                      xFormat="time:%Y-%m-%d %H:%M"
                      yScale={{
                        type: 'linear',
                        min: 0,
                        max: 'auto'
                      }}
                      axisBottom={{
                        format: (value) => value.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                        tickRotation: -45,
                        tickValues: 5,
                        legend: '',
                        legendOffset: 0,
                        legendPosition: 'middle'
                      }}
                      axisLeft={{
                        legend: '',
                        legendOffset: 0,
                        legendPosition: 'middle',
                        format: v => (v / 1000).toFixed(1) // Convert grams to kg
                      }}
                      enablePoints={false}
                      enableGridX={false}
                      enableGridY={true}
                      enableArea={true}
                      curve="monotoneX"
                      lineWidth={2}
                      useMesh={true}
                      legends={[]}
                      tooltip={({ point }) => (
                        <Box sx={{ ...tooltipStyle, border: `1px solid ${colors.grey[700]}` }}>
                          <Typography variant="body2" color={tooltipStyle.color}>
                            <strong>{point.serieId}</strong>
                          </Typography>
                          <Typography variant="body2" color={tooltipStyle.color}>
                            Time: {new Date(point.data.x).toLocaleTimeString()}
                          </Typography>
                          <Typography variant="body2" color={tooltipStyle.color}>
                            Weight: {(point.data.y / 1000).toFixed(2)} kg
                                </Typography>
                              </Box>
                              )}
                    />
                            </Box>
                      </Box>
              </Box>

              {/* Piece Weight Distribution Scatter Plot - Full Width Row */}
              {pieceWeights && pieceWeights.scatterPoints && pieceWeights.scatterPoints.length > 0 && (() => {
                // Transform scatter points for Nivo
                const scatterData = [{
                  id: "pieces",
                  data: pieceWeights.scatterPoints.map(p => ({
                    x: p.t,
                    y: p.w
                  }))
                }];

                // Transform trend line for Nivo line chart
                const trendData = pieceWeights.trendLine && pieceWeights.trendLine.length > 0 ? [{
                  id: "trend",
                  data: pieceWeights.trendLine.map(p => ({
                    x: p.t,
                    y: p.w
                  }))
                }] : [];

                // Calculate shared time and weight domains
                const allTimes = [...pieceWeights.scatterPoints.map(p => p.t), ...pieceWeights.trendLine.map(p => p.t)];
                const allWeights = [...pieceWeights.scatterPoints.map(p => p.w), ...pieceWeights.trendLine.map(p => p.w)];
                const domainStart = allTimes.length > 0 ? Math.min(...allTimes) : 0;
                const domainEnd = allTimes.length > 0 ? Math.max(...allTimes) : 1;
                const yMin = allWeights.length > 0 ? Math.min(...allWeights) : 0;
                const yMax = allWeights.length > 0 ? Math.max(...allWeights) : 1;

                return (
                  <Box sx={{ width: "100%", minWidth: 0, mt: 3 }}>
                    <Typography variant="h5" color={colors.tealAccent[500]} mb={1}>
                      Piece Weight Distribution
                    </Typography>
                    <Box height="300px" width="100%" position="relative">
                      {/* Trend Line - using ResponsiveLine with only the trend data */}
                      <Box position="absolute" top={0} left={0} right={0} bottom={0} sx={{ pointerEvents: 'none' }}>
                        <ResponsiveLine
                          data={trendData}
                          theme={chartTheme}
                          colors={() => colors.redAccent[500]}
                          margin={{ top: 20, right: 20, bottom: 50, left: 50 }}
                          xScale={{
                            type: 'linear',
                            min: domainStart,
                            max: domainEnd
                          }}
                          yScale={{
                            type: 'linear',
                            min: yMin,
                            max: yMax
                          }}
                          xFormat={(value) => new Date(value).toLocaleTimeString()}
                          axisBottom={null}
                          axisLeft={null}
                          enablePoints={false}
                          enableGridX={false}
                          enableGridY={false}
                          curve="monotoneX"
                          lineWidth={2}
                          useMesh={false}
                          isInteractive={false}
                          animate={false}
                        />
            </Box>

                      {/* Scatter Points - using ResponsiveLine with only scatter data, no line */}
                      <Box position="absolute" top={0} left={0} right={0} bottom={0}>
                        <ResponsiveLine
                          data={scatterData}
                          theme={chartTheme}
                          colors={() => colors.tealAccent[500]}
                          margin={{ top: 20, right: 20, bottom: 50, left: 50 }}
                          xScale={{
                            type: 'linear',
                            min: domainStart,
                            max: domainEnd
                          }}
                          yScale={{
                            type: 'linear',
                            min: yMin,
                            max: yMax
                          }}
                          xFormat={(value) => new Date(value).toLocaleTimeString()}
                          axisBottom={{
                            format: (value) => new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                            tickRotation: -45,
                            legend: '',
                            legendOffset: 0,
                            legendPosition: 'middle'
                          }}
                          axisLeft={{
                            legend: 'Weight (g)',
                            legendOffset: -40,
                            legendPosition: 'middle'
                          }}
                          enablePoints={true}
                          pointSize={4}
                          pointColor={colors.tealAccent[500]}
                          pointBorderWidth={0}
                          enableGridX={false}
                          enableGridY={true}
                          curve="linear"
                          lineWidth={0}
                          useMesh={true}
                          animate={false}
                          tooltip={({ point }) => {
                            if (!point || !point.data || point.data.x === undefined || point.data.y === undefined) return null;
                            return (
                              <Box sx={{ ...tooltipStyle, border: `1px solid ${colors.grey[700]}` }}>
                                <Typography variant="body2" color={tooltipStyle.color}>
                                  Time: {new Date(point.data.x).toLocaleTimeString()}
                                </Typography>
                                <Typography variant="body2" color={tooltipStyle.color}>
                                  Weight: {point.data.y.toFixed(1)} g
                                </Typography>
        </Box>
                            );
                          }}
                        />
      </Box>
                    </Box>
                  </Box>
                );
              })()}
            </Box>
          );
        })()}

        {/* Gate Dwell Time Section */}
        {selectedProgramId && gateDwellData && gateDwellData.length > 0 && (() => {
          // Filter gate data based on visible recipes
          const filteredGateDwellData = gateDwellData.filter(({ recipe_name }) => 
            visibleRecipes[recipe_name] !== false
          );

          // Prepare data for both charts
          // Use batch_count from backend (actual count from batch_completions)
          // Fallback to dwell_times.length + 1 if batch_count not available
          const batchesPerGate = filteredGateDwellData.map(({ gate, recipe_name, dwell_times, batch_count }) => ({
            gate: gate.toString(),
            gateNumber: gate,
            batches: batch_count !== undefined ? batch_count : (dwell_times.length > 0 ? dwell_times.length + 1 : 0),
            recipeColor: recipeColorMap[recipe_name] || colors.grey[500]
          }));

          // Prepare boxplot data - Nivo expects raw values array
          // Create a map of gate to recipe for coloring
          const gateToRecipe = {};
          filteredGateDwellData.forEach(({ gate, recipe_name }) => {
            gateToRecipe[gate.toString()] = recipe_name;
          });

          const boxPlotData = filteredGateDwellData.flatMap(({ gate, recipe_name, dwell_times }) => {
            // Return one data point per dwell time value
            return dwell_times.map(value => ({
              group: gate.toString(),
              value: value
            }));
          });

          return (
            <Box mt={6}>
              <Typography variant="h4" fontWeight="bold" color={colors.tealAccent[500]} mb={3}>
                Gate Stats
              </Typography>
              
              <Box
                display="grid"
                gridTemplateColumns="1fr 2fr"
                gap={5}
                sx={{
                  width: "100%",
                  minWidth: 0,
                }}
              >
                {/* Bar Chart - Batches per Gate */}
                <Box sx={{ width: "100%", minWidth: 0 }}>
                  <Typography variant="h5" color={colors.tealAccent[500]} mb={1}>
                    Batches per Gate
                  </Typography>
                  <Box height="400px" width="100%">
                    <ResponsiveBar
                      data={batchesPerGate}
                      keys={['batches']}
                      indexBy="gate"
                      colors={({ data }) => data.recipeColor}
                      valueFormat={value => value.toLocaleString()}
                      theme={chartTheme}
                      padding={0.3}
                      margin={{ top: 20, right: 20, bottom: 60, left: 60 }}
                      valueScale={{ type: 'linear' }}
                      indexScale={{ type: 'band', round: true }}
                      borderColor={{ from: 'color', modifiers: [['darker', 1.6]] }}
                      axisTop={null}
                      axisRight={null}
                      axisBottom={{
                        tickSize: 5,
                        tickPadding: 5,
                        tickRotation: 0,
                        legend: 'Gate',
                        legendPosition: 'middle',
                        legendOffset: 45,
                      }}
                      axisLeft={{
                        tickSize: 5,
                        tickPadding: 5,
                        tickRotation: 0,
                        legend: 'Batches',
                        legendPosition: 'middle',
                        legendOffset: -50,
                      }}
                      labelSkipWidth={12}
                      labelSkipHeight={12}
                      enableGridY={false}
                      labelTextColor="#ffffff"
                    />
                  </Box>
                </Box>

                {/* BoxPlot Chart - Dwell Time Distribution */}
                <Box sx={{ width: "100%", minWidth: 0 }}>
                  <Typography variant="h5" color={colors.tealAccent[500]} mb={1}>
                    Batch Completion Time
                  </Typography>
                  <Box height="400px" width="100%">
                    <ResponsiveBoxPlot
                      data={boxPlotData}
                      margin={{ top: 20, right: 20, bottom: 60, left: 80 }}
                      minValue={0}
                      maxValue="auto"
                      padding={0.7}
                      innerPadding={0}
                      enableGridX={false}
                      enableGridY={true}
                      axisTop={null}
                      axisRight={null}
                      axisBottom={{
                        tickSize: 5,
                        tickPadding: 5,
                        tickRotation: 0,
                        legend: 'Gate',
                        legendPosition: 'middle',
                        legendOffset: 45
                      }}
                      axisLeft={{
                        tickSize: 5,
                        tickPadding: 5,
                        tickRotation: 0,
                        legend: 'Time (seconds)',
                        legendPosition: 'middle',
                        legendOffset: -65,
                        format: value => `${value}s`
                      }}
                      colors={(boxData) => {
                        // Get recipe name from gate number
                        const groupName = boxData.id || boxData.group;
                        const recipeName = gateToRecipe[groupName];
                        return recipeColorMap[recipeName] || colors.grey[500];
                      }}
                      borderRadius={2}
                      borderWidth={2}
                      borderColor={{
                        from: 'color',
                        modifiers: [['darker', 0.3]]
                      }}
                      medianWidth={3}
                      medianColor={{
                        from: 'color',
                        modifiers: [['darker', 1]]
                      }}
                      whiskerEndSize={0.4}
                      whiskerColor={{
                        from: 'color',
                        modifiers: [['darker', 0.3]]
                      }}
                      motionConfig="gentle"
                      theme={chartTheme}
                      enableLabel={false}
                    />
                  </Box>
                </Box>
              </Box>
            </Box>
          );
        })()}
      </Box>
    </Box>
  );
};

export default Stats;
