import React, { useState, useEffect } from "react";
import {
  Box,
  Button,
  TextField,
  Typography,
  useTheme,
  FormControl,
  FormLabel,
  RadioGroup,
  FormControlLabel,
  Radio,
  Select,
  MenuItem,
  InputLabel,
  Checkbox,
  Autocomplete,
  Paper,
} from "@mui/material";
import Header from "../../components/Header";
import MachineControls from "../../components/MachineControls";
import { tokens } from "../../theme";
import { useAppContext } from "../../context/AppContext";
import api from "../../services/api";
import useMachineState from "../../hooks/useMachineState";
import { getSyncedAnimationStyle } from "../../utils/animationSync";

const Setup = () => {
  const theme = useTheme();
  const colors = tokens(theme.palette.mode);
  const context = useAppContext();

  // Color palette for recipes (same as Stats page)
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

  // Recipe database state
  const [recipes, setRecipes] = useState([]);
  const [loadingRecipes, setLoadingRecipes] = useState(true);

  // Mode state
  const [mode, setMode] = useState("preset"); // preset or manual

  // Preset mode state
  const [selectedRecipe, setSelectedRecipe] = useState(null);
  const [presetGates, setPresetGates] = useState([]);

  // Manual mode state
  const [manualPieceMin, setManualPieceMin] = useState("");
  const [manualPieceMax, setManualPieceMax] = useState("");
  const [manualBatchWeightEnabled, setManualBatchWeightEnabled] = useState(false);
  const [manualBatchMin, setManualBatchMin] = useState("");
  const [manualBatchMax, setManualBatchMax] = useState("");
  const [manualPieceCountEnabled, setManualPieceCountEnabled] = useState(false);
  const [manualPieceCountType, setManualPieceCountType] = useState("min"); // min, max, exact
  const [manualPieceCount, setManualPieceCount] = useState("");
  const [manualGates, setManualGates] = useState([]);

  // Save recipe state

  // Assigned recipes from context (persisted and shared across components)
  const { assignedRecipes, setAssignedRecipes } = context;
  
  // Active recipes state (synced from backend via SSE, NOT persisted locally)
  // Backend machine_state is the single source of truth
  const [activeRecipes, setActiveRecipes] = useState([]);
  
  const [addError, setAddError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  // Edit state for assigned recipes
  const [editingAssignedIndex, setEditingAssignedIndex] = useState(null);
  const [editAssignedData, setEditAssignedData] = useState(null);
  const [editAssignedError, setEditAssignedError] = useState("");
  const [editAssignedSuccess, setEditAssignedSuccess] = useState("");

  // Edit state for active recipes
  const [editingActiveIndex, setEditingActiveIndex] = useState(null);
  const [editActiveData, setEditActiveData] = useState(null);
  const [editActiveError, setEditActiveError] = useState("");
  const [editActiveSuccess, setEditActiveSuccess] = useState("");

  // Machine control state
  // Machine state from backend via SSE
  const {
    state: backendMachineState,
    activeRecipes: backendActiveRecipes,
    currentProgramId: backendProgramId,
    isConnected: machineConnected,
    transitioningGates: backendTransitioningGates,
    completedTransitionGates: backendCompletedTransitionGates,
  } = useMachineState();
  
  // Track transitioning gates (for visual indicator and edit permissions)
  const [transitioningGates, setTransitioningGates] = useState([]);
  // Track completed transition gates (gates that finished but other transitions still pending - LOCKED)
  const [completedTransitionGates, setCompletedTransitionGates] = useState([]);
  
  // Sync transitioning gates from backend
  useEffect(() => {
    if (backendTransitioningGates !== undefined) {
      setTransitioningGates(backendTransitioningGates);
    }
  }, [backendTransitioningGates]);
  
  // Sync completed transition gates from backend
  useEffect(() => {
    if (backendCompletedTransitionGates !== undefined) {
      setCompletedTransitionGates(backendCompletedTransitionGates);
    }
  }, [backendCompletedTransitionGates]);
  
  // Local machine state (synced with backend)
  const [machineState, setMachineState] = useState("idle");

  // Sync backend machine state with local state
  useEffect(() => {
    if (backendMachineState) {
      setMachineState(backendMachineState);
    }
  }, [backendMachineState]);

  // Sync active recipes from backend (SSE is the single source of truth)
  useEffect(() => {
    if (backendActiveRecipes !== undefined) {
      setActiveRecipes(backendActiveRecipes);
    }
  }, [backendActiveRecipes]);

  // Load recipes from database and clean up old localStorage data
  useEffect(() => {
    // Remove old activeRecipes from localStorage (backend is now source of truth)
    localStorage.removeItem('activeRecipes');
    loadRecipes();
  }, []);

  // NOTE: assignedRecipes persistence is handled by AppContext
  // NOTE: activeRecipes is NOT persisted to localStorage
  // Backend machine_state is the single source of truth for active recipes
  // Only assignedRecipes is persisted locally (user selections before activation)

  const loadRecipes = async () => {
    try {
      setLoadingRecipes(true);
      const response = await api.get("/settings/recipes");
      setRecipes(response.data.recipes || []);
    } catch (error) {
      console.error("Failed to load recipes:", error);
      setRecipes([]);
    } finally {
      setLoadingRecipes(false);
    }
  };

  // Parse recipe name to get parameters
  const parseRecipeName = (name) => {
    // Format: R_pieceMin_pieceMax_batchMin_batchMax_countType_countVal
    // Example: R_120_160_0_0_exact_35, R_200_250_4875_9999_NA_0
    const parts = name.split("_");
    if (parts.length !== 7 || parts[0] !== "R") return null;

    const [, pieceMin, pieceMax, batchMin, batchMax, countType, countVal] = parts;
    return {
      pieceMinWeight: parseInt(pieceMin),
      pieceMaxWeight: parseInt(pieceMax),
      batchMinWeight: parseInt(batchMin) || null,
      batchMaxWeight: parseInt(batchMax) || null,
      countType: countType === "NA" ? null : countType,
      countValue: parseInt(countVal) || null,
    };
  };

  // Generate recipe name from parameters
  const generateRecipeName = (params) => {
    const {
      pieceMinWeight,
      pieceMaxWeight,
      batchMinWeight,
      batchMaxWeight,
      countType,
      countValue,
    } = params;

    const bMin = batchMinWeight || 0;
    const bMax = batchMaxWeight || 0;
    const cType = countType || "NA";
    const cVal = countValue || 0;

    return `R_${pieceMinWeight}_${pieceMaxWeight}_${bMin}_${bMax}_${cType}_${cVal}`;
  };

  // Handle mode change
  const handleModeChange = (e) => {
    setMode(e.target.value);
    setAddError("");
    resetPresetForm();
    resetManualForm();
  };

  // Reset forms
  const resetPresetForm = () => {
    setSelectedRecipe(null);
    setPresetGates([]);
  };

  const resetManualForm = () => {
    setManualPieceMin("");
    setManualPieceMax("");
    setManualBatchWeightEnabled(false);
    setManualBatchMin("");
    setManualBatchMax("");
    setManualPieceCountEnabled(false);
    setManualPieceCountType("min");
    setManualPieceCount("");
    setManualGates([]);
  };

  // Toggle gate selection
  const togglePresetGate = (gate) => {
    setPresetGates((prev) =>
      prev.includes(gate) ? prev.filter((g) => g !== gate) : [...prev, gate]
    );
  };

  const toggleManualGate = (gate) => {
    setManualGates((prev) =>
      prev.includes(gate) ? prev.filter((g) => g !== gate) : [...prev, gate]
    );
  };

  // Get used gates (from both assigned and active recipes)
  const usedGates = [
    ...assignedRecipes.flatMap((r) => r.gates || []),
    ...activeRecipes.flatMap((r) => r.gates || [])
  ];

  // Add preset recipe
  const handleAddPreset = () => {
    if (!selectedRecipe || presetGates.length === 0) {
      setAddError("Please select a recipe and assign at least one gate");
      return;
    }

    // Check if recipe already assigned or active
    const isAlreadyAssigned = assignedRecipes.some(
      (assigned) => assigned.recipeName === selectedRecipe.name
    );
    const isAlreadyActive = activeRecipes.some(
      (active) => active.recipeName === selectedRecipe.name
    );

    if (isAlreadyAssigned) {
      setAddError(
        `Recipe "${selectedRecipe.name}" is already assigned. Please edit the existing recipe instead.`
      );
      setTimeout(() => setAddError(""), 5000);
      return;
    }

    if (isAlreadyActive) {
      setAddError(
        `Recipe "${selectedRecipe.name}" is currently active. Please remove it from Active Recipes first.`
      );
      setTimeout(() => setAddError(""), 5000);
      return;
    }

    const newAssignment = {
      type: "preset",
      recipeId: selectedRecipe.id,
      recipeName: selectedRecipe.name,
      params: parseRecipeName(selectedRecipe.name),
      gates: presetGates,
    };

    setAssignedRecipes([...assignedRecipes, newAssignment]);
    resetPresetForm();
    setAddError("");
  };

  // Add manual recipe
  const handleAddManual = async () => {
    // Validate required fields
    if (!manualPieceMin || !manualPieceMax) {
      setAddError("Piece weight bounds are required");
      return;
    }

    if (manualGates.length === 0) {
      setAddError("Please assign at least one gate");
      return;
    }

    if (!manualBatchWeightEnabled && !manualPieceCountEnabled) {
      setAddError("Please enable at least one constraint (batch weight or piece count)");
      return;
    }

    if (manualBatchWeightEnabled && (!manualBatchMin || !manualBatchMax)) {
      setAddError("Please fill in batch weight bounds or disable the constraint");
      return;
    }

    if (manualPieceCountEnabled && !manualPieceCount) {
      setAddError("Please fill in piece count or disable the constraint");
      return;
    }

    // Build recipe parameters
    const params = {
      pieceMinWeight: parseInt(manualPieceMin),
      pieceMaxWeight: parseInt(manualPieceMax),
      batchMinWeight: manualBatchWeightEnabled ? parseInt(manualBatchMin) : null,
      batchMaxWeight: manualBatchWeightEnabled ? parseInt(manualBatchMax) : null,
      countType: manualPieceCountEnabled ? manualPieceCountType : null,
      countValue: manualPieceCountEnabled ? parseInt(manualPieceCount) : null,
    };

    const recipeName = generateRecipeName(params);

    // Check if recipe already assigned or active
    const isAlreadyAssigned = assignedRecipes.some(
      (assigned) => assigned.recipeName === recipeName
    );
    const isAlreadyActive = activeRecipes.some(
      (active) => active.recipeName === recipeName
    );

    if (isAlreadyAssigned) {
      setAddError(
        `Recipe "${recipeName}" is already assigned. Please edit the existing recipe instead.`
      );
      setTimeout(() => setAddError(""), 5000);
      return;
    }

    if (isAlreadyActive) {
      setAddError(
        `Recipe "${recipeName}" is currently active. Please remove it from Active Recipes first.`
      );
      setTimeout(() => setAddError(""), 5000);
      return;
    }

    // Check if recipe already exists in database
    const existingRecipe = recipes.find((r) => r.name === recipeName);
    console.log(`[Setup] Checking recipe "${recipeName}" - exists in DB: ${!!existingRecipe}, recipes loaded: ${recipes.length}`);

    // If recipe doesn't exist, save it to database first
    let recipeId = existingRecipe?.id || null;
    if (!existingRecipe) {
      console.log(`[Setup] Recipe doesn't exist, saving to database...`);
      try {
        const response = await api.post("/settings/recipes", {
          name: recipeName,
          piece_min_weight_g: params.pieceMinWeight,
          piece_max_weight_g: params.pieceMaxWeight,
          batch_min_weight_g: params.batchMinWeight,
          batch_max_weight_g: params.batchMaxWeight,
          min_pieces_per_batch:
            params.countType === "min" || params.countType === "exact"
              ? params.countValue
              : null,
          max_pieces_per_batch:
            params.countType === "max" || params.countType === "exact"
              ? params.countValue
              : null,
        });
        
        // Get the new recipe ID from response (API returns { recipe: {...} })
        recipeId = response.data?.recipe?.id || null;
        
        // Reload recipes to include the new one
        await loadRecipes();
        
        console.log(`[Setup] Auto-saved new recipe: ${recipeName} (ID: ${recipeId})`);
      } catch (error) {
        console.error("[Setup] Failed to auto-save recipe:", error);
        console.error("[Setup] Error details:", error.response?.data || error.message);
        setAddError(`Failed to save recipe: ${error.response?.data?.message || error.message}`);
        return;
      }
    }

    const newAssignment = {
      type: "manual",
      recipeId: recipeId,
      recipeName,
      params,
      gates: manualGates,
    };

    // Add to assigned recipes
    setAssignedRecipes([...assignedRecipes, newAssignment]);
    resetManualForm();
    setAddError("");
  };


  // Remove assigned recipe
  const handleRemoveAssignment = (index) => {
    setAssignedRecipes(assignedRecipes.filter((_, i) => i !== index));
    setEditingAssignedIndex(null);
    setEditAssignedData(null);
  };

  // Start editing assigned recipe
  const handleEditAssigned = (index) => {
    const recipe = assignedRecipes[index];
    setEditingAssignedIndex(index);
    setEditAssignedData({
      pieceMinWeight: recipe.params.pieceMinWeight || '',
      pieceMaxWeight: recipe.params.pieceMaxWeight || '',
      batchMinWeight: recipe.params.batchMinWeight || '',
      batchMaxWeight: recipe.params.batchMaxWeight || '',
      countType: recipe.params.countType || 'min',
      countValue: recipe.params.countValue || '',
      gates: recipe.gates
    });
  };

  // Cancel editing assigned recipe
  const handleCancelEditAssigned = () => {
    setEditingAssignedIndex(null);
    setEditAssignedData(null);
    setEditAssignedError("");
  };

  // Accept editing assigned recipe
  const handleAcceptEditAssigned = () => {
    // Validate at least one gate is selected
    if (!editAssignedData.gates || editAssignedData.gates.length === 0) {
      setEditAssignedError("Please select at least one gate.");
      setTimeout(() => setEditAssignedError(""), 5000);
      return;
    }

    const newParams = {
      pieceMinWeight: parseInt(editAssignedData.pieceMinWeight),
      pieceMaxWeight: parseInt(editAssignedData.pieceMaxWeight),
      batchMinWeight: editAssignedData.batchMinWeight ? parseInt(editAssignedData.batchMinWeight) : null,
      batchMaxWeight: editAssignedData.batchMaxWeight ? parseInt(editAssignedData.batchMaxWeight) : null,
      countType: editAssignedData.countType === 'NA' ? null : editAssignedData.countType,
      countValue: editAssignedData.countType === 'NA' ? null : (editAssignedData.countValue ? parseInt(editAssignedData.countValue) : null),
    };

    const newRecipeName = generateRecipeName(newParams);

    // Check if this recipe already exists (excluding current recipe)
    const existsInAssigned = assignedRecipes.some(
      (r, i) => r.recipeName === newRecipeName && i !== editingAssignedIndex
    );
    const existsInActive = activeRecipes.some(
      (r) => r.recipeName === newRecipeName
    );

    if (existsInAssigned || existsInActive) {
      setEditAssignedError(`Recipe "${newRecipeName}" already exists in ${existsInAssigned ? 'Assigned' : 'Active'} Recipes.`);
      setTimeout(() => setEditAssignedError(""), 5000);
      return;
    }

    // Update the recipe
    // Clear recipeId since the recipe name changed - backend will resolve the correct ID
    const oldRecipe = assignedRecipes[editingAssignedIndex];
    const recipeNameChanged = oldRecipe.recipeName !== newRecipeName;
    
    const updatedRecipes = [...assignedRecipes];
    updatedRecipes[editingAssignedIndex] = {
      ...updatedRecipes[editingAssignedIndex],
      recipeId: recipeNameChanged ? null : oldRecipe.recipeId, // Clear if name changed
      recipeName: newRecipeName,
      params: newParams,
      gates: editAssignedData.gates
    };
    
    if (recipeNameChanged) {
      console.log(`[Setup] Assigned recipe name changed: ${oldRecipe.recipeName} → ${newRecipeName}, clearing recipeId`);
    }

    setAssignedRecipes(updatedRecipes);
    setEditingAssignedIndex(null);
    setEditAssignedData(null);
    setEditAssignedError("");
  };

  // Send programs to machine (move from assigned to active)
  const handleSendPrograms = async () => {
    try {
      console.log("[Setup] Activating recipes:", assignedRecipes);
      
      // Move assigned recipes to active recipes
      const newActiveRecipes = [...activeRecipes, ...assignedRecipes];
      setActiveRecipes(newActiveRecipes);
      setAssignedRecipes([]);
      
      // Sync to backend
      await api.post('/machine/recipes', { recipes: newActiveRecipes });
      console.log("[Setup] Active recipes synced to backend");
    } catch (error) {
      console.error("[Setup] Failed to activate recipes:", error);
      setAddError("Failed to activate recipes");
    }
  };

  // Machine control handlers (now in shared MachineControls component)
  // Sync active recipes to backend
  const syncActiveRecipesToBackend = async () => {
    try {
      await api.post('/machine/recipes', { recipes: activeRecipes });
      console.log('[Setup] Synced active recipes to backend');
    } catch (error) {
      console.error('[Setup] Failed to sync active recipes:', error);
    }
  };

  // Remove active recipe
  const handleRemoveActiveRecipe = async (index) => {
    // Get updated recipes without the removed one
    const updatedRecipes = activeRecipes.filter((_, i) => i !== index);
    
    // Push updated recipes to backend (so it knows about the removal)
    // This will trigger a program change when Start is pressed (like edit does)
    try {
      await api.post('/machine/recipes', { recipes: updatedRecipes });
      console.log('[Setup] Updated active recipes on backend after removal');
    } catch (error) {
      console.error('[Setup] Failed to update active recipes on backend:', error);
      // Still update local state even if backend fails
    }
    
    setActiveRecipes(updatedRecipes);
    setEditingActiveIndex(null);
    setEditActiveData(null);
  };

  // Start editing active recipe
  const handleEditActive = (index) => {
    const recipe = activeRecipes[index];
    setEditingActiveIndex(index);
    setEditActiveData({
      pieceMinWeight: recipe.params.pieceMinWeight || '',
      pieceMaxWeight: recipe.params.pieceMaxWeight || '',
      batchMinWeight: recipe.params.batchMinWeight || '',
      batchMaxWeight: recipe.params.batchMaxWeight || '',
      countType: recipe.params.countType || 'min',
      countValue: recipe.params.countValue || '',
      gates: recipe.gates
    });
  };

  // Cancel editing active recipe
  const handleCancelEditActive = () => {
    setEditingActiveIndex(null);
    setEditActiveData(null);
    setEditActiveError("");
  };

  // Accept editing active recipe
  const handleAcceptEditActive = async () => {
    // Validate at least one gate is selected
    if (!editActiveData.gates || editActiveData.gates.length === 0) {
      setEditActiveError("Please select at least one gate.");
      setTimeout(() => setEditActiveError(""), 5000);
      return;
    }

    const newParams = {
      pieceMinWeight: parseInt(editActiveData.pieceMinWeight),
      pieceMaxWeight: parseInt(editActiveData.pieceMaxWeight),
      batchMinWeight: editActiveData.batchMinWeight ? parseInt(editActiveData.batchMinWeight) : null,
      batchMaxWeight: editActiveData.batchMaxWeight ? parseInt(editActiveData.batchMaxWeight) : null,
      countType: editActiveData.countType === 'NA' ? null : editActiveData.countType,
      countValue: editActiveData.countType === 'NA' ? null : (editActiveData.countValue ? parseInt(editActiveData.countValue) : null),
    };

    const newRecipeName = generateRecipeName(newParams);

    // Check if this recipe already exists (excluding current recipe)
    const existsInActive = activeRecipes.some(
      (r, i) => r.recipeName === newRecipeName && i !== editingActiveIndex
    );
    const existsInAssigned = assignedRecipes.some(
      (r) => r.recipeName === newRecipeName
    );

    if (existsInActive || existsInAssigned) {
      setEditActiveError(`Recipe "${newRecipeName}" already exists in ${existsInActive ? 'Active' : 'Assigned'} Recipes.`);
      setTimeout(() => setEditActiveError(""), 5000);
      return;
    }

    // Update the recipe
    // Clear recipeId since the recipe name changed - backend will resolve the correct ID
    const oldRecipe = activeRecipes[editingActiveIndex];
    const recipeNameChanged = oldRecipe.recipeName !== newRecipeName;
    
    const updatedRecipes = [...activeRecipes];
    updatedRecipes[editingActiveIndex] = {
      ...updatedRecipes[editingActiveIndex],
      recipeId: recipeNameChanged ? null : oldRecipe.recipeId, // Clear if name changed
      recipeName: newRecipeName,
      params: newParams,
      gates: editActiveData.gates
    };
    
    if (recipeNameChanged) {
      console.log(`[Setup] Recipe name changed: ${oldRecipe.recipeName} → ${newRecipeName}, clearing recipeId`);
    }

    // Push updated recipes to backend (so it knows about the edit)
    try {
      await api.post('/machine/recipes', { recipes: updatedRecipes });
      console.log('[Setup] Updated active recipes on backend after edit');
    } catch (error) {
      console.error('[Setup] Failed to update active recipes on backend:', error);
      setEditActiveError("Failed to update recipe on server");
      setTimeout(() => setEditActiveError(""), 5000);
      return;
    }

    setActiveRecipes(updatedRecipes);
    setEditingActiveIndex(null);
    setEditActiveData(null);
    setEditActiveError("");
  };

  // Validation for add buttons
  const canAddPreset = selectedRecipe && presetGates.length > 0;
  const canAddManual =
    manualPieceMin &&
    manualPieceMax &&
    manualGates.length > 0 &&
    (manualBatchWeightEnabled || manualPieceCountEnabled) && // At least one constraint required
    (!manualBatchWeightEnabled || (manualBatchMin && manualBatchMax)) &&
    (!manualPieceCountEnabled || manualPieceCount);

  return (
    <Box m="20px">
      <Header title="Setup" subtitle="Set up production" />

      <Box 
        mt="70px"
        sx={{
          overflowY: "auto",
          overflowX: "visible",
          maxHeight: "calc(100vh - 200px)",
          pr: 2,
          pb: 4,
          pl: 1.5,
          ml: -1.5
        }}
      >
        {/* Top Section: Recipe Selection and Machine Controls */}
        <Box display="flex" gap={16} mb={6}>
          {/* Recipe Selection (Left) */}
          <Box sx={{ width: "50%" }}>
          <FormControl component="fieldset" fullWidth>
            <FormLabel component="legend">
              <Typography
                variant="h4"
                fontWeight="bold"
                sx={{ mb: 2, color: colors.tealAccent[500] }}
              >
                Recipe Selection
              </Typography>
            </FormLabel>
            <RadioGroup row value={mode} onChange={handleModeChange} name="recipe-mode">
              <FormControlLabel
                value="preset"
                control={<Radio color="secondary" />}
                label="Pre-specified Recipe"
              />
              <FormControlLabel
                value="manual"
                control={<Radio color="secondary" />}
                label="Manual Setup"
              />
            </RadioGroup>
          </FormControl>

          {/* Preset Recipe Selection */}
          {mode === "preset" && (
            <Box mt={2} display="flex" flexDirection="column" gap={2}>
              <Autocomplete
                options={recipes.filter(
                  (recipe) =>
                    !assignedRecipes.some((assigned) => assigned.recipeName === recipe.name) &&
                    !activeRecipes.some((active) => active.recipeName === recipe.name)
                )}
                getOptionLabel={(option) => option.name}
                value={selectedRecipe}
                onChange={(event, newValue) => setSelectedRecipe(newValue)}
                loading={loadingRecipes}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="Select Recipe"
                    color="secondary"
                    placeholder="Type to search (e.g., R_15_)"
                  />
                )}
                sx={{ width: "100%" }}
              />

              {selectedRecipe && (
                <>
                  <Typography variant="h6" sx={{ mt: 1 }}>
                    Assign to Gates:
                  </Typography>
                  <Box display="grid" gridTemplateColumns="repeat(4, 1fr)" gap={1}>
                    {Array.from({ length: 8 }, (_, i) => i + 1).map((gate) => (
                      <FormControlLabel
                        key={gate}
                        control={
                          <Checkbox
                            checked={presetGates.includes(gate)}
                            onChange={() => togglePresetGate(gate)}
                            disabled={usedGates.includes(gate)}
                            color="secondary"
                          />
                        }
                        label={`Gate ${gate}`}
                      />
                    ))}
                  </Box>
                </>
              )}

              <Button
                variant="contained"
                color="secondary"
                onClick={handleAddPreset}
                disabled={!canAddPreset}
              >
                Add Recipe
              </Button>
            </Box>
          )}

          {/* Manual Setup */}
          {mode === "manual" && (
            <Box mt={2} display="flex" flexDirection="column" gap={2}>
              {/* Piece Weight Bounds (Required) */}
              <Typography variant="h6" sx={{ mt: 1 }}>
                Piece Weight Bounds (required)
              </Typography>
              <Box display="flex" gap={2}>
                <TextField
                  label="Piece Min Weight (g)"
                  type="number"
                  color="secondary"
                  fullWidth
                  value={manualPieceMin}
                  onChange={(e) => setManualPieceMin(e.target.value)}
                  inputProps={{ step: 1 }}
                />
                <TextField
                  label="Piece Max Weight (g)"
                  type="number"
                  color="secondary"
                  fullWidth
                  value={manualPieceMax}
                  onChange={(e) => setManualPieceMax(e.target.value)}
                  inputProps={{ step: 1 }}
                />
              </Box>

              {/* Batch Weight Constraints (Optional) */}
              <FormControlLabel
                control={
                  <Checkbox
                    checked={manualBatchWeightEnabled}
                    onChange={(e) => setManualBatchWeightEnabled(e.target.checked)}
                    color="secondary"
                  />
                }
                label="Apply Batch Weight Constraints"
              />
              {manualBatchWeightEnabled && (
                <Box display="flex" gap={2}>
                  <TextField
                    label="Batch Min Weight (g)"
                    type="number"
                    color="secondary"
                    fullWidth
                    value={manualBatchMin}
                    onChange={(e) => setManualBatchMin(e.target.value)}
                    inputProps={{ step: 1 }}
                  />
                  <TextField
                    label="Batch Max Weight (g)"
                    type="number"
                    color="secondary"
                    fullWidth
                    value={manualBatchMax}
                    onChange={(e) => setManualBatchMax(e.target.value)}
                    inputProps={{ step: 1 }}
                  />
                </Box>
              )}

              {/* Piece Count Constraints (Optional) */}
              <FormControlLabel
                control={
                  <Checkbox
                    checked={manualPieceCountEnabled}
                    onChange={(e) => setManualPieceCountEnabled(e.target.checked)}
                    color="secondary"
                  />
                }
                label="Apply Piece Count Constraints"
              />
              {manualPieceCountEnabled && (
                <Box display="flex" gap={2}>
                  <FormControl fullWidth>
                    <InputLabel color="secondary">Count Type</InputLabel>
                    <Select
                      value={manualPieceCountType}
                      label="Count Type"
                      onChange={(e) => setManualPieceCountType(e.target.value)}
                      color="secondary"
                    >
                      <MenuItem value="min">Min</MenuItem>
                      <MenuItem value="max">Max</MenuItem>
                      <MenuItem value="exact">Exact</MenuItem>
                    </Select>
                  </FormControl>
                  <TextField
                    label="Count"
                    type="number"
                    color="secondary"
                    fullWidth
                    value={manualPieceCount}
                    onChange={(e) => setManualPieceCount(e.target.value)}
                    inputProps={{ step: 1 }}
                  />
                </Box>
              )}

              {/* Gate Assignment */}
              <Typography variant="h6" sx={{ mt: 1 }}>
                Assign to Gates:
              </Typography>
              <Box display="grid" gridTemplateColumns="repeat(4, 1fr)" gap={1}>
                {Array.from({ length: 8 }, (_, i) => i + 1).map((gate) => (
                  <FormControlLabel
                    key={gate}
                    control={
                      <Checkbox
                        checked={manualGates.includes(gate)}
                        onChange={() => toggleManualGate(gate)}
                        disabled={usedGates.includes(gate)}
                        color="secondary"
                      />
                    }
                    label={`Gate ${gate}`}
                  />
                ))}
              </Box>

              <Button
                variant="contained"
                color="secondary"
                onClick={handleAddManual}
                disabled={!canAddManual}
              >
                Add Recipe
              </Button>

              {addError && (
                <Typography variant="body2" sx={{ color: colors.redAccent[500] }}>
                  {addError}
                </Typography>
              )}
            </Box>
          )}
          </Box>

          {/* Machine Controls (Right) */}
          <Box sx={{ width: "50%" }}>
            <MachineControls 
              layout="horizontal" 
              activeRecipesCount={activeRecipes.length}
              onStop={(recipesToRestore) => {
                // Move active recipes back to assigned (avoid duplicates)
                const existingRecipeNames = new Set(assignedRecipes.map(r => r.recipeName));
                const uniqueRecipesToRestore = recipesToRestore.filter(r => !existingRecipeNames.has(r.recipeName));
                setAssignedRecipes(prev => [...prev, ...uniqueRecipesToRestore]);
              }}
              styles={{
                stateBadge: {
                  px: 1.5,
                  py: 0.4,
                  borderRadius: 1.5,
                  fontSize: '0.75rem',
                },
              }}
            />
          </Box>
        </Box>

        {/* Assigned Recipes - Below Recipe Selection */}
        <Box mt={6}>
          <Typography
            variant="h4"
            fontWeight="bold"
            sx={{ mb: 2, color: colors.tealAccent[500] }}
          >
            Assigned Recipes
          </Typography>

          {assignedRecipes.length === 0 ? (
            <Typography>No recipes assigned.</Typography>
          ) : (
            <>
              {/* Recipe Assignment Table */}
              <Paper sx={{ p: 3, backgroundColor: colors.primary[200], mb: 3 }}>
                <Box display="grid" gridTemplateColumns="250px repeat(8, 20px) 60px repeat(6, 80px) 80px 80px" gap="2px">
                  {/* Header Level 1 - Grouped headers */}
                  <Box sx={{ p: 0, display: 'flex', alignItems: 'center', minHeight: '20px' }}>
                    <Typography variant="body2" fontWeight="bold">Recipe</Typography>
                  </Box>
                  <Box sx={{ p: 0, display: 'flex', alignItems: 'center', minHeight: '20px', gridColumn: 'span 8' }}>
                    <Typography variant="body2" fontWeight="bold">Gates</Typography>
                  </Box>
                  {/* Spacer column */}
                  <Box/>
                  <Box sx={{ pl: 0, display: 'flex', alignItems: 'center', justifyContent: 'flex-start', minHeight: '20px', gridColumn: 'span 2' }}>
                    <Typography variant="body2" fontWeight="bold">Piece Weight</Typography>
                  </Box>
                  <Box sx={{ pl: 0, display: 'flex', alignItems: 'center', justifyContent: 'flex-start', minHeight: '20px', gridColumn: 'span 2' }}>
                    <Typography variant="body2" fontWeight="bold">Batch Weight</Typography>
                  </Box>
                  <Box sx={{ pl: 0, display: 'flex', alignItems: 'center', justifyContent: 'flex-start', minHeight: '20px', gridColumn: 'span 2' }}>
                    <Typography variant="body2" fontWeight="bold">Pieces</Typography>
                  </Box>
                  <Box sx={{ pl: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '20px', gridColumn: 'span 2' }}>
                    <Typography variant="body2" fontWeight="bold"> </Typography>
                  </Box>

                  {/* Header Level 2 - Detail headers */}
                  <Box sx={{ p: 0, display: 'flex', alignItems: 'center', minHeight: '20px', mb: 1 }}>
                    {/* Empty cell for Recipe column */}
                  </Box>
                  {[1, 2, 3, 4, 5, 6, 7, 8].map(gate => (
                    <Box key={gate} sx={{ p: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '20px', mb: 1 }}>
                      <Typography variant="body2" fontWeight="bold">{gate}</Typography>
                    </Box>
                  ))}
                  {/* Spacer column */}
                  <Box sx={{ mb: 1 }}/>
                  <Box sx={{ p: 0, display: 'flex', alignItems: 'center', minHeight: '20px', mb: 1 }}>
                    <Typography variant="body2" fontWeight="bold">Min</Typography>
                  </Box>
                  <Box sx={{ p: 0, display: 'flex', alignItems: 'center', minHeight: '20px', mb: 1 }}>
                    <Typography variant="body2" fontWeight="bold">Max</Typography>
                  </Box>
                  <Box sx={{ p: 0, display: 'flex', alignItems: 'center', minHeight: '20px', mb: 1 }}>
                    <Typography variant="body2" fontWeight="bold">Min</Typography>
                  </Box>
                  <Box sx={{ p: 0, display: 'flex', alignItems: 'center', minHeight: '20px', mb: 1 }}>
                    <Typography variant="body2" fontWeight="bold">Max</Typography>
                  </Box>
                  <Box sx={{ p: 0, display: 'flex', alignItems: 'center', minHeight: '20px', mb: 1 }}>
                    <Typography variant="body2" fontWeight="bold">Min</Typography>
                  </Box>
                  <Box sx={{ p: 0, display: 'flex', alignItems: 'center', minHeight: '20px', mb: 1 }}>
                    <Typography variant="body2" fontWeight="bold">Max</Typography>
                  </Box>
                  <Box sx={{ p: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '20px', mb: 1, gridColumn: 'span 2' }}>
                    {/* Empty cells for Action columns */}
                  </Box>

                  {/* Recipe rows */}
                  {assignedRecipes.map((recipe, i) => {
                    // Use same color palette as Stats page
                    const recipeColor = recipeColors[i % recipeColors.length];

                    return (
                      <React.Fragment key={i}>
                        {/* Recipe name - left-aligned */}
                        <Box sx={{ p: 0.5, display: 'flex', alignItems: 'center', minHeight: '20px' }}>
                          <Typography variant="body2">{recipe.recipeName}</Typography>
                        </Box>
                        
                        {/* Gate assignments - square boxes */}
                        {[1, 2, 3, 4, 5, 6, 7, 8].map(gate => (
                          <Box 
                            key={`${i}-${gate}`} 
                            sx={{
                              backgroundColor: recipe.gates.includes(gate) ? recipeColor : undefined,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              minHeight: '20px',
                              height: '20px'
                            }}
                          />
                        ))}
                        
                        {/* Spacer column */}
                        <Box />
                        
                        {/* Recipe specifications */}
                        <Box sx={{ p: 0.5, display: 'flex', alignItems: 'center', justifyContent: 'left', minHeight: '20px' }}>
                          <Typography variant="body2">{recipe.params.pieceMinWeight || '-'}</Typography>
                        </Box>
                        <Box sx={{ p: 0.5, display: 'flex', alignItems: 'center', justifyContent: 'left', minHeight: '20px' }}>
                          <Typography variant="body2">{recipe.params.pieceMaxWeight || '-'}</Typography>
                        </Box>
                        <Box sx={{ p: 0.5, display: 'flex', alignItems: 'center', justifyContent: 'left', minHeight: '20px' }}>
                          <Typography variant="body2">{recipe.params.batchMinWeight || '-'}</Typography>
                        </Box>
                        <Box sx={{ p: 0.5, display: 'flex', alignItems: 'center', justifyContent: 'left', minHeight: '20px' }}>
                          <Typography variant="body2">{recipe.params.batchMaxWeight || '-'}</Typography>
                        </Box>
                        <Box sx={{ p: 0.5, display: 'flex', alignItems: 'center', justifyContent: 'left', minHeight: '20px' }}>
                          <Typography variant="body2">
                            {recipe.params.countType === 'min' || recipe.params.countType === 'exact' 
                              ? recipe.params.countValue || '-' 
                              : '-'}
                          </Typography>
                        </Box>
                        <Box sx={{ p: 0.5, display: 'flex', alignItems: 'center', justifyContent: 'left', minHeight: '20px' }}>
                          <Typography variant="body2">
                            {recipe.params.countType === 'max' || recipe.params.countType === 'exact' 
                              ? recipe.params.countValue || '-' 
                              : '-'}
                          </Typography>
                        </Box>
                        
                        {/* Edit button */}
                        <Box sx={{ p: 0.5, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '20px' }}>
                          <Button
                            size="small"
                            onClick={() => handleEditAssigned(i)}
                            disabled={machineState === "running"}
                            sx={{ 
                              color: colors.tealAccent[500],
                              minWidth: 'auto',
                              padding: '2px 8px',
                              fontSize: '0.75rem',
                              '&:hover': {
                                backgroundColor: colors.tealAccent[500],
                                color: '#fff',
                              }
                            }}
                          >
                            Edit
                          </Button>
                        </Box>

                        {/* Remove button */}
                        <Box sx={{ p: 0.5, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '20px' }}>
                          <Button
                            size="small"
                            onClick={() => handleRemoveAssignment(i)}
                            disabled={machineState === "running"}
                            sx={{ 
                              color: colors.redAccent[500],
                              minWidth: 'auto',
                              padding: '2px 8px',
                              fontSize: '0.75rem',
                              '&:hover': {
                                backgroundColor: colors.redAccent[500],
                                color: '#fff',
                              }
                            }}
                          >
                            Remove
                          </Button>
                        </Box>

                        {/* Edit row - shown when editing */}
                        {editingAssignedIndex === i && (
                          <>
                            {/* Recipe name placeholder */}
                            <Box sx={{ p: 0.5, display: 'flex', alignItems: 'center', minHeight: '20px' }} />
                            
                            {/* Gate assignment checkboxes */}
                            {[1, 2, 3, 4, 5, 6, 7, 8].map(gate => {
                              // Check if gate is used by other recipes (excluding current recipe being edited)
                              const isGateUsedByOthers = usedGates.filter((g, idx) => {
                                // Get all gates except from the recipe being edited
                                const otherRecipesGates = assignedRecipes
                                  .filter((_, idx) => idx !== editingAssignedIndex)
                                  .flatMap(r => r.gates);
                                const activeRecipesGates = activeRecipes.flatMap(r => r.gates);
                                return [...otherRecipesGates, ...activeRecipesGates].includes(g);
                              }).includes(gate);

                              // Get the recipe's color
                              const recipeColor = recipeColors[i % recipeColors.length];

                              return (
                                <Box key={`edit-gate-${gate}`} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '20px' }}>
                                  <Checkbox
                                    checked={editAssignedData?.gates?.includes(gate) || false}
                                    onChange={(e) => {
                                      const newGates = e.target.checked
                                        ? [...(editAssignedData?.gates || []), gate]
                                        : (editAssignedData?.gates || []).filter(g => g !== gate);
                                      setEditAssignedData({...editAssignedData, gates: newGates});
                                    }}
                                    disabled={isGateUsedByOthers}
                                    size="small"
                                    sx={{ 
                                      padding: 0,
                                      color: recipeColor,
                                      '&.Mui-checked': {
                                        color: recipeColor,
                                      },
                                    }}
                                  />
                                </Box>
                              );
                            })}
                            
                            {/* Spacer */}
                            <Box />
                            
                            {/* Piece Min Weight */}
                            <Box sx={{ p: 0.5, display: 'flex', alignItems: 'center', minHeight: '20px' }}>
                              <TextField
                                type="number"
                                value={editAssignedData?.pieceMinWeight || ''}
                                onChange={(e) => setEditAssignedData({...editAssignedData, pieceMinWeight: e.target.value})}
                                size="small"
                                color="secondary"
                                inputProps={{ step: 1, style: { fontSize: '0.7rem' } }}
                                sx={{ width: '100%' }}
                              />
                            </Box>
                            
                            {/* Piece Max Weight */}
                            <Box sx={{ p: 0.5, display: 'flex', alignItems: 'center', minHeight: '20px' }}>
                              <TextField
                                type="number"
                                value={editAssignedData?.pieceMaxWeight || ''}
                                onChange={(e) => setEditAssignedData({...editAssignedData, pieceMaxWeight: e.target.value})}
                                size="small"
                                color="secondary"
                                inputProps={{ step: 1, style: { fontSize: '0.7rem' } }}
                                sx={{ width: '100%' }}
                              />
                            </Box>
                            
                            {/* Batch Min Weight */}
                            <Box sx={{ p: 0.5, display: 'flex', alignItems: 'center', minHeight: '20px' }}>
                              <TextField
                                type="number"
                                value={editAssignedData?.batchMinWeight || ''}
                                onChange={(e) => setEditAssignedData({...editAssignedData, batchMinWeight: e.target.value})}
                                size="small"
                                color="secondary"
                                inputProps={{ step: 1, style: { fontSize: '0.7rem' } }}
                                sx={{ width: '100%' }}
                              />
                            </Box>
                            
                            {/* Batch Max Weight */}
                            <Box sx={{ p: 0.5, display: 'flex', alignItems: 'center', minHeight: '20px' }}>
                              <TextField
                                type="number"
                                value={editAssignedData?.batchMaxWeight || ''}
                                onChange={(e) => setEditAssignedData({...editAssignedData, batchMaxWeight: e.target.value})}
                                size="small"
                                color="secondary"
                                inputProps={{ step: 1, style: { fontSize: '0.7rem' } }}
                                sx={{ width: '100%' }}
                              />
                            </Box>
                            
                            {/* Piece Count Min */}
                            <Box sx={{ p: 0.5, display: 'flex', alignItems: 'center', minHeight: '20px' }}>
                              <Select
                                value={editAssignedData?.countType || 'NA'}
                                onChange={(e) => {
                                  const newType = e.target.value;
                                  setEditAssignedData({
                                    ...editAssignedData, 
                                    countType: newType,
                                    countValue: newType === 'NA' ? '' : editAssignedData.countValue
                                  });
                                }}
                                size="small"
                                color="secondary"
                                sx={{ width: '100%', fontSize: '0.7rem' }}
                              >
                                <MenuItem value="NA" sx={{ fontSize: '0.7rem' }}>NA</MenuItem>
                                <MenuItem value="min" sx={{ fontSize: '0.7rem' }}>Min</MenuItem>
                                <MenuItem value="max" sx={{ fontSize: '0.7rem' }}>Max</MenuItem>
                                <MenuItem value="exact" sx={{ fontSize: '0.7rem' }}>Exact</MenuItem>
                              </Select>
                            </Box>
                            
                            {/* Piece Count Max / Value */}
                            <Box sx={{ p: 0.5, display: 'flex', alignItems: 'center', minHeight: '20px' }}>
                              <TextField
                                type="number"
                                value={editAssignedData?.countValue || ''}
                                onChange={(e) => setEditAssignedData({...editAssignedData, countValue: e.target.value})}
                                size="small"
                                color="secondary"
                                inputProps={{ step: 1, style: { fontSize: '0.7rem' } }}
                                sx={{ width: '100%' }}
                                disabled={editAssignedData?.countType === 'NA'}
                              />
                            </Box>
                            
                            {/* Accept Button */}
                            <Box sx={{ p: 0.5, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '20px' }}>
                              <Button
                                variant="contained"
                                color="secondary"
                                size="small"
                                onClick={handleAcceptEditAssigned}
                                sx={{ minWidth: 'auto', padding: '2px 8px', fontSize: '0.75rem' }}
                              >
                                ACCEPT
                              </Button>
                            </Box>
                            
                            {/* Cancel Button */}
                            <Box sx={{ p: 0.5, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '20px' }}>
                              <Button
                                variant="outlined"
                                color="secondary"
                                size="small"
                                onClick={handleCancelEditAssigned}
                                sx={{ minWidth: 'auto', padding: '2px 8px', fontSize: '0.75rem' }}
                              >
                                CANCEL
                              </Button>
                            </Box>
                          </>
                        )}
                      </React.Fragment>
                    );
                  })}
                </Box>
              </Paper>

              {/* Send Recipes Button */}
              <Button 
                variant="contained" 
                color="secondary" 
                onClick={handleSendPrograms}
                disabled={machineState === "running"}
              >
                Activate Recipes
              </Button>
            </>
          )}

          {editAssignedError && (
            <Typography variant="body2" sx={{ color: colors.redAccent[500], mt: 2 }}>
              {editAssignedError}
            </Typography>
          )}

          {editAssignedSuccess && (
            <Typography variant="body1" sx={{ color: colors.tealAccent[400], mt: 2 }}>
              {editAssignedSuccess}
            </Typography>
          )}
        </Box>

        {/* Active Recipes - Below Assigned Recipes */}
        <Box mt={6}>
          <Box display="flex" alignItems="center" gap={2} mb={2}>
            <Typography
              variant="h4"
              fontWeight="bold"
              sx={{ color: colors.tealAccent[500] }}
            >
              Active Recipes
            </Typography>
            {(transitioningGates.length > 0 || completedTransitionGates.length > 0) && (
              <Typography
                variant="body2"
                sx={{
                  color: theme.palette.action.disabled,
                  backgroundColor: theme.palette.action.disabledBackground,
                  border: `0.2px solid ${theme.palette.action.disabled}`,
                  px: 1.5,
                  py: 0.5,
                  borderRadius: "4px",
                }}
              >
                {transitioningGates.length > 0 
                  ? `Gates ${transitioningGates.join(", ")} completing batches.`
                  : `Waiting for all transitions to complete.`}
                {completedTransitionGates.length > 0 && transitioningGates.length > 0 && 
                  ` Gates ${completedTransitionGates.join(", ")} completed.`}
              </Typography>
            )}
          </Box>

          {activeRecipes.length === 0 ? (
            <Typography>No active recipes. Send recipes from "Assigned Recipes" to activate them.</Typography>
          ) : (
            <>
              {/* Active Recipe Table */}
              <Paper sx={{ p: 3, backgroundColor: colors.primary[200], mb: 3 }}>
                <Box display="grid" gridTemplateColumns="250px repeat(8, 20px) 60px repeat(6, 80px) 80px 80px" gap="2px">
                  {/* Header Level 1 - Grouped headers */}
                  <Box sx={{ p: 0, display: 'flex', alignItems: 'center', minHeight: '20px' }}>
                    <Typography variant="body2" fontWeight="bold">Recipe</Typography>
                  </Box>
                  <Box sx={{ p: 0, display: 'flex', alignItems: 'center', minHeight: '20px', gridColumn: 'span 8' }}>
                    <Typography variant="body2" fontWeight="bold">Gates</Typography>
                  </Box>
                  {/* Spacer column */}
                  <Box/>
                  <Box sx={{ pl: 0, display: 'flex', alignItems: 'center', justifyContent: 'flex-start', minHeight: '20px', gridColumn: 'span 2' }}>
                    <Typography variant="body2" fontWeight="bold">Piece Weight</Typography>
                  </Box>
                  <Box sx={{ pl: 0, display: 'flex', alignItems: 'center', justifyContent: 'flex-start', minHeight: '20px', gridColumn: 'span 2' }}>
                    <Typography variant="body2" fontWeight="bold">Batch Weight</Typography>
                  </Box>
                  <Box sx={{ pl: 0, display: 'flex', alignItems: 'center', justifyContent: 'flex-start', minHeight: '20px', gridColumn: 'span 2' }}>
                    <Typography variant="body2" fontWeight="bold">Pieces</Typography>
                  </Box>
                  <Box sx={{ pl: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '20px', gridColumn: 'span 2' }}>
                    <Typography variant="body2" fontWeight="bold"> </Typography>
                  </Box>

                  {/* Header Level 2 - Detail headers */}
                  <Box sx={{ p: 0, display: 'flex', alignItems: 'center', minHeight: '20px', mb: 1 }}>
                    {/* Empty cell for Recipe column */}
                  </Box>
                  {[1, 2, 3, 4, 5, 6, 7, 8].map(gate => (
                    <Box key={gate} sx={{ p: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '20px', mb: 1 }}>
                      <Typography variant="body2" fontWeight="bold">{gate}</Typography>
                    </Box>
                  ))}
                  {/* Spacer column */}
                  <Box sx={{ mb: 1 }}/>
                  <Box sx={{ p: 0, display: 'flex', alignItems: 'center', minHeight: '20px', mb: 1 }}>
                    <Typography variant="body2" fontWeight="bold">Min</Typography>
                  </Box>
                  <Box sx={{ p: 0, display: 'flex', alignItems: 'center', minHeight: '20px', mb: 1 }}>
                    <Typography variant="body2" fontWeight="bold">Max</Typography>
                  </Box>
                  <Box sx={{ p: 0, display: 'flex', alignItems: 'center', minHeight: '20px', mb: 1 }}>
                    <Typography variant="body2" fontWeight="bold">Min</Typography>
                  </Box>
                  <Box sx={{ p: 0, display: 'flex', alignItems: 'center', minHeight: '20px', mb: 1 }}>
                    <Typography variant="body2" fontWeight="bold">Max</Typography>
                  </Box>
                  <Box sx={{ p: 0, display: 'flex', alignItems: 'center', minHeight: '20px', mb: 1 }}>
                    <Typography variant="body2" fontWeight="bold">Min</Typography>
                  </Box>
                  <Box sx={{ p: 0, display: 'flex', alignItems: 'center', minHeight: '20px', mb: 1 }}>
                    <Typography variant="body2" fontWeight="bold">Max</Typography>
                  </Box>
                  <Box sx={{ p: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '20px', mb: 1, gridColumn: 'span 2' }}>
                    {/* Empty cells for Action columns */}
                  </Box>

                  {/* Recipe rows */}
                  {activeRecipes.map((recipe, i) => {
                    // Use same color palette as Stats page
                    const recipeColor = recipeColors[i % recipeColors.length];

                    return (
                      <React.Fragment key={i}>
                        {/* Recipe name - left-aligned */}
                        <Box sx={{ p: 0.5, display: 'flex', alignItems: 'center', minHeight: '20px' }}>
                          <Typography variant="body2">{recipe.recipeName}</Typography>
                        </Box>
                        
                        {/* Gate assignments - square boxes */}
                        {[1, 2, 3, 4, 5, 6, 7, 8].map(gate => {
                          const isTransitioning = transitioningGates.includes(gate) && recipe.gates.includes(gate);
                          return (
                            <Box 
                              key={`${i}-${gate}`} 
                              sx={{
                                backgroundColor: recipe.gates.includes(gate) ? recipeColor : undefined,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                minHeight: '20px',
                                height: '20px',
                                // Pulsing animation for transitioning gates (uses synced timing)
                                ...(isTransitioning && {
                                  ...getSyncedAnimationStyle(),
                                  border: `2px solid ${theme.palette.mode === 'dark' 
                                    ? 'rgba(255, 255, 255, 0.5)' 
                                    : 'rgba(0, 0, 0, 0.38)'}`,
                                }),
                              }}
                            />
                          );
                        })}
                        
                        {/* Spacer column */}
                        <Box />
                        
                        {/* Recipe specifications */}
                        <Box sx={{ p: 0.5, display: 'flex', alignItems: 'center', justifyContent: 'left', minHeight: '20px' }}>
                          <Typography variant="body2">{recipe.params.pieceMinWeight || '-'}</Typography>
                        </Box>
                        <Box sx={{ p: 0.5, display: 'flex', alignItems: 'center', justifyContent: 'left', minHeight: '20px' }}>
                          <Typography variant="body2">{recipe.params.pieceMaxWeight || '-'}</Typography>
                        </Box>
                        <Box sx={{ p: 0.5, display: 'flex', alignItems: 'center', justifyContent: 'left', minHeight: '20px' }}>
                          <Typography variant="body2">{recipe.params.batchMinWeight || '-'}</Typography>
                        </Box>
                        <Box sx={{ p: 0.5, display: 'flex', alignItems: 'center', justifyContent: 'left', minHeight: '20px' }}>
                          <Typography variant="body2">{recipe.params.batchMaxWeight || '-'}</Typography>
                        </Box>
                        <Box sx={{ p: 0.5, display: 'flex', alignItems: 'center', justifyContent: 'left', minHeight: '20px' }}>
                          <Typography variant="body2">
                            {recipe.params.countType === 'min' || recipe.params.countType === 'exact' 
                              ? recipe.params.countValue || '-' 
                              : '-'}
                          </Typography>
                        </Box>
                        <Box sx={{ p: 0.5, display: 'flex', alignItems: 'center', justifyContent: 'left', minHeight: '20px' }}>
                          <Typography variant="body2">
                            {recipe.params.countType === 'max' || recipe.params.countType === 'exact' 
                              ? recipe.params.countValue || '-' 
                              : '-'}
                          </Typography>
                        </Box>
                        
                        {/* Edit and Remove buttons - or Transitioning/Locked text */}
                        {(() => {
                          const isRecipeTransitioning = recipe.gates.some(gate => transitioningGates.includes(gate));
                          const isRecipeLocked = recipe.gates.some(gate => completedTransitionGates.includes(gate));
                          const isInTransitionPeriod = transitioningGates.length > 0 || completedTransitionGates.length > 0;
                          
                          if (isRecipeTransitioning) {
                            // Show "Transitioning" spanning both columns, centered
                            return (
                              <>
                                <Box sx={{ 
                                  p: 0.5, 
                                  mr: 1.3,
                                  display: 'flex', 
                                  alignItems: 'center', 
                                  justifyContent: 'center', 
                                  minHeight: '20px',
                                  gridColumn: 'span 2'
                                }}>
                                  <Typography 
                                    variant="body2" 
                                    sx={{ 
                                      color: theme.palette.action.disabled,
                                      fontSize: '0.75rem'
                                    }}
                                  >
                                    TRANSITIONING
                                  </Typography>
                                </Box>
                              </>
                            );
                          }
                          
                          if (isRecipeLocked && isInTransitionPeriod) {
                            // Recipe has completed transition but other gates still transitioning - LOCKED
                            return (
                              <>
                                <Box sx={{ 
                                  p: 0.5, 
                                  mr: 1.3,
                                  display: 'flex', 
                                  alignItems: 'center', 
                                  justifyContent: 'center', 
                                  minHeight: '20px',
                                  gridColumn: 'span 2'
                                }}>
                                  <Typography 
                                    variant="body2" 
                                    sx={{ 
                                      color: theme.palette.action.disabled,
                                      fontSize: '0.75rem'
                                    }}
                                  >
                                    LOCKED
                                  </Typography>
                                </Box>
                              </>
                            );
                          }
                          
                          // Show Edit and Remove buttons
                          return (
                            <>
                              <Box sx={{ p: 0.5, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '20px' }}>
                                <Button
                                  size="small"
                                  onClick={() => handleEditActive(i)}
                                  disabled={machineState === "running"}
                                  sx={{ 
                                    color: colors.tealAccent[500],
                                    minWidth: 'auto',
                                    padding: '2px 8px',
                                    fontSize: '0.75rem',
                                    '&:hover': {
                                      backgroundColor: colors.tealAccent[500],
                                      color: '#fff',
                                    }
                                  }}
                                >
                                  Edit
                                </Button>
                              </Box>
                              <Box sx={{ p: 0.5, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '20px' }}>
                                <Button
                                  size="small"
                                  onClick={() => handleRemoveActiveRecipe(i)}
                                  disabled={machineState === "running"}
                                  sx={{ 
                                    color: colors.redAccent[500],
                                    minWidth: 'auto',
                                    padding: '2px 8px',
                                    fontSize: '0.75rem',
                                    '&:hover': {
                                      backgroundColor: colors.redAccent[500],
                                      color: '#fff',
                                    }
                                  }}
                                >
                                  Remove
                                </Button>
                              </Box>
                            </>
                          );
                        })()}

                        {/* Edit row - shown when editing */}
                        {editingActiveIndex === i && (
                          <>
                            {/* Recipe name placeholder */}
                            <Box sx={{ p: 0.5, display: 'flex', alignItems: 'center', minHeight: '20px' }} />
                            
                            {/* Gate assignment checkboxes */}
                            {[1, 2, 3, 4, 5, 6, 7, 8].map(gate => {
                              // Check if gate is used by other recipes (excluding current recipe being edited)
                              const isGateUsedByOthers = usedGates.filter((g, idx) => {
                                // Get all gates except from the recipe being edited
                                const assignedRecipesGates = assignedRecipes.flatMap(r => r.gates);
                                const otherActiveRecipesGates = activeRecipes
                                  .filter((_, idx) => idx !== editingActiveIndex)
                                  .flatMap(r => r.gates);
                                return [...assignedRecipesGates, ...otherActiveRecipesGates].includes(g);
                              }).includes(gate);

                              // Get the recipe's color
                              const recipeColor = recipeColors[i % recipeColors.length];

                              return (
                                <Box key={`edit-active-gate-${gate}`} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '20px' }}>
                                  <Checkbox
                                    checked={editActiveData?.gates?.includes(gate) || false}
                                    onChange={(e) => {
                                      const newGates = e.target.checked
                                        ? [...(editActiveData?.gates || []), gate]
                                        : (editActiveData?.gates || []).filter(g => g !== gate);
                                      setEditActiveData({...editActiveData, gates: newGates});
                                    }}
                                    disabled={isGateUsedByOthers}
                                    size="small"
                                    sx={{ 
                                      padding: 0,
                                      color: recipeColor,
                                      '&.Mui-checked': {
                                        color: recipeColor,
                                      },
                                    }}
                                  />
                                </Box>
                              );
                            })}
                            
                            {/* Spacer */}
                            <Box />
                            
                            {/* Piece Min Weight */}
                            <Box sx={{ p: 0.5, display: 'flex', alignItems: 'center', minHeight: '20px' }}>
                              <TextField
                                type="number"
                                value={editActiveData?.pieceMinWeight || ''}
                                onChange={(e) => setEditActiveData({...editActiveData, pieceMinWeight: e.target.value})}
                                size="small"
                                color="secondary"
                                inputProps={{ step: 1, style: { fontSize: '0.7rem' } }}
                                sx={{ width: '100%' }}
                              />
                            </Box>
                            
                            {/* Piece Max Weight */}
                            <Box sx={{ p: 0.5, display: 'flex', alignItems: 'center', minHeight: '20px' }}>
                              <TextField
                                type="number"
                                value={editActiveData?.pieceMaxWeight || ''}
                                onChange={(e) => setEditActiveData({...editActiveData, pieceMaxWeight: e.target.value})}
                                size="small"
                                color="secondary"
                                inputProps={{ step: 1, style: { fontSize: '0.7rem' } }}
                                sx={{ width: '100%' }}
                              />
                            </Box>
                            
                            {/* Batch Min Weight */}
                            <Box sx={{ p: 0.5, display: 'flex', alignItems: 'center', minHeight: '20px' }}>
                              <TextField
                                type="number"
                                value={editActiveData?.batchMinWeight || ''}
                                onChange={(e) => setEditActiveData({...editActiveData, batchMinWeight: e.target.value})}
                                size="small"
                                color="secondary"
                                inputProps={{ step: 1, style: { fontSize: '0.7rem' } }}
                                sx={{ width: '100%' }}
                              />
                            </Box>
                            
                            {/* Batch Max Weight */}
                            <Box sx={{ p: 0.5, display: 'flex', alignItems: 'center', minHeight: '20px' }}>
                              <TextField
                                type="number"
                                value={editActiveData?.batchMaxWeight || ''}
                                onChange={(e) => setEditActiveData({...editActiveData, batchMaxWeight: e.target.value})}
                                size="small"
                                color="secondary"
                                inputProps={{ step: 1, style: { fontSize: '0.7rem' } }}
                                sx={{ width: '100%' }}
                              />
                            </Box>
                            
                            {/* Piece Count Min */}
                            <Box sx={{ p: 0.5, display: 'flex', alignItems: 'center', minHeight: '20px' }}>
                              <Select
                                value={editActiveData?.countType || 'NA'}
                                onChange={(e) => {
                                  const newType = e.target.value;
                                  setEditActiveData({
                                    ...editActiveData, 
                                    countType: newType,
                                    countValue: newType === 'NA' ? '' : editActiveData.countValue
                                  });
                                }}
                                size="small"
                                color="secondary"
                                sx={{ width: '100%', fontSize: '0.7rem' }}
                              >
                                <MenuItem value="NA" sx={{ fontSize: '0.7rem' }}>NA</MenuItem>
                                <MenuItem value="min" sx={{ fontSize: '0.7rem' }}>Min</MenuItem>
                                <MenuItem value="max" sx={{ fontSize: '0.7rem' }}>Max</MenuItem>
                                <MenuItem value="exact" sx={{ fontSize: '0.7rem' }}>Exact</MenuItem>
                              </Select>
                            </Box>
                            
                            {/* Piece Count Max / Value */}
                            <Box sx={{ p: 0.5, display: 'flex', alignItems: 'center', minHeight: '20px' }}>
                              <TextField
                                type="number"
                                value={editActiveData?.countValue || ''}
                                onChange={(e) => setEditActiveData({...editActiveData, countValue: e.target.value})}
                                size="small"
                                color="secondary"
                                inputProps={{ step: 1, style: { fontSize: '0.7rem' } }}
                                sx={{ width: '100%' }}
                                disabled={editActiveData?.countType === 'NA'}
                              />
                            </Box>
                            
                            {/* Accept Button */}
                            <Box sx={{ p: 0.5, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '20px' }}>
                              <Button
                                variant="contained"
                                color="secondary"
                                size="small"
                                onClick={handleAcceptEditActive}
                                sx={{ minWidth: 'auto', padding: '2px 8px', fontSize: '0.75rem' }}
                              >
                                ACCEPT
                              </Button>
                            </Box>
                            
                            {/* Cancel Button */}
                            <Box sx={{ p: 0.5, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '20px' }}>
                              <Button
                                variant="outlined"
                                color="secondary"
                                size="small"
                                onClick={handleCancelEditActive}
                                sx={{ minWidth: 'auto', padding: '2px 8px', fontSize: '0.75rem' }}
                              >
                                CANCEL
                              </Button>
                            </Box>
                          </>
                        )}
                      </React.Fragment>
                    );
                  })}
                </Box>
              </Paper>
            </>
          )}

          {editActiveError && (
            <Typography variant="body2" sx={{ color: colors.redAccent[500], mt: 2 }}>
              {editActiveError}
            </Typography>
          )}

          {editActiveSuccess && (
            <Typography variant="body1" sx={{ color: colors.tealAccent[400], mt: 2 }}>
              {editActiveSuccess}
            </Typography>
          )}
        </Box>
      </Box>
    </Box>
  );
};

export default Setup;
