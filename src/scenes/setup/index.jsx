import React, { useState, useEffect, useRef, useLayoutEffect } from "react";
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
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  IconButton,
  Tooltip,
  Collapse,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Chip,
  Snackbar,
  Alert,
  Tabs,
  Tab,
  ToggleButtonGroup,
  ToggleButton,
} from "@mui/material";
import StarIcon from "@mui/icons-material/Star";
import StarBorderIcon from "@mui/icons-material/StarBorder";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import PauseIcon from "@mui/icons-material/Pause";
import DragIndicatorIcon from "@mui/icons-material/DragIndicator";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import SkipNextIcon from "@mui/icons-material/SkipNext";
import Header from "../../components/Header";
import MachineControls from "../../components/MachineControls";
import ServerOffline from "../../components/ServerOffline";
import { tokens } from "../../theme";
import { useAppContext } from "../../context/AppContext";
import api from "../../services/api";
import useMachineState from "../../hooks/useMachineState";
import { getSyncedAnimationStyle } from "../../utils/animationSync";

class WeightControlsInner extends React.Component {
  constructor(props) {
    super(props);
    this.state = { presetTare: '', currentTare: 0, applying: false };
  }

  componentDidMount() {
    api.get('/machine/weight-tare')
      .then(res => {
        const val = res.data?.weight_tare_g ?? 0;
        this.setState({ currentTare: val });
      })
      .catch(() => {});
  }

  handleApply = () => {
    const raw = String(this.state.presetTare).replace(',', '.');
    const val = Math.round((parseFloat(raw) || 0) * 10) / 10;
    // Update UI immediately (optimistic)
    this.setState({ currentTare: val, presetTare: '', applying: true });
    api.post('/machine/weight-tare', { weight_tare_g: val })
      .then(() => this.setState({ applying: false }))
      .catch((e) => {
        console.error('Failed to apply weight tare:', e);
        this.setState({ applying: false });
      });
  };

  render() {
    const { colors } = this.props;
    const { presetTare, currentTare, applying } = this.state;
    return (
      <Box sx={{ mt: 6 }}>
        <Typography variant="h4" fontWeight="bold" sx={{ mb: 1, color: colors.tealAccent[500] }}>
          Weight Controls
        </Typography>

        {/* <Typography variant="h6" sx={{ mb: 2 }}>
          Preset weight tare (g)
        </Typography> */}

        <Box display="flex" gap={2} alignItems="center" sx={{ mt: 3 }}>
          <TextField
            label="Preset Weight Tare (g)"
            type="number"
            color="secondary"
            size="small"
            value={presetTare}
            onChange={(e) => this.setState({ presetTare: e.target.value })}
            inputProps={{ step: 0.1, min: 0 }}
            sx={{ flex: 1 }}
          />
          <Button
            variant="contained"
            color="secondary"
            disabled={applying}
            onClick={this.handleApply}
            sx={{ flex: 1 }}
          >
            Apply
          </Button>
        </Box>

        <Typography variant="h6" sx={{ mt: 2 }}>
          Current tare: <strong>{currentTare.toFixed(1)} g</strong>
        </Typography>
      </Box>
    );
  }
}
const WeightControls = (props) => <WeightControlsInner {...props} />;

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

  // Helper: sort queue by priority: assigned > queued > halted
  // Preserves relative order within each group (stable sort)
  // Accepts an explicit activeRecipesList to avoid stale closure issues —
  // the local `activeRecipes` state lags behind `backendActiveRecipes` by one render.
  const sortQueueByStatus = (queue, activeRecipesList) => {
    const source = activeRecipesList || activeRecipes;
    const assigned = [];
    const queued = [];
    const halted = [];
    for (const item of queue) {
      const existingActive = source.find(r => {
        if (item.orderId) return r.orderId === item.orderId;
        return r.recipeName === item.recipeName && !r.orderId;
      });
      const isOnMachine = existingActive && (existingActive.gates?.length || 0) > 0;

      const isHalted = item.status === 'halted' ||
        (!item.status && (item.completedBatches || 0) > 0);

      if (isOnMachine) {
        assigned.push(item);
      } else if (isHalted) {
        halted.push(item);
      } else {
        queued.push(item);
      }
    }
    return [...assigned, ...queued, ...halted];
  };

  // Scrollbar width compensation for split-table alignment
  const orderListBodyRef = useRef(null);
  const orderQueueBodyRef = useRef(null);
  const [olScrollbarW, setOlScrollbarW] = useState(0);
  const [oqScrollbarW, setOqScrollbarW] = useState(0);

  useLayoutEffect(() => {
    const olEl = orderListBodyRef.current;
    if (olEl) {
      const sw = olEl.offsetWidth - olEl.clientWidth;
      if (sw !== olScrollbarW) setOlScrollbarW(sw);
    }
    const oqEl = orderQueueBodyRef.current;
    if (oqEl) {
      const sw = oqEl.offsetWidth - oqEl.clientWidth;
      if (sw !== oqScrollbarW) setOqScrollbarW(sw);
    }
  });

  // Recipe database state
  const [recipes, setRecipes] = useState([]);
  const [loadingRecipes, setLoadingRecipes] = useState(true);

  // Mode state: presetProgram, preset, manual, manualProgram
  const [mode, setMode] = useState("fromOrder");

  // Saved programs state
  const [savedPrograms, setSavedPrograms] = useState([]);
  const [loadingSavedPrograms, setLoadingSavedPrograms] = useState(true);
  const [selectedSavedProgram, setSelectedSavedProgram] = useState(null);

  // Manual program creation state
  const [programRecipes, setProgramRecipes] = useState([]); // Recipes being added to new program
  const [programName, setProgramName] = useState("");
  const [programSelectedRecipe, setProgramSelectedRecipe] = useState(null);
  const [programGates, setProgramGates] = useState([]);
  const [programError, setProgramError] = useState("");

  // Preset mode state
  const [selectedRecipe, setSelectedRecipe] = useState(null);
  const [presetGates, setPresetGates] = useState([]);
  const [presetMinGates, setPresetMinGates] = useState(1);
  const [presetRequestedBatches, setPresetRequestedBatches] = useState("");
  const [presetDestination, setPresetDestination] = useState("active"); // "active" or "queue"

  // Manual mode state
  const [manualDisplayName, setManualDisplayName] = useState(""); // Optional custom name
  const [manualPieceMin, setManualPieceMin] = useState("");
  const [manualPieceMax, setManualPieceMax] = useState("");
  const [manualBatchWeightEnabled, setManualBatchWeightEnabled] = useState(false);
  const [manualBatchMin, setManualBatchMin] = useState("");
  const [manualBatchMax, setManualBatchMax] = useState("");
  const [manualPieceCountEnabled, setManualPieceCountEnabled] = useState(false);
  const [manualPieceCountType, setManualPieceCountType] = useState("min"); // min, max, exact
  const [manualPieceCount, setManualPieceCount] = useState("");
  const [manualGates, setManualGates] = useState([]);
  const [manualMinGates, setManualMinGates] = useState(1);
  const [manualRequestedBatches, setManualRequestedBatches] = useState("");
  const [manualDestination, setManualDestination] = useState("active"); // "active" or "queue"

  // Order mode state
  const [orders, setOrders] = useState([]);
  const [loadingOrders, setLoadingOrders] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [orderGates, setOrderGates] = useState([]);
  const [orderMinGates, setOrderMinGates] = useState(1);
  const [orderDestination, setOrderDestination] = useState("active"); // "active" or "queue"

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

  // Skip transition dialog state
  const [skipDialogOpen, setSkipDialogOpen] = useState(false);
  const [skipRecipeIndex, setSkipRecipeIndex] = useState(null);

  // Delete confirmation dialog state
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteItemType, setDeleteItemType] = useState(null); // 'recipe' or 'program'
  const [deleteItemId, setDeleteItemId] = useState(null);
  const [deleteItemName, setDeleteItemName] = useState("");

  // Machine control state
  // Machine state from backend via SSE
  const {
    state: backendMachineState,
    activeRecipes: backendActiveRecipes,
    currentProgramId: backendProgramId,
    isConnected: machineConnected,
    transitioningGates: backendTransitioningGates,
    completedTransitionGates: backendCompletedTransitionGates,
    transitionStartRecipes: backendTransitionStartRecipes,
    programStartRecipes: backendProgramStartRecipes,
    transitionOldProgramId: backendTransitionOldProgramId,
    registeredTransitioningGates: backendRegisteredTransitioningGates,
    orderQueue: backendOrderQueue, // Backend order queue (source of truth)
    gateSnapshot, // Gate piece/weight data for each gate
    pausedGates: backendPausedGates, // Individually paused gates
    orderUpdates,
    recipeBatchUpdates, // Real-time batch updates for all recipes
    recipeCompletions, // Recipe completion events
    clearRecipeCompletions,
    batchLimitTransitions, // Recipes in batch limit transitioning mode
    gateHandoffs, // Recent gate handoff events
    clearGateHandoffs,
  } = useMachineState();
  const setupMachineHook = { state: backendMachineState, activeRecipes: backendActiveRecipes, isConnected: machineConnected };
  
  // Track transitioning gates (for visual indicator and edit permissions)
  const [transitioningGates, setTransitioningGates] = useState([]);
  // Track completed transition gates (gates that finished but other transitions still pending - LOCKED)
  const [completedTransitionGates, setCompletedTransitionGates] = useState([]);
  
  // Sync transitioning gates from backend (memoized to prevent unnecessary state updates)
  const prevTransitioningGatesStrRef = useRef(null);
  useEffect(() => {
    if (backendTransitioningGates !== undefined) {
      const str = JSON.stringify(backendTransitioningGates);
      if (str !== prevTransitioningGatesStrRef.current) {
        prevTransitioningGatesStrRef.current = str;
        setTransitioningGates(backendTransitioningGates);
      }
    }
  }, [backendTransitioningGates]);
  
  // Sync completed transition gates from backend (memoized)
  const prevCompletedTransitionGatesStrRef = useRef(null);
  useEffect(() => {
    if (backendCompletedTransitionGates !== undefined) {
      const str = JSON.stringify(backendCompletedTransitionGates);
      if (str !== prevCompletedTransitionGatesStrRef.current) {
        prevCompletedTransitionGatesStrRef.current = str;
        setCompletedTransitionGates(backendCompletedTransitionGates);
      }
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

  // Helper to generate a unique composite key for recipes
  // Orders use order_${orderId}, regular recipes use recipe_${sortedGates}
  const getRecipeCompositeKey = (recipe) => {
    if (!recipe) return null;
    if (recipe.orderId) return `order_${recipe.orderId}`;
    // Use gates as unique identifier for non-orders
    const gates = (recipe.gates || []).slice().sort().join('_');
    return `recipe_${recipe.recipeName}_${gates}`;
  };

  // Memoize display list: only update activeRecipes when meaningful data changes
  // This prevents the auto-assign effect from firing on every SSE event (reference-only changes)
  const prevDisplayListFingerprintRef = useRef(null);

  // Sync active recipes from backend (SSE is the single source of truth)
  // Also include removed recipes/gates that are still transitioning (from transitionStartRecipes)
  // Handles both full recipe removal AND partial gate removal
  // Maintain order using programStartRecipes as reference
  useEffect(() => {
    if (backendActiveRecipes !== undefined) {
      // Use composite keys to support duplicate recipe names (order vs regular recipe)
      const activeRecipeKeys = new Set(backendActiveRecipes.map(r => getRecipeCompositeKey(r)));
      const activeRecipeNames = new Set(backendActiveRecipes.map(r => r.recipeName));
      
      // Build a set of all gates currently assigned to active recipes
      const activeGates = new Set();
      for (const recipe of backendActiveRecipes) {
        for (const gate of (recipe.gates || [])) {
          activeGates.add(gate);
        }
      }
      
      // Find recipes/gates that were removed but are still transitioning
      // Case 1: Full recipe removal - recipe key not in activeRecipes
      // Case 2: Partial gate removal - recipe exists but gate was removed
      const removedRecipesByKey = {};
      for (const gate of (backendTransitioningGates || [])) {
        const originalRecipe = backendTransitionStartRecipes?.[gate];
        if (!originalRecipe) continue;
        
        // Skip gates that are part of batch limit transitioning
        // These are handled by the batch limit display logic (Finishing/Replacing rows)
        if (originalRecipe._batchLimitTransition) continue;
        
        const recipeKey = getRecipeCompositeKey(originalRecipe);
        const recipeName = originalRecipe.recipeName;
        const isFullRemoval = !activeRecipeKeys.has(recipeKey);
        const isPartialRemoval = !activeGates.has(gate);
        
        if (isFullRemoval || isPartialRemoval) {
          // This gate is transitioning and is either:
          // - Part of a fully removed recipe
          // - A gate that was removed from an existing recipe
          if (!removedRecipesByKey[recipeKey]) {
            // Determine if this was a "Finish" (recipe gone) or "Remove" (recipe back in queue)
            const isInQueue = assignedRecipes.some(q => {
              if (originalRecipe.orderId && q.orderId) return q.orderId === originalRecipe.orderId;
              if (!originalRecipe.orderId && !q.orderId) return q.recipeName === recipeName;
              return false;
            });
            removedRecipesByKey[recipeKey] = {
              recipeName: recipeName,
              recipeId: originalRecipe.recipeId,
              orderId: originalRecipe.orderId,
              displayName: originalRecipe.displayName || originalRecipe.display_name || null,
              params: originalRecipe.params,
              completedBatches: originalRecipe.completedBatches || 0,
              requestedBatches: originalRecipe.requestedBatches || 0,
              gates: [],
              isRemovedTransitioning: true,
              _transitionType: isInQueue ? 'removing' : 'finishing',
            };
          }
          // Only add gate if not already in the list
          if (!removedRecipesByKey[recipeKey].gates.includes(gate)) {
            removedRecipesByKey[recipeKey].gates.push(gate);
          }
        }
      }
      
      // Build display list maintaining order from programStartRecipes
      // Each recipe gets a _stableColorIndex so colors don't shift when incoming recipes are inserted
      const displayList = [];
      const addedRecipeKeys = new Set();
      
      // Find any incoming recipes from queue (for batch limit transitions)
      // These should be placed directly after their corresponding finishing recipe
      const incomingRecipes = backendActiveRecipes.filter(r => r._isIncomingFromQueue);
      
      // First, go through programStartRecipes to maintain original order
      const programStart = backendProgramStartRecipes || [];
      let stableColorIdx = 0;
      for (const refRecipe of programStart) {
        const refKey = getRecipeCompositeKey(refRecipe);
        const name = refRecipe.recipeName;
        
        // Check if this recipe has removed/transitioning gates
        const removedEntry = removedRecipesByKey[refKey];
        const activeRecipe = backendActiveRecipes.find(r => {
          // Exact composite key match (normal case - gates haven't changed)
          if (getRecipeCompositeKey(r) === refKey) return true;
          // During batch limit transitions, gates change:
          // - Shrink: gates freed to the incoming recipe
          // - Grow: gained gates from another finishing recipe (incoming→finishing cascade)
          // Match if at least one original gate is still present in the recipe
          if (r.recipeName === refRecipe.recipeName && (r.batchLimitTransitioning || r.isFinishing)) {
            const currentGateSet = new Set(r.gates || []);
            return (refRecipe.gates || []).some(g => currentGateSet.has(g));
          }
          // Match incoming recipes that gained additional gates during batch limit transition
          // Their key changed (more gates), but they still correspond to this programStartRecipe entry
          if (r.recipeName === refRecipe.recipeName && r._isIncomingFromQueue && !r.batchLimitTransitioning) {
            if (refRecipe.orderId) return r.orderId === refRecipe.orderId;
            const refGateSet = new Set(refRecipe.gates || []);
            return (refRecipe.gates || []).some(g => (r.gates || []).includes(g));
          }
          return false;
        });
        
        // If this recipe is now an incoming replacement during a batch limit transition,
        // don't display it at its original position - it will be placed after the finishing recipe
        if (activeRecipe && activeRecipe._isIncomingFromQueue && !activeRecipe.batchLimitTransitioning) {
          stableColorIdx++;
          continue;
        }
        
        if (removedEntry && !activeRecipe) {
          // Full recipe removal OR edit (replacement with different recipe)
          displayList.push({ ...removedEntry, _stableColorIndex: stableColorIdx });
          addedRecipeKeys.add(refKey);
          
          // Check if this is an EDIT: gates have a NEW different recipe in activeRecipes
          // Only mark as replacement if the gate is still transitioning
          const removedGates = removedEntry.gates;
          const replacementRecipes = new Map(); // Map of recipeKey -> recipe with matching gates
          
          for (const gate of removedGates) {
            // Only consider gates that are still transitioning
            if (!backendTransitioningGates.includes(gate)) continue;
            
            const newRecipeForGate = backendActiveRecipes.find(r => 
              r.gates?.includes(gate) && getRecipeCompositeKey(r) !== refKey
            );
            if (newRecipeForGate) {
              const newKey = getRecipeCompositeKey(newRecipeForGate);
              if (!addedRecipeKeys.has(newKey)) {
                // Track this as a replacement recipe
                if (!replacementRecipes.has(newKey)) {
                  replacementRecipes.set(newKey, {
                    ...newRecipeForGate,
                    _isReplacementRecipe: true,
                    _replacesRecipe: name,
                    _stableColorIndex: stableColorIdx, // Inherit the replaced recipe's color slot
                  });
                }
              }
            }
          }
          
          // Add all replacement recipes right after the removed entry
          for (const [repKey, replacementEntry] of replacementRecipes.entries()) {
            displayList.push(replacementEntry);
            addedRecipeKeys.add(repKey);
          }
          stableColorIdx++;
        } else if (activeRecipe) {
          // Recipe is still active - add it with stable color index
          displayList.push({ ...activeRecipe, _stableColorIndex: stableColorIdx });
          addedRecipeKeys.add(refKey);
          // Also track the recipe's current key (may differ from refKey during transitions when gates change)
          const activeKey = getRecipeCompositeKey(activeRecipe);
          if (activeKey !== refKey) addedRecipeKeys.add(activeKey);
          
          // If this recipe is in batch limit transitioning (finishing),
          // insert the corresponding incoming recipe directly below it
          if (activeRecipe.batchLimitTransitioning || activeRecipe.isFinishing) {
            for (const incoming of incomingRecipes) {
              const inKey = getRecipeCompositeKey(incoming);
              if (!addedRecipeKeys.has(inKey)) {
                // Incoming recipe inherits the finishing recipe's color index
                // so it takes over the same color in both Active Orders and Dashboard
                displayList.push({ ...incoming, _stableColorIndex: stableColorIdx });
                addedRecipeKeys.add(inKey);
              }
            }
          }
          
          // If there are removed gates from this recipe, add a separate entry for them
          if (removedEntry) {
            // Create entry for removed gates with unique key
            const removedGatesEntry = {
              ...removedEntry,
              recipeName: removedEntry.recipeName, // Keep same name for display
              _isPartialRemoval: true, // Internal flag to distinguish from full removal
              _stableColorIndex: stableColorIdx,
            };
            displayList.push(removedGatesEntry);
          }
          stableColorIdx++;
        }
      }
      
      // Add any active recipes that weren't in programStartRecipes (newly added recipes)
      for (const recipe of backendActiveRecipes) {
        const key = getRecipeCompositeKey(recipe);
        if (!addedRecipeKeys.has(key)) {
          displayList.push({ ...recipe, _stableColorIndex: stableColorIdx++ });
          addedRecipeKeys.add(key);
        }
      }
      
      // Add any removed recipes that weren't in programStartRecipes (edge case)
      for (const [key, removedRecipe] of Object.entries(removedRecipesByKey)) {
        if (!addedRecipeKeys.has(key) && !removedRecipe._isPartialRemoval) {
          displayList.push({ ...removedRecipe, _stableColorIndex: stableColorIdx++ });
        }
      }
      
      // Only update state if the display list meaningfully changed
      // This prevents auto-assign from firing on every SSE event (reference-only changes)
      const fingerprint = JSON.stringify(displayList.map(r => ({
        k: getRecipeCompositeKey(r),
        g: (r.gates || []).slice().sort(),
        t: r.isRemovedTransitioning || false,
        b: r.batchLimitTransitioning || false,
        f: r.isFinishing || false,
        cb: r.completedBatches || 0,
        rb: r.requestedBatches || 0,
        iq: r._isIncomingFromQueue || false,
        p: r.paused || false,
      })));
      if (fingerprint !== prevDisplayListFingerprintRef.current) {
        prevDisplayListFingerprintRef.current = fingerprint;
        setActiveRecipes(displayList);
      }
    }
  }, [backendActiveRecipes, backendTransitioningGates, backendTransitionStartRecipes, backendProgramStartRecipes]);

  // Load recipes from database and clean up old localStorage data
  useEffect(() => {
    // Remove old activeRecipes from localStorage (backend is now source of truth)
    localStorage.removeItem('activeRecipes');
    localStorage.removeItem('assignedRecipes'); // Remove old localStorage queue
    
    // Recover any orphaned orders (status assigned but not in active/queue)
    // This prevents orders from getting "lost" after server restarts or code changes
    api.post('/machine/recover-orders').catch(err => {
      console.warn('[Setup] Order recovery failed:', err);
    });
    
    loadRecipes();
    loadSavedPrograms();
    loadOrders();
    loadOrderQueue(); // Load queue from backend
  }, []);

  // Load order queue from backend
  const loadOrderQueue = async () => {
    try {
      console.log('[Queue Debug] Loading queue from backend...');
      const response = await api.get('/machine/queue');
      console.log('[Queue Debug] Backend returned queue with', response.data.queue?.length || 0, 'items');
      if (response.data.queue) {
        // Ensure queue items have empty gates (they're waiting, not active)
        const cleanedQueue = response.data.queue.map(item => ({
          ...item,
          gates: [], // Queue items should never have gates assigned (gates are only for active)
          gatesAssigned: item.gatesAssigned || 0, // Preserve gatesAssigned count for partial assignments
        }));
        console.log('[Queue Debug] Setting queue to', cleanedQueue.length, 'items:', cleanedQueue.map(r => r.recipeName));
        // Skip the next sync since we're loading from backend
        skipNextSyncRef.current = true;
        setAssignedRecipes(sortQueueByStatus(cleanedQueue));
      }
    } catch (error) {
      console.error('Failed to load order queue:', error);
    }
  };
  
  // Sync order queue to backend whenever it changes
  const queueSyncRef = useRef(false);
  const prevQueueLengthRef = useRef(assignedRecipes.length);
  const lastQueueSyncSourceRef = useRef('unknown');
  const skipNextSyncRef = useRef(false); // Skip sync after loading from backend
  
  // Helper function to sync queue with source tracking
  const syncQueueToBackend = async (source) => {
    try {
      console.log(`[Queue Debug] Syncing queue to backend (source: ${source}). Length:`, assignedRecipes.length);
      await api.post('/machine/queue', { queue: assignedRecipes, source });
      console.log('[Setup] Order queue synced to backend successfully');
    } catch (error) {
      console.error('[Setup] Failed to sync order queue:', error);
    }
  };
  
  useEffect(() => {
    // Log every queue change with stack trace for debugging
    const prevLength = prevQueueLengthRef.current;
    const newLength = assignedRecipes.length;
    
    if (prevLength !== newLength) {
      console.warn(`[Queue Debug] Queue length changed: ${prevLength} → ${newLength} (last source: ${lastQueueSyncSourceRef.current})`);
      console.warn('[Queue Debug] New queue contents:', assignedRecipes.map(r => ({ name: r.recipeName, orderId: r.orderId, minGates: r.minGates })));
      if (newLength === 0 && prevLength > 0) {
        console.error('[Queue Debug] ⚠️ QUEUE WAS EMPTIED! Last source:', lastQueueSyncSourceRef.current);
        console.error('[Queue Debug] Stack trace:', new Error().stack);
      }
    }
    prevQueueLengthRef.current = newLength;
    
    // Skip the initial mount (queue is loaded from backend)
    if (!queueSyncRef.current) {
      queueSyncRef.current = true;
      console.log('[Setup] Initial mount - skipping queue sync. Queue length:', assignedRecipes.length);
      return;
    }
    
    // Skip sync if we just loaded from backend (prevents overwriting backend changes)
    if (skipNextSyncRef.current) {
      skipNextSyncRef.current = false;
      console.log('[Setup] Skipping queue sync - data was just loaded from backend');
      return;
    }
    
    syncQueueToBackend(lastQueueSyncSourceRef.current || 'useEffect_sync');
  }, [assignedRecipes]);
  
  // Helper to set queue with source tracking
  const setAssignedRecipesWithSource = (newQueue, source) => {
    lastQueueSyncSourceRef.current = source;
    setAssignedRecipes(newQueue);
  };

  // Sync frontend queue from backend order queue (received via SSE machine:state-changed)
  // This is the most reliable sync mechanism - fires on EVERY backend queue change.
  // IMPORTANT: pass backendActiveRecipes directly to sortQueueByStatus because
  // the local activeRecipes state lags behind by one render cycle.
  const prevBackendQueueStrRef = useRef(null);
  useEffect(() => {
    if (!backendOrderQueue) return;
    
    const queueStr = JSON.stringify(backendOrderQueue);
    if (queueStr !== prevBackendQueueStrRef.current) {
      prevBackendQueueStrRef.current = queueStr;
      
      // Clean queue items (strip gates, preserve gatesAssigned)
      const cleanedQueue = backendOrderQueue.map(item => ({
        ...item,
        gates: [], // Queue items don't have gates
        gatesAssigned: item.gatesAssigned || 0,
      }));
      
      // Sort using backendActiveRecipes (current SSE data, not stale local state)
      const sortedQueue = sortQueueByStatus(cleanedQueue, backendActiveRecipes);
      
      console.log('[Setup] Backend queue changed via SSE, syncing frontend:', sortedQueue.length, 'items');
      skipNextSyncRef.current = true;
      lastQueueSyncSourceRef.current = 'backend_sse_sync';
      setAssignedRecipes(sortedQueue);
    }
  }, [backendOrderQueue]); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-sort queue whenever activeRecipes or assignedRecipes change.
  // Uses backendActiveRecipes for the most up-to-date data (local activeRecipes can lag).
  // Only actually updates state if the order is wrong (prevents infinite loop).
  useEffect(() => {
    if (assignedRecipes.length === 0) return;
    const source = backendActiveRecipes && backendActiveRecipes.length > 0
      ? backendActiveRecipes
      : activeRecipes;
    if (source.length === 0) return;
    const sorted = sortQueueByStatus(assignedRecipes, source);
    const sortedKeys = sorted.map(r => r.recipeName).join(',');
    const currentKeys = assignedRecipes.map(r => r.recipeName).join(',');
    if (sortedKeys !== currentKeys) {
      skipNextSyncRef.current = true;
      lastQueueSyncSourceRef.current = 'active_recipes_resort';
      setAssignedRecipes(sorted);
    }
  }, [activeRecipes, backendActiveRecipes, assignedRecipes]); // eslint-disable-line react-hooks/exhaustive-deps

  // NOTE: assignedRecipes persistence is handled by AppContext
  // NOTE: activeRecipes is NOT persisted to localStorage
  // Backend machine_state is the single source of truth for active recipes
  // Only assignedRecipes is persisted locally (user selections before activation)
  
  // Keep a ref to the latest queue for use in auto-assign (avoids stale closures)
  const assignedRecipesRef = useRef(assignedRecipes);
  useEffect(() => {
    assignedRecipesRef.current = assignedRecipes;
  }, [assignedRecipes]);
  
  // Auto-assign queue items to empty gates when gates become available
  // This runs when activeRecipes changes and there are both queue items and empty gates
  // ONLY auto-assigns when machine is RUNNING
  // Supports partial activation: assigns as many gates as available
  // RATE LIMITED: Only allows one auto-assign per 2 seconds to prevent loops
  const autoAssignRef = useRef(false);
  const lastAutoAssignTimeRef = useRef(0);
  useEffect(() => {
    const tryAutoAssign = async () => {
      // Prevent concurrent auto-assign attempts
      if (autoAssignRef.current) {
        console.log('[Auto-assign] Skipped - already running');
        return;
      }
      
      // Rate limit: Only allow auto-assign once every 2 seconds
      const now = Date.now();
      const timeSinceLastAssign = now - lastAutoAssignTimeRef.current;
      if (timeSinceLastAssign < 2000) {
        console.log('[Auto-assign] Skipped - rate limited (last assign', timeSinceLastAssign, 'ms ago)');
        return;
      }
      
      // ONLY auto-assign when machine is running
      if (machineState !== 'running') {
        console.log('[Auto-assign] Skipped - machine not running:', machineState);
        return;
      }
      
      // Get latest queue from ref (avoids stale closure)
      const currentQueue = assignedRecipesRef.current;
      
      // Don't auto-assign if there are no queue items
      if (currentQueue.length === 0) return;
      
      // Calculate empty gates (only active recipes use gates, not queue)
      const currentUsedGates = activeRecipes
        .filter(r => !r.isRemovedTransitioning)
        .flatMap(r => r.gates || []);
      const availableGates = [1, 2, 3, 4, 5, 6, 7, 8].filter(g => !currentUsedGates.includes(g));
      
      // Don't auto-assign if no gates available
      if (availableGates.length === 0) return;
      
      // During batch limit transitions, allow auto-assign to truly empty gates
      // (freed gates from finishing recipes are handled by the backend, not auto-assign).
      // During normal transitions (edit/remove), block auto-assign entirely.
      const hasBatchLimitTransitioning = activeRecipes.some(r => r.batchLimitTransitioning || r.isFinishing);
      if (transitioningGates.length > 0 && !hasBatchLimitTransitioning) return;
      
      // Find the first non-halted queue item (halted items require manual re-activation)
      const firstQueueItemIndex = currentQueue.findIndex(item => item.status !== 'halted');
      if (firstQueueItemIndex < 0) {
        console.log('[Auto-assign] Skipped - all queue items are halted');
        return;
      }
      const firstQueueItem = currentQueue[firstQueueItemIndex];
      const minGatesNeeded = firstQueueItem.minGates || 1;
      
      // Calculate actual assigned gates by checking active recipes
      // Don't rely on stored gatesAssigned which could be stale
      const existingActiveRecipe = activeRecipes.find(r => {
        if (firstQueueItem.orderId) return r.orderId === firstQueueItem.orderId;
        return r.recipeName === firstQueueItem.recipeName && !r.orderId;
      });
      const alreadyAssigned = existingActiveRecipe ? (existingActiveRecipe.gates?.length || 0) : 0;
      const gatesStillNeeded = minGatesNeeded - alreadyAssigned;
      
      // If this item doesn't need more gates, skip it
      if (gatesStillNeeded <= 0) return;
      
      autoAssignRef.current = true;
      // CRITICAL: Update rate limit timestamp FIRST to prevent infinite loops on failure
      lastAutoAssignTimeRef.current = Date.now();
      
      console.log('[Setup] Auto-assign starting:', { 
        queueLength: currentQueue.length, 
        firstItem: firstQueueItem.recipeName,
        availableGates: availableGates.length,
        gatesStillNeeded 
      });
      
      try {
        // Assign as many gates as possible (up to what's still needed)
        const gatesToAssign = availableGates.slice(0, gatesStillNeeded);
        const newAssignedCount = alreadyAssigned + gatesToAssign.length;
        const isFullyAssigned = newAssignedCount >= minGatesNeeded;
        
        // Helper to get recipe key for matching
        const getRecipeKey = (r) => r.orderId 
          ? `order_${r.orderId}` 
          : `recipe_${r.recipeName}`;
        const queueItemKey = getRecipeKey(firstQueueItem);
        
        // Mark source for tracking BEFORE the state update
        lastQueueSyncSourceRef.current = isFullyAssigned ? 'auto_assign_full_remove' : 'auto_assign_partial';
        
        // Use functional update to avoid stale closure issues
        // Use captured firstQueueItemIndex to remove/update the correct queue item (skipping halted items)
        const targetIdx = firstQueueItemIndex;
        setAssignedRecipes(prevQueue => {
          console.log('[Setup] Queue update - prev length:', prevQueue.length, 'isFullyAssigned:', isFullyAssigned, 'targetIdx:', targetIdx);
          if (prevQueue.length === 0) return prevQueue; // Queue is empty, nothing to do
          
          if (isFullyAssigned) {
            // Fully assigned - remove this item from queue
            console.log('[Auto-assign] Removing item at index', targetIdx, 'from queue. New length:', prevQueue.length - 1);
            return prevQueue.filter((_, i) => i !== targetIdx);
          } else {
            // Partially assigned - update this item in queue
            console.log('[Auto-assign] Partial assignment at index', targetIdx, ', keeping in queue with updated gatesAssigned:', newAssignedCount);
            return prevQueue.map((item, i) => 
              i === targetIdx ? { ...item, gatesAssigned: newAssignedCount } : item
            );
          }
        });
        
        // Use functional update for activeRecipes - MERGE with existing if present
        setActiveRecipes(prevActive => {
          const cleanedActive = prevActive.filter(r => !r.isRemovedTransitioning);
          
          // Check if this recipe already exists in active recipes
          const existingIndex = cleanedActive.findIndex(r => getRecipeKey(r) === queueItemKey);
          
          if (existingIndex >= 0) {
            // MERGE: Add new gates to existing entry instead of creating duplicate
            const existing = cleanedActive[existingIndex];
            const mergedGates = [...(existing.gates || []), ...gatesToAssign].sort((a, b) => a - b);
            const updated = {
              ...existing,
              gates: mergedGates,
              gatesAssigned: mergedGates.length,
            };
            console.log('[Auto-assign] Merging gates with existing active recipe:', {
              recipeName: existing.recipeName,
              existingGates: existing.gates,
              newGates: gatesToAssign,
              mergedGates,
            });
            return [
              ...cleanedActive.slice(0, existingIndex),
              updated,
              ...cleanedActive.slice(existingIndex + 1)
            ];
          } else {
            // NEW: Add as new entry - explicitly preserve batch counts
            const activatedRecipe = {
              ...firstQueueItem,
              gates: gatesToAssign,
              gatesAssigned: newAssignedCount,
              completedBatches: firstQueueItem.completedBatches || 0,
              requestedBatches: firstQueueItem.requestedBatches || 0,
            };
            return [...cleanedActive, activatedRecipe];
          }
        });
        
        // Build newActiveRecipes from current state for backend sync - also handle merge
        const currentActiveClean = activeRecipes.filter(r => !r.isRemovedTransitioning);
        const existingActiveIndex = currentActiveClean.findIndex(r => getRecipeKey(r) === queueItemKey);
        let newActiveRecipes;
        if (existingActiveIndex >= 0) {
          const existing = currentActiveClean[existingActiveIndex];
          const mergedGates = [...(existing.gates || []), ...gatesToAssign].sort((a, b) => a - b);
          const updated = { ...existing, gates: mergedGates, gatesAssigned: mergedGates.length };
          newActiveRecipes = [
            ...currentActiveClean.slice(0, existingActiveIndex),
            updated,
            ...currentActiveClean.slice(existingActiveIndex + 1)
          ];
        } else {
          const activatedRecipe = { 
            ...firstQueueItem, 
            gates: gatesToAssign, 
            gatesAssigned: newAssignedCount,
            // Explicitly preserve batch counts from queue item
            completedBatches: firstQueueItem.completedBatches || 0,
            requestedBatches: firstQueueItem.requestedBatches || 0,
          };
          newActiveRecipes = [...currentActiveClean, activatedRecipe];
        }
        
        // SAFEGUARD: Verify newActiveRecipes includes all gates that are currently
        // in use. If the closure captured stale activeRecipes, the backend would reject
        // this anyway, but aborting here prevents transient state corruption.
        const recipesForBackend = cleanRecipesForBackend(newActiveRecipes);
        const newGatesSet = new Set(recipesForBackend.flatMap(r => r.gates || []));
        const currentUsedGatesCopy = activeRecipes
          .filter(r => !r.isRemovedTransitioning)
          .flatMap(r => r.gates || []);
        const missingGates = currentUsedGatesCopy.filter(g => !newGatesSet.has(g));
        if (missingGates.length > 0) {
          console.error('[Auto-assign] ABORTED - newActiveRecipes would drop gates:', missingGates,
            'currentActive gates:', currentUsedGatesCopy, 'new gates:', [...newGatesSet]);
          // Revert queue change (restore the item we just removed/updated)
          setAssignedRecipes(assignedRecipesRef.current);
          autoAssignRef.current = false;
          return;
        }

        // Sync to backend - use autoAssign flag to allow adding to empty gates while running
        await api.post('/machine/recipes', { 
          recipes: recipesForBackend,
          autoAssign: true
        });
        console.log('[Setup] Auto-assigned queue item to gates:', { 
          recipeName: firstQueueItem.recipeName,
          gates: gatesToAssign, 
          isFullyAssigned,
          assigned: newAssignedCount,
          needed: minGatesNeeded 
        });
        
        // Update order status if it's an order
        if (firstQueueItem.orderId) {
          await api.put(`/orders/${firstQueueItem.orderId}/status`, { status: 'assigned' });
          loadOrders();
        }
        
        console.log('[Auto-assign] Completed successfully. Queue after:', assignedRecipesRef.current.length);
      } catch (error) {
        console.error('[Setup] Auto-assign failed:', error);
      } finally {
        autoAssignRef.current = false;
      }
    };
    
    tryAutoAssign();
  }, [activeRecipes, transitioningGates, machineState]); // eslint-disable-line react-hooks/exhaustive-deps

  // Handle recipe completions - refresh orders list
  // Queue sync is now handled by the backendOrderQueue SSE sync above
  useEffect(() => {
    if (!recipeCompletions || recipeCompletions.length === 0) return;
    
    for (const completion of recipeCompletions) {
      console.log('[Setup] Recipe completed (backend handled):', completion.recipeName, completion.completedBatches, '/', completion.requestedBatches);
      
      // Refresh orders list if an order was completed
      if (completion.orderId) {
        loadOrders();
      }
    }
    
    // Clear the completions - backend already removed the recipe
    clearRecipeCompletions();
  }, [recipeCompletions]); // eslint-disable-line react-hooks/exhaustive-deps
  
  // Handle gate handoffs from backend (batch limit transitioning) - clear after logging
  // Queue sync is now handled by the backendOrderQueue SSE sync above
  useEffect(() => {
    if (gateHandoffs && gateHandoffs.length > 0) {
      console.log('[Setup] Gate handoff detected:', gateHandoffs);
      clearGateHandoffs();
    }
  }, [gateHandoffs]); // eslint-disable-line react-hooks/exhaustive-deps

  // Handle batch limit transition logging
  const prevBatchLimitTransKeysRef = useRef(new Set());
  useEffect(() => {
    const currentKeys = new Set(Object.keys(batchLimitTransitions));
    const hasNewTransition = [...currentKeys].some(k => !prevBatchLimitTransKeysRef.current.has(k));
    
    if (hasNewTransition) {
      console.log('[Setup] New batch limit transition detected');
      // Queue sync is now handled by the backendOrderQueue SSE sync
    }
    
    prevBatchLimitTransKeysRef.current = currentKeys;
  }, [batchLimitTransitions]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const loadOrders = async () => {
    try {
      setLoadingOrders(true);
      const response = await api.get("/orders/available");
      setOrders(response.data.orders || []);
    } catch (error) {
      console.error("Failed to load orders:", error);
      setOrders([]);
    } finally {
      setLoadingOrders(false);
    }
  };

  const loadSavedPrograms = async () => {
    try {
      setLoadingSavedPrograms(true);
      const response = await api.get("/settings/saved-programs");
      setSavedPrograms(response.data.programs || []);
    } catch (error) {
      console.error("Failed to load saved programs:", error);
      setSavedPrograms([]);
    } finally {
      setLoadingSavedPrograms(false);
    }
  };

  // Helper to get the best display name for a recipe
  // Returns displayName if available, otherwise recipeName
  const getRecipeDisplayName = (recipe) => {
    if (!recipe) return '';
    const name = recipe.displayName || recipe.display_name || recipe.recipeName || recipe.name;
    if (name) return name;
    // Fallback: show gates if no name is available (shouldn't happen but prevents empty rows)
    if (recipe.gates && recipe.gates.length > 0) {
      return `(Gates ${recipe.gates.join(', ')})`;
    }
    return '(Unknown)';
  };
  
  // Helper to get order display name (Customer + Order #) for orders, or recipe name for non-orders
  const getOrderDisplayName = (recipe) => {
    if (!recipe) return '';
    if (recipe.orderId && recipe.customerName) {
      return `${recipe.customerName} - #${recipe.orderId}`;
    }
    // Fall back to recipe name for non-order items
    return getRecipeDisplayName(recipe);
  };
  
  // Helper to generate unique recipe key (same logic as backend)
  const getRecipeKey = (recipe) => {
    if (recipe.orderId) {
      return `order_${recipe.orderId}`;
    }
    // Use sorted gates as unique identifier for non-order recipes
    const gates = (recipe.gates || []).slice().sort();
    return `recipe_${gates.join('_')}`;
  };

  // Helper to get batch count with real-time updates from SSE
  // Handles both queue items (no gates) and active items (with gates)
  const getBatchCount = (recipe) => {
    // For finishing recipes (batch limit transitioning), their gates have been handed off
    // to the incoming recipe. The SSE batch updates for those gates now contain the incoming
    // recipe's data, not the finishing recipe's. Use the recipe's own stored values directly.
    if (recipe.batchLimitTransitioning || recipe.isFinishing) {
      return {
        completed: recipe.completedBatches || 0,
        requested: recipe.requestedBatches || 0,
      };
    }
    
    // For orders, the key is always order_${orderId}
    if (recipe.orderId) {
      const orderKey = `order_${recipe.orderId}`;
      if (recipeBatchUpdates && recipeBatchUpdates[orderKey]) {
        const update = recipeBatchUpdates[orderKey];
        return {
          completed: update.completedBatches || 0,
          requested: update.requestedBatches || recipe.requestedBatches || 0,
        };
      }
      if (orderUpdates && orderUpdates[recipe.orderId]) {
        const update = orderUpdates[recipe.orderId];
        return {
          completed: update.completedBatches || 0,
          requested: update.requestedBatches || recipe.requestedBatches || 0,
        };
      }
    }
    
    // For non-orders (regular recipes):
    // Queue items have gates: [] - need to find matching active recipe by recipeName
    // Active items have gates: [1,2,3...] - use their actual key
    const hasGates = recipe.gates && recipe.gates.length > 0;
    
    if (hasGates) {
      // Active recipe with gates - use direct key lookup first
      const recipeKey = getRecipeKey(recipe);
      if (recipeBatchUpdates && recipeBatchUpdates[recipeKey]) {
        const update = recipeBatchUpdates[recipeKey];
        return {
          completed: update.completedBatches || 0,
          requested: update.requestedBatches || recipe.requestedBatches || 0,
        };
      }
      
      // FALLBACK: If gate-based key doesn't match (gates changed after re-activation),
      // try name-based lookup across all SSE batch updates
      if (recipeBatchUpdates) {
        let bestMatch = null;
        for (const [key, update] of Object.entries(recipeBatchUpdates)) {
          if (key.startsWith('order_')) continue;
          if (update.recipeName === recipe.recipeName) {
            // Prefer the most recent update (highest completedBatches)
            if (!bestMatch || (update.completedBatches || 0) > (bestMatch.completedBatches || 0)) {
              bestMatch = update;
            }
          }
        }
        if (bestMatch) {
          return {
            completed: bestMatch.completedBatches || 0,
            requested: bestMatch.requestedBatches || recipe.requestedBatches || 0,
          };
        }
      }
    } else {
      // Queue item without gates - find matching active recipe by recipeName
      // Look through all batch updates for a matching recipeName
      if (recipeBatchUpdates) {
        let bestMatch = null;
        for (const [key, update] of Object.entries(recipeBatchUpdates)) {
          if (key.startsWith('order_')) continue;
          if (update.recipeName === recipe.recipeName) {
            if (!bestMatch || (update.completedBatches || 0) > (bestMatch.completedBatches || 0)) {
              bestMatch = update;
            }
          }
        }
        if (bestMatch) {
          return {
            completed: bestMatch.completedBatches || 0,
            requested: bestMatch.requestedBatches || recipe.requestedBatches || 0,
          };
        }
      }
      
      // Also check activeRecipes directly for live batch count
      const matchingActive = activeRecipes.find(r => 
        !r.orderId && r.recipeName === recipe.recipeName
      );
      if (matchingActive && matchingActive.completedBatches !== undefined) {
        return {
          completed: matchingActive.completedBatches || 0,
          requested: matchingActive.requestedBatches || recipe.requestedBatches || 0,
        };
      }
    }
    
    // Final fallback to recipe's own batch count (also check queue for matching data)
    // This handles the case where the recipe was re-activated from queue
    const ownCompleted = recipe.completedBatches || 0;
    const ownRequested = recipe.requestedBatches || 0;
    
    // If own values are 0, check if there's a matching queue item with better data
    if (ownCompleted === 0 && !recipe.orderId) {
      const matchingQueueItem = assignedRecipes.find(q => 
        q.recipeName === recipe.recipeName && (q.completedBatches || 0) > 0
      );
      if (matchingQueueItem) {
        return {
          completed: matchingQueueItem.completedBatches || 0,
          requested: matchingQueueItem.requestedBatches || ownRequested || 0,
        };
      }
    }
    
    return {
      completed: ownCompleted,
      requested: ownRequested,
    };
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

  // Main tab: 0=Order List, 1=Recipe, 2=Program
  const mainTabFromMode = { fromOrder: 0, preset: 1, manual: 1, presetProgram: 2, manualProgram: 2 };
  const mainTabIndex = mainTabFromMode[mode] ?? 0;
  const recipeVariant = mode === 'manual' ? 'manual' : 'existing';
  const programVariant = mode === 'manualProgram' ? 'manual' : 'existing';

  const handleMainTabChange = (_e, newIndex) => {
    if (newIndex === 0) setMode('fromOrder');
    else if (newIndex === 1) setMode('preset');
    else if (newIndex === 2) setMode('presetProgram');
    setAddError("");
    resetPresetForm();
    resetManualForm();
  };

  const handleRecipeVariant = (_e, val) => {
    if (!val) return;
    setMode(val === 'existing' ? 'preset' : 'manual');
    setAddError("");
    resetPresetForm();
    resetManualForm();
  };

  const handleProgramVariant = (_e, val) => {
    if (!val) return;
    setMode(val === 'existing' ? 'presetProgram' : 'manualProgram');
    setAddError("");
    resetPresetForm();
    resetManualForm();
  };

  // Reset forms
  const resetPresetForm = () => {
    setSelectedRecipe(null);
    setPresetGates([]);
    setPresetMinGates(1);
    setPresetRequestedBatches("");
  };

  const resetManualForm = () => {
    setManualDisplayName("");
    setManualPieceMin("");
    setManualPieceMax("");
    setManualBatchWeightEnabled(false);
    setManualBatchMin("");
    setManualBatchMax("");
    setManualPieceCountEnabled(false);
    setManualPieceCountType("min");
    setManualPieceCount("");
    setManualGates([]);
    setManualMinGates(1);
    setManualRequestedBatches("");
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

  // Get used gates (from ACTIVE recipes only - queue items don't use gates)
  // Queue items should have gates: [] and are waiting to be activated
  const usedGates = activeRecipes.flatMap((r) => r.gates || []);

  // Check if all gates are already used (no available gates for new recipes)
  const allGatesUsed = [1, 2, 3, 4, 5, 6, 7, 8].every(gate => usedGates.includes(gate));
  
  // Get available (empty) gates
  const emptyGates = [1, 2, 3, 4, 5, 6, 7, 8].filter(gate => !usedGates.includes(gate));
  const hasEmptyGates = emptyGates.length > 0;
  
  // Check if active orders table is empty (determines if we show gate assignment or queue mode)
  const hasActiveOrders = activeRecipes.length > 0;
  
  // Calculate available gates (gates not yet assigned to any active order)
  const availableGates = [1, 2, 3, 4, 5, 6, 7, 8].filter(g => !usedGates.includes(g));
  
  // Queue mode only when ALL gates are occupied - if there are open gates, show gate assignment
  const isQueueMode = hasActiveOrders && availableGates.length === 0;

  // Toggle recipe favorite
  const handleToggleRecipeFavorite = async (recipeId, e) => {
    e.stopPropagation(); // Prevent dropdown selection
    try {
      await api.patch(`/settings/recipes/${recipeId}/favorite`);
      // Refresh recipes list
      const response = await api.get("/settings/recipes");
      setRecipes(response.data.recipes || []);
    } catch (error) {
      console.error("Failed to toggle recipe favorite:", error);
    }
  };

  // Open delete confirmation dialog for recipe
  const handleDeleteRecipe = (recipeId, recipeName, e) => {
    e.stopPropagation(); // Prevent dropdown selection
    setDeleteItemType('recipe');
    setDeleteItemId(recipeId);
    setDeleteItemName(recipeName);
    setDeleteDialogOpen(true);
  };

  // Toggle saved program favorite
  const handleToggleProgramFavorite = async (programId, e) => {
    e.stopPropagation(); // Prevent dropdown selection
    try {
      await api.patch(`/settings/saved-programs/${programId}/favorite`);
      // Refresh programs list
      const response = await api.get("/settings/saved-programs");
      setSavedPrograms(response.data.programs || []);
    } catch (error) {
      console.error("Failed to toggle program favorite:", error);
    }
  };

  // Open delete confirmation dialog for program
  const handleDeleteProgram = (programId, programName, e) => {
    e.stopPropagation(); // Prevent dropdown selection
    setDeleteItemType('program');
    setDeleteItemId(programId);
    setDeleteItemName(programName);
    setDeleteDialogOpen(true);
  };

  // Close delete dialog
  const handleCloseDeleteDialog = () => {
    setDeleteDialogOpen(false);
    setDeleteItemType(null);
    setDeleteItemId(null);
    setDeleteItemName("");
  };

  // Confirm delete
  const handleConfirmDelete = async () => {
    try {
      if (deleteItemType === 'recipe') {
        await api.delete(`/settings/recipes/${deleteItemId}`);
        // Refresh recipes list
        const response = await api.get("/settings/recipes");
        setRecipes(response.data.recipes || []);
        // Clear selection if deleted recipe was selected
        if (selectedRecipe?.id === deleteItemId) {
          setSelectedRecipe(null);
        }
      } else if (deleteItemType === 'program') {
        await api.delete(`/settings/saved-programs/${deleteItemId}`);
        // Refresh programs list
        const response = await api.get("/settings/saved-programs");
        setSavedPrograms(response.data.programs || []);
        // Clear selection if deleted program was selected
        if (selectedSavedProgram?.id === deleteItemId) {
          setSelectedSavedProgram(null);
        }
      }
    } catch (error) {
      console.error(`Failed to delete ${deleteItemType}:`, error);
      setAddError(`Failed to delete ${deleteItemType}. It may be in use.`);
      setTimeout(() => setAddError(""), 5000);
    }
    handleCloseDeleteDialog();
  };

  // Add preset recipe
  const handleAddPreset = async () => {
    if (!selectedRecipe) {
      setAddError("Please select a recipe");
      return;
    }

    if (!presetRequestedBatches || parseInt(presetRequestedBatches) < 1) {
      setAddError("Please specify the number of batches");
      return;
    }
    
    // Determine if sending to queue based on destination choice or lack of empty gates
    const sendToQueue = !hasEmptyGates || presetDestination === "queue";
    
    // In direct mode, require gate selection
    if (!sendToQueue && presetGates.length === 0) {
      setAddError("Please assign at least one gate");
      return;
    }

    // For queue mode, can add same recipe multiple times as separate queue entries
    // For direct mode, check if recipe already assigned or active
    if (!sendToQueue) {
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
          `Recipe "${selectedRecipe.name}" is currently active. Please remove it from Active Orders first.`
        );
        setTimeout(() => setAddError(""), 5000);
        return;
      }
    }

    const newAssignment = {
      type: "preset",
      recipeId: selectedRecipe.id,
      recipeName: selectedRecipe.name,
      displayName: selectedRecipe.display_name || null,
      params: parseRecipeName(selectedRecipe.name),
      gates: sendToQueue ? [] : presetGates,
      // New fields
      requestedBatches: parseInt(presetRequestedBatches),
      completedBatches: 0,
      // When adding to queue, use presetMinGates; when adding directly to active, use the number of gates selected
      minGates: sendToQueue ? presetMinGates : presetGates.length,
      gatesAssigned: sendToQueue ? 0 : presetGates.length,
    };

    if (sendToQueue) {
      // Add to queue
      console.log('[AddPreset] Adding to queue:', newAssignment.recipeName);
      lastQueueSyncSourceRef.current = 'handleAddPreset_add_to_queue';
      setAssignedRecipes(sortQueueByStatus([...assignedRecipes, newAssignment]));
    } else {
      // Add directly to active
      const newActiveRecipes = [...activeRecipes, newAssignment];
      setActiveRecipes(newActiveRecipes);
      
      // Sync to backend
      try {
        await api.post('/machine/recipes', { recipes: cleanRecipesForBackend(newActiveRecipes) });
      } catch (error) {
        console.error("Failed to sync recipes to backend:", error);
      }
    }
    
    resetPresetForm();
    setAddError("");
  };

  // Add order from order list
  const handleAddOrder = async () => {
    if (!selectedOrder) {
      setAddError("Please select an order");
      return;
    }
    
    // Determine if sending to queue based on destination choice or lack of empty gates
    const sendToQueue = !hasEmptyGates || orderDestination === "queue";
    
    // In direct mode, require gate selection
    if (!sendToQueue && orderGates.length === 0) {
      setAddError("Please assign at least one gate");
      return;
    }
    
    // Validate minGates
    if (orderMinGates < 1 || orderMinGates > 8) {
      setAddError("Minimum gates must be between 1 and 8");
      return;
    }

    // Check if order already in queue or active
    const isAlreadyQueued = assignedRecipes.some(
      (assigned) => assigned.orderId === selectedOrder.id
    );
    const isAlreadyActive = activeRecipes.some(
      (active) => active.orderId === selectedOrder.id
    );

    if (isAlreadyQueued || isAlreadyActive) {
      setAddError(
        `Order #${selectedOrder.id} is already ${isAlreadyQueued ? 'in queue' : 'active'}. Please remove it first.`
      );
      setTimeout(() => setAddError(""), 5000);
      return;
    }

    // Use production config if available, otherwise use original config
    const params = {
      pieceMinWeight: selectedOrder.prod_piece_min_weight_g || selectedOrder.piece_min_weight_g,
      pieceMaxWeight: selectedOrder.prod_piece_max_weight_g || selectedOrder.piece_max_weight_g,
      batchMinWeight: selectedOrder.prod_batch_min_weight_g || selectedOrder.batch_min_weight_g || 0,
      batchMaxWeight: selectedOrder.prod_batch_max_weight_g || selectedOrder.batch_max_weight_g || 0,
      countType: selectedOrder.prod_batch_type || selectedOrder.batch_type || 'NA',
      countValue: selectedOrder.prod_batch_value || selectedOrder.batch_value || 0,
    };

    const newAssignment = {
      type: "order",
      recipeId: selectedOrder.recipe_id,
      recipeName: selectedOrder.recipe_name,
      displayName: `${selectedOrder.recipe_display_name || selectedOrder.recipe_name} (${selectedOrder.customer_name} - #${selectedOrder.id})`,
      params,
      gates: sendToQueue ? [] : orderGates, // Empty gates if in queue mode
      // Order-specific fields
      orderId: selectedOrder.id,
      customerId: selectedOrder.customer_id,
      customerName: selectedOrder.customer_name,
      requestedBatches: selectedOrder.requested_batches,
      completedBatches: selectedOrder.completed_batches || 0,
      dueDate: selectedOrder.due_date,
      // Queue-specific fields
      // When adding to queue, use orderMinGates; when adding directly to active, use the number of gates selected
      minGates: sendToQueue ? orderMinGates : orderGates.length,
      gatesAssigned: sendToQueue ? 0 : orderGates.length, // Track how many gates assigned
    };

    if (sendToQueue) {
      // Add to queue
      console.log('[AddOrder] Adding order to queue:', newAssignment.orderId);
      lastQueueSyncSourceRef.current = 'handleAddOrder_add_to_queue';
      setAssignedRecipes(sortQueueByStatus([...assignedRecipes, newAssignment]));
    } else {
      // Add directly to active (when gates are available)
      const newActiveRecipes = [...activeRecipes, newAssignment];
      setActiveRecipes(newActiveRecipes);
      
      // Sync to backend
      try {
        await api.post('/machine/recipes', { recipes: cleanRecipesForBackend(newActiveRecipes) });
      } catch (error) {
        console.error("Failed to sync recipes to backend:", error);
      }
    }
    
    resetOrderForm();
    setAddError("");
    
    // Update order status on backend
    try {
      await api.put(`/orders/${selectedOrder.id}/status`, { status: 'assigned' });
      loadOrders(); // Refresh orders list
    } catch (error) {
      console.error("Failed to update order status:", error);
    }
  };

  const resetOrderForm = () => {
    setSelectedOrder(null);
    setOrderGates([]);
    setOrderMinGates(1);
  };

  const toggleOrderGate = (gate) => {
    if (orderGates.includes(gate)) {
      setOrderGates(orderGates.filter((g) => g !== gate));
    } else {
      setOrderGates([...orderGates, gate]);
    }
  };

  // Add manual recipe
  const handleAddManual = async () => {
    // Validate required fields
    if (!manualPieceMin || !manualPieceMax) {
      setAddError("Piece weight bounds are required");
      return;
    }

    if (!manualRequestedBatches || parseInt(manualRequestedBatches) < 1) {
      setAddError("Please specify the number of batches");
      return;
    }

    // Determine if sending to queue based on destination choice or lack of empty gates
    const sendToQueue = !hasEmptyGates || manualDestination === "queue";

    // In direct mode, require gate selection
    if (!sendToQueue && manualGates.length === 0) {
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

    if (manualPieceCountEnabled) {
      const countVal = parseInt(manualPieceCount);
      if (!manualPieceCount || isNaN(countVal) || countVal <= 0) {
        setAddError(`Piece count value is required when piece count constraint is enabled. Enter a value > 0 or disable the constraint.`);
      return;
      }
    }

    // Validate display name uniqueness if provided
    if (manualDisplayName && manualDisplayName.trim()) {
      const existingWithName = recipes.find(
        (r) => r.display_name && r.display_name.toLowerCase() === manualDisplayName.trim().toLowerCase()
      );
      if (existingWithName) {
        setAddError(`A recipe with the name "${manualDisplayName}" already exists. Please choose a different name.`);
        setTimeout(() => setAddError(""), 5000);
        return;
      }
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

    // For queue mode, can add same recipe multiple times
    // For direct mode, check if recipe already assigned or active
    if (!sendToQueue) {
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
          `Recipe "${recipeName}" is currently active. Please remove it from Active Orders first.`
        );
        setTimeout(() => setAddError(""), 5000);
        return;
      }
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
          display_name: manualDisplayName || null, // Optional custom name
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
      displayName: manualDisplayName || null, // Optional custom name
      params,
      gates: sendToQueue ? [] : manualGates,
      // New fields
      requestedBatches: parseInt(manualRequestedBatches),
      completedBatches: 0,
      // When adding to queue, use manualMinGates; when adding directly to active, use the number of gates selected
      minGates: sendToQueue ? manualMinGates : manualGates.length,
      gatesAssigned: sendToQueue ? 0 : manualGates.length,
    };

    if (sendToQueue) {
      // Add to queue
      console.log('[AddManual] Adding manual recipe to queue:', newAssignment.recipeName);
      lastQueueSyncSourceRef.current = 'handleAddManual_add_to_queue';
      setAssignedRecipes(sortQueueByStatus([...assignedRecipes, newAssignment]));
    } else {
      // Add directly to active
      const newActiveRecipes = [...activeRecipes, newAssignment];
      setActiveRecipes(newActiveRecipes);
      
      // Sync to backend
      try {
        await api.post('/machine/recipes', { recipes: cleanRecipesForBackend(newActiveRecipes) });
      } catch (error) {
        console.error("Failed to sync recipes to backend:", error);
      }
    }
    
    resetManualForm();
    setAddError("");
  };

  // ============== SAVED PROGRAM HANDLERS ==============

  // Check if a saved program can be added (both tables must be empty)
  const canAddSavedProgram = assignedRecipes.length === 0 && 
    activeRecipes.filter(r => !r.isRemovedTransitioning && !r._isPartialRemoval).length === 0;

  // Add saved program to assigned recipes
  const handleAddSavedProgram = () => {
    if (!selectedSavedProgram) {
      setAddError("Please select a program");
      return;
    }

    if (!canAddSavedProgram) {
      setAddError("Cannot add program: Please remove all assigned and active recipes first");
      return;
    }

    // Convert saved program recipes to assigned recipes format
    const programRecipesToAdd = selectedSavedProgram.recipes.map(recipe => ({
      type: "preset",
      recipeId: recipe.recipe_id,
      recipeName: recipe.recipe_name,
      displayName: recipe.display_name,
      params: recipe.params,
      gates: recipe.gates,
    }));

    console.log('[LoadSavedProgram] Loading saved program with', programRecipesToAdd.length, 'recipes');
    lastQueueSyncSourceRef.current = 'handleLoadSavedProgram';
    setAssignedRecipes(programRecipesToAdd);
    setSelectedSavedProgram(null);
    setAddError("");
  };

  // ============== MANUAL PROGRAM HANDLERS ==============

  // Get gates already used in the manual program
  const programUsedGates = programRecipes.flatMap(r => r.gates);

  // Toggle gate for manual program recipe
  const toggleProgramGate = (gate) => {
    if (programGates.includes(gate)) {
      setProgramGates(programGates.filter(g => g !== gate));
    } else {
      setProgramGates([...programGates, gate]);
    }
  };

  // Add recipe to manual program
  const handleAddRecipeToProgram = () => {
    if (!programSelectedRecipe) {
      setProgramError("Please select a recipe");
      return;
    }

    if (programGates.length === 0) {
      setProgramError("Please assign at least one gate");
      return;
    }

    // Check for gate conflicts
    const conflictingGates = programGates.filter(g => programUsedGates.includes(g));
    if (conflictingGates.length > 0) {
      setProgramError(`Gate(s) ${conflictingGates.join(', ')} already assigned to another recipe`);
      return;
    }

    const newRecipe = {
      recipeId: programSelectedRecipe.id,
      recipeName: programSelectedRecipe.name,
      displayName: programSelectedRecipe.display_name || null,
      params: parseRecipeName(programSelectedRecipe.name),
      gates: programGates,
    };

    setProgramRecipes([...programRecipes, newRecipe]);
    setProgramSelectedRecipe(null);
    setProgramGates([]);
    setProgramError("");
  };

  // Remove recipe from manual program
  const handleRemoveProgramRecipe = (index) => {
    setProgramRecipes(programRecipes.filter((_, i) => i !== index));
  };

  // Save and add manual program
  const handleSaveAndAddProgram = async () => {
    if (programRecipes.length === 0) {
      setProgramError("Please add at least one recipe to the program");
      return;
    }

    if (!programName.trim()) {
      setProgramError("Please enter a program name");
      return;
    }

    if (!canAddSavedProgram) {
      setProgramError("Cannot add program: Please remove all assigned and active recipes first");
      return;
    }

    try {
      // Save program to database
      const response = await api.post("/settings/saved-programs", {
        name: `program_${Date.now()}`, // Unique internal name
        display_name: programName.trim(),
        recipes: programRecipes,
      });

      console.log("[Setup] Saved program created:", response.data);

      // Reload saved programs list
      await loadSavedPrograms();

      // Add program recipes to assigned recipes
      const recipesToAdd = programRecipes.map(recipe => ({
        type: "preset",
        recipeId: recipe.recipeId,
        recipeName: recipe.recipeName,
        displayName: recipe.displayName,
        params: recipe.params,
        gates: recipe.gates,
      }));

      console.log('[SaveProgram] Adding manual program with', recipesToAdd.length, 'recipes');
      lastQueueSyncSourceRef.current = 'handleSaveProgram';
      setAssignedRecipes(recipesToAdd);

      // Reset manual program form
      setProgramRecipes([]);
      setProgramName("");
      setProgramSelectedRecipe(null);
      setProgramGates([]);
      setProgramError("");

    } catch (error) {
      console.error("[Setup] Failed to save program:", error);
      setProgramError(error.response?.data?.message || "Failed to save program");
    }
  };

  // Reset manual program form
  const resetProgramForm = () => {
    setProgramRecipes([]);
    setProgramName("");
    setProgramSelectedRecipe(null);
    setProgramGates([]);
    setProgramError("");
  };


  // Skip waiting for more gates: keep running on current gates, just remove from queue
  const handleSkipQueueItem = async (index) => {
    const recipe = assignedRecipes[index];
    if (!recipe) return;
    console.log('[SkipQueueItem] Stop waiting for more gates:', recipe.recipeName || recipe.orderId, 'at index:', index);

    lastQueueSyncSourceRef.current = 'handleSkipQueueItem';
    setAssignedRecipes(assignedRecipes.filter((_, i) => i !== index));
  };

  // Remove assigned recipe from queue (delete from queue entirely)
  const handleRemoveAssignment = async (index) => {
    const removedRecipe = assignedRecipes[index];
    console.log('[RemoveAssignment] Removing recipe from queue:', removedRecipe?.recipeName, 'at index:', index);
    
    // If it's an order, restore its status to 'received'
    if (removedRecipe && removedRecipe.orderId) {
      try {
        const response = await api.put(`/orders/${removedRecipe.orderId}/status`, { status: 'received' });
        if (response.data && response.data.order) {
          console.log(`Order ${removedRecipe.orderId} status restored to received`);
        }
        // Refresh orders list so the order reappears
        await loadOrders();
      } catch (error) {
        console.error("Failed to restore order status:", error);
        setEditAssignedError(`Failed to restore order status: ${error.message || 'Unknown error'}`);
        setTimeout(() => setEditAssignedError(""), 5000);
        // Still remove from UI even if API fails
      }
    }
    
    // Mark source for tracking BEFORE state update
    lastQueueSyncSourceRef.current = 'handleRemoveAssignment_REMOVE_button';
    setAssignedRecipes(assignedRecipes.filter((_, i) => i !== index));
    setEditingAssignedIndex(null);
    setEditAssignedData(null);
  };
  
  // Drag and drop state for queue reordering
  const [draggedQueueIndex, setDraggedQueueIndex] = useState(null);
  const [dragOverQueueIndex, setDragOverQueueIndex] = useState(null);
  const [queueDragWarning, setQueueDragWarning] = useState(null); // Snackbar warning for invalid drag
  
  // Expanded row state for Order Queue details dropdown
  const [expandedQueueIndex, setExpandedQueueIndex] = useState(null);
  
  const handleQueueDragStart = (e, index) => {
    setDraggedQueueIndex(index);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', index);
  };
  
  const handleQueueDragEnd = () => {
    setDraggedQueueIndex(null);
    setDragOverQueueIndex(null);
  };
  
  const handleQueueDragOver = (e, index) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverQueueIndex !== index) {
      setDragOverQueueIndex(index);
    }
  };
  
  const handleQueueDragLeave = () => {
    setDragOverQueueIndex(null);
  };
  
  // Helper to get the effective display status of a queue item
  const getQueueItemStatus = (item) => {
    const existingActiveRecipe = activeRecipes.find(r => {
      if (item.orderId) return r.orderId === item.orderId;
      return r.recipeName === item.recipeName && !r.orderId;
    });
    const actualAssigned = existingActiveRecipe ? (existingActiveRecipe.gates?.length || 0) : 0;
    if (actualAssigned > 0) return 'assigned';
    if (item.status) return item.status;
    const batchInfo = getBatchCount(item);
    return batchInfo.completed > 0 ? 'halted' : 'queued';
  };
  
  const handleQueueDrop = (e, dropIndex) => {
    e.preventDefault();
    setDragOverQueueIndex(null);
    if (draggedQueueIndex === null || draggedQueueIndex === dropIndex) return;
    
    const draggedItem = assignedRecipes[draggedQueueIndex];
    const draggedStatus = getQueueItemStatus(draggedItem);
    
    // Enforce ordering rule: halted items cannot be placed above queued/assigned items
    if (draggedStatus === 'halted') {
      // Find the last non-halted item in the list (excluding the dragged item)
      const otherItems = assignedRecipes.filter((_, i) => i !== draggedQueueIndex);
      const lastNonHaltedIdx = otherItems.reduce((lastIdx, item, idx) => {
        const status = getQueueItemStatus(item);
        return (status !== 'halted') ? idx : lastIdx;
      }, -1);
      
      // Adjust dropIndex relative to the full list
      // If the drop position would place the halted item above a non-halted item, reject
      const adjustedDropIndex = dropIndex > draggedQueueIndex ? dropIndex : dropIndex;
      const newQueue = [...assignedRecipes];
      const [removed] = newQueue.splice(draggedQueueIndex, 1);
      const actualDropIndex = adjustedDropIndex > draggedQueueIndex ? adjustedDropIndex - 1 : adjustedDropIndex;
      
      // Check if any queued/assigned item would be below us after the drop
      const wouldViolate = newQueue.some((item, idx) => {
        if (idx < actualDropIndex) return false;
        return getQueueItemStatus(item) !== 'halted';
      });
      
      if (wouldViolate) {
        setQueueDragWarning('Cannot move a halted item above queued items. Please change its status to "Queued" first via the edit button.');
        setDraggedQueueIndex(null);
        return;
      }
      
      // OK to drop - restore and do the move
      newQueue.splice(actualDropIndex, 0, removed);
      console.log('[DragDrop] Reordered queue. Moved halted item from', draggedQueueIndex, 'to', adjustedDropIndex);
      lastQueueSyncSourceRef.current = 'handleQueueDrop_drag_reorder';
      setAssignedRecipes(newQueue);
      setDraggedQueueIndex(null);
      return;
    }
    
    const newQueue = [...assignedRecipes];
    const [removed] = newQueue.splice(draggedQueueIndex, 1);
    newQueue.splice(dropIndex, 0, removed);
    console.log('[DragDrop] Reordered queue. Moved item from', draggedQueueIndex, 'to', dropIndex);
    // Mark source for tracking BEFORE state update
    lastQueueSyncSourceRef.current = 'handleQueueDrop_drag_reorder';
    setAssignedRecipes(newQueue);
    setDraggedQueueIndex(null);
  };
  
  // Activate a queue item - move it from queue to active orders on empty gates
  // Supports partial activation: if recipe needs 3 gates but only 2 available,
  // it adds to Active with 2 gates and stays in Queue with "2/3" assigned
  const handleActivateFromQueue = async (index) => {
    const recipe = assignedRecipes[index];
    const minGatesNeeded = recipe.minGates || 1;
    
    // Check if this recipe already has gates in activeRecipes (partial activation scenario)
    // If not in active, gatesAssigned should be 0 regardless of what's stored
    const existingActiveRecipe = activeRecipes.find(r => {
      if (recipe.orderId) return r.orderId === recipe.orderId;
      return r.recipeName === recipe.recipeName && !r.orderId;
    });
    const alreadyAssigned = existingActiveRecipe ? (existingActiveRecipe.gates?.length || 0) : 0;
    const gatesStillNeeded = minGatesNeeded - alreadyAssigned;
    
    // Get currently empty gates (only active recipes use gates, not queue)
    const currentUsedGates = activeRecipes.flatMap((r) => r.gates || []);
    const availableGates = [1, 2, 3, 4, 5, 6, 7, 8].filter(gate => !currentUsedGates.includes(gate));
    
    if (availableGates.length === 0) {
      setAddError("No empty gates available");
      setTimeout(() => setAddError(""), 5000);
      return;
    }
    
    // Assign as many gates as possible (up to what's still needed)
    const gatesToAssign = availableGates.slice(0, gatesStillNeeded);
    const newAssignedCount = alreadyAssigned + gatesToAssign.length;
    const isFullyAssigned = newAssignedCount >= minGatesNeeded;
    
    // Create activated recipe with assigned gates
    const activatedRecipe = {
      ...recipe,
      gates: gatesToAssign,
      gatesAssigned: newAssignedCount,
    };
    
    let newQueue;
    if (isFullyAssigned) {
      // Fully assigned - remove from queue entirely
      newQueue = assignedRecipes.filter((_, i) => i !== index);
      console.log('[Activate] Fully assigned - removing from queue. New length:', newQueue.length);
    } else {
      // Partially assigned - keep in queue but move to position 1 with updated count
      const updatedQueueItem = {
        ...recipe,
        gatesAssigned: newAssignedCount,
        status: 'assigned', // Update status to show it's being processed
      };
      // Remove from current position and add to front
      newQueue = assignedRecipes.filter((_, i) => i !== index);
      newQueue.unshift(updatedQueueItem);
      console.log('[Activate] Partial assignment - keeping in queue at position 1. Assigned:', newAssignedCount, '/', minGatesNeeded);
    }
    // Mark source for tracking BEFORE state update
    lastQueueSyncSourceRef.current = isFullyAssigned ? 'handleActivateFromQueue_full' : 'handleActivateFromQueue_partial';
    setAssignedRecipes(newQueue);
    
    // Add to active recipes
    const newActiveRecipes = [...activeRecipes, activatedRecipe];
    setActiveRecipes(newActiveRecipes);
    
    // Sync to backend
    try {
      await api.post('/machine/recipes', { recipes: cleanRecipesForBackend(newActiveRecipes) });
      console.log('[Setup] Activated recipe from queue', { 
        gates: gatesToAssign, 
        isFullyAssigned,
        assigned: newAssignedCount,
        needed: minGatesNeeded 
      });
    } catch (error) {
      console.error('[Setup] Failed to activate recipe from queue:', error);
      setAddError("Failed to activate recipe");
      setTimeout(() => setAddError(""), 5000);
    }
    
    // Refresh orders list (backend sets status to in-production via POST /machine/recipes)
    if (recipe.orderId) {
      try {
        loadOrders();
      } catch (error) {
        console.error("Failed to refresh orders:", error);
      }
    }
  };

  // Start editing assigned recipe
  const handleEditAssigned = (index) => {
    const recipe = assignedRecipes[index];
    if (!recipe) return;
    
    // Determine current display status
    const existingActiveRecipe = activeRecipes.find(r => {
      if (recipe.orderId) return r.orderId === recipe.orderId;
      return r.recipeName === recipe.recipeName && !r.orderId;
    });
    const actualAssigned = existingActiveRecipe ? (existingActiveRecipe.gates?.length || 0) : 0;
    let currentStatus = recipe.status;
    if (actualAssigned > 0) {
      currentStatus = 'assigned';
    } else if (!currentStatus) {
      const batchInfo = getBatchCount(recipe);
      currentStatus = batchInfo.completed > 0 ? 'halted' : 'queued';
    }
    
    const batchInfo = getBatchCount(recipe);
    const completed = batchInfo.completed || 0;
    const requested = batchInfo.requested || 0;
    const remaining = requested > 0 ? Math.max(1, requested - completed) : 8;
    const maxGates = Math.min(8, remaining);
    
    setEditingAssignedIndex(index);
    setEditAssignedData({
      pieceMinWeight: recipe.params?.pieceMinWeight || '',
      pieceMaxWeight: recipe.params?.pieceMaxWeight || '',
      batchMinWeight: recipe.params?.batchMinWeight || '',
      batchMaxWeight: recipe.params?.batchMaxWeight || '',
      countType: recipe.params?.countType || 'NA',
      countValue: recipe.params?.countValue || '',
      minGates: Math.min(recipe.minGates || 1, maxGates),
      maxGatesAllowed: maxGates,
      status: currentStatus,
      requestedBatches: recipe.requestedBatches || '',
      isOrder: !!recipe.orderId,
    });
  };

  // Cancel editing assigned recipe
  const handleCancelEditAssigned = () => {
    setEditingAssignedIndex(null);
    setEditAssignedData(null);
    setEditAssignedError("");
  };

  // Accept editing assigned recipe (queue item)
  const handleAcceptEditAssigned = () => {
    // Queue items don't have gates assigned, so no gate validation needed
    
    // Validate piece count: if type is Min/Max/Exact, value must be provided and > 0
    if (editAssignedData.countType && editAssignedData.countType !== 'NA') {
      const countVal = parseInt(editAssignedData.countValue);
      if (!editAssignedData.countValue || isNaN(countVal) || countVal <= 0) {
        setEditAssignedError(`Piece count value is required when type is "${editAssignedData.countType}". Use "NA" for no piece count constraint.`);
        setTimeout(() => setEditAssignedError(""), 5000);
        return;
      }
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
    
    // Look up the new recipe's display name from the recipes list
    let newDisplayName = null;
    let newRecipeId = recipeNameChanged ? null : oldRecipe.recipeId;
    if (recipeNameChanged) {
      const matchingRecipe = recipes.find(r => r.name === newRecipeName);
      if (matchingRecipe) {
        newDisplayName = matchingRecipe.display_name || null;
        newRecipeId = matchingRecipe.id;
      }
    } else {
      // Keep the original display name if recipe name didn't change
      newDisplayName = oldRecipe.displayName || oldRecipe.display_name || null;
    }
    
    const updatedRecipes = [...assignedRecipes];
    const updatedItem = {
      ...updatedRecipes[editingAssignedIndex],
      recipeId: newRecipeId,
      recipeName: newRecipeName,
      displayName: newDisplayName,
      params: newParams,
      minGates: Math.min(editAssignedData.minGates || 1, editAssignedData.maxGatesAllowed || 8),
      status: editAssignedData.status || 'queued',
    };
    if (!editAssignedData.isOrder && editAssignedData.requestedBatches !== '') {
      updatedItem.requestedBatches = parseInt(editAssignedData.requestedBatches) || 0;
    }
    updatedRecipes[editingAssignedIndex] = updatedItem;
    
    if (recipeNameChanged) {
      console.log(`[Setup] Assigned recipe name changed: ${oldRecipe.recipeName} → ${newRecipeName}, new displayName: ${newDisplayName}`);
    }

    console.log('[AcceptEditAssigned] Updating queue item at index:', editingAssignedIndex);
    lastQueueSyncSourceRef.current = 'handleAcceptEditAssigned';
    // Re-sort queue after status change to maintain halted-at-bottom ordering
    setAssignedRecipes(sortQueueByStatus(updatedRecipes));
    setEditingAssignedIndex(null);
    setEditAssignedData(null);
    setEditAssignedError("");
  };

  // Helper to clean recipes before sending to backend (strip frontend-only flags)
  const cleanRecipesForBackend = (recipes) => {
    return recipes
      .filter(r => !r.isRemovedTransitioning) // Don't send removed-transitioning recipes
      .map(r => {
        const { isRemovedTransitioning, ...cleanRecipe } = r;
        return cleanRecipe;
      });
  };

  // Send programs to machine (move from assigned to active)
  // NOTE: This is called by user clicking START button - it moves ALL queue items to active
  const handleSendPrograms = async () => {
    try {
      console.warn("[Queue Debug] handleSendPrograms called - moving ALL", assignedRecipes.length, "queue items to active");
      console.log("[Setup] Activating recipes:", assignedRecipes);
      
      // Move assigned recipes to active recipes (only non-removed ones from current active)
      const currentActiveClean = activeRecipes.filter(r => !r.isRemovedTransitioning);
      const newActiveRecipes = [...currentActiveClean, ...assignedRecipes];
      setActiveRecipes(newActiveRecipes);
      
      // Mark source for tracking BEFORE clearing the queue
      lastQueueSyncSourceRef.current = 'handleSendPrograms_START_button';
      setAssignedRecipes([]);
      
      // Update recipeOrderMap with order info for Dashboard display
      // Use composite key to support duplicate recipe names (order vs recipe)
      const newRecipeOrderMap = { ...context.recipeOrderMap };
      assignedRecipes.forEach(recipe => {
        // Generate composite key for this recipe
        const key = recipe.orderId 
          ? `order_${recipe.orderId}` 
          : `recipe_${(recipe.gates || []).slice().sort().join('_')}`;
        
        newRecipeOrderMap[key] = {
          recipeName: recipe.recipeName,
          orderId: recipe.orderId || null,
          customerName: recipe.customerName || null,
          requestedBatches: recipe.requestedBatches,
          completedBatches: recipe.completedBatches || 0,
          gates: recipe.gates || [],
          status: 'in-production',
        };
      });
      context.setRecipeOrderMap(newRecipeOrderMap);
      
      // Sync to backend (cleaned)
      await api.post('/machine/recipes', { recipes: cleanRecipesForBackend(newActiveRecipes) });
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
      await api.post('/machine/recipes', { recipes: cleanRecipesForBackend(activeRecipes) });
      console.log('[Setup] Synced active recipes to backend');
    } catch (error) {
      console.error('[Setup] Failed to sync active recipes:', error);
    }
  };

  // Remove active recipe (FINISH - completely removes, doesn't return to queue)
  const handleFinishActiveRecipe = async (index) => {
    // Get updated recipes without the removed one
    // Filter out removed-transitioning recipes when building the list to send to backend
    const updatedRecipes = activeRecipes
      .filter((r, i) => i !== index && !r.isRemovedTransitioning);
    
    // Push updated recipes to backend (so it knows about the removal)
    // This will trigger a program change when Start is pressed (like edit does)
    try {
      await api.post('/machine/recipes', { recipes: cleanRecipesForBackend(updatedRecipes) });
      console.log('[Setup] Updated active recipes on backend after finish');
    } catch (error) {
      console.error('[Setup] Failed to update active recipes on backend:', error);
    }
    
    // DON'T update local state here - let the sync useEffect handle it
    // The removed recipe will stay visible via transitionStartRecipes until transition completes
    setEditingActiveIndex(null);
    setEditActiveData(null);
  };
  
  // Alias for backwards compatibility
  const handleRemoveActiveRecipe = handleFinishActiveRecipe;

  // Pause/resume a recipe
  const handleToggleRecipePause = async (index) => {
    const recipe = activeRecipes[index];
    if (!recipe) return;
    const newPaused = !recipe.paused;
    try {
      await api.post('/machine/pause-recipe', {
        recipeName: recipe.recipeName,
        orderId: recipe.orderId || null,
        paused: newPaused,
      });
    } catch (error) {
      console.error('[Setup] Failed to toggle recipe pause:', error);
    }
  };

  // Pause/resume a gate
  const handleToggleGatePause = async (gate) => {
    const isPaused = (backendPausedGates || []).includes(gate);
    try {
      await api.post('/machine/pause-gate', { gate, paused: !isPaused });
    } catch (error) {
      console.error('[Setup] Failed to toggle gate pause:', error);
    }
  };

  // Finish recipe while machine is stopped - operator has physically cleared the batch
  const handleFinishWhileStopped = async (index) => {
    const recipe = activeRecipes[index];
    if (!recipe) return;

    const updatedRecipes = activeRecipes.filter((_, i) => i !== index);

    try {
      await api.post('/machine/recipes', { recipes: cleanRecipesForBackend(updatedRecipes) });
      console.log('[Setup] Finished recipe while stopped:', recipe.recipeName || recipe.orderId);
    } catch (error) {
      console.error('[Setup] Failed to finish recipe while stopped:', error);
    }

    if (recipe.orderId) {
      try {
        await api.put(`/orders/${recipe.orderId}/status`, { status: 'completed' });
        loadOrders();
      } catch (error) {
        console.error('[Setup] Failed to mark order as completed:', error);
      }
    }

    setEditingActiveIndex(null);
    setEditActiveData(null);
  };

  // Skip recipe while machine is stopped - move back to order queue as halted
  const handleSkipToQueueWhileStopped = async (index) => {
    const recipe = activeRecipes[index];
    if (!recipe) return;

    const updatedRecipes = activeRecipes.filter((_, i) => i !== index);

    try {
      await api.post('/machine/recipes', { recipes: cleanRecipesForBackend(updatedRecipes) });
      console.log('[Setup] Skipped recipe to queue while stopped:', recipe.recipeName || recipe.orderId);
    } catch (error) {
      console.error('[Setup] Failed to skip recipe while stopped:', error);
      return;
    }

    const originalMinGates = recipe.minGates || recipe.gates?.length || 1;
    const completedBatches = recipe.completedBatches || 0;
    const requestedBatches = recipe.requestedBatches || 0;
    const remainingBatches = requestedBatches > 0 ? Math.max(1, requestedBatches - completedBatches) : originalMinGates;
    const adjustedMinGates = Math.min(originalMinGates, remainingBatches);

    const existingQueueIndex = assignedRecipes.findIndex(qItem => {
      if (recipe.orderId && qItem.orderId) return qItem.orderId === recipe.orderId;
      if (!recipe.orderId && !qItem.orderId) return qItem.recipeName === recipe.recipeName;
      return false;
    });

    lastQueueSyncSourceRef.current = 'handleSkipToQueueWhileStopped';

    if (existingQueueIndex >= 0) {
      const existingEntry = assignedRecipes[existingQueueIndex];
      const mergedCompletedBatches = Math.max(recipe.completedBatches || 0, existingEntry.completedBatches || 0);
      const mergedEntry = {
        ...existingEntry,
        gates: [],
        gatesAssigned: 0,
        completedBatches: mergedCompletedBatches,
        minGates: adjustedMinGates,
        status: 'halted',
      };
      const newQueue = [...assignedRecipes];
      newQueue[existingQueueIndex] = mergedEntry;
      setAssignedRecipes(sortQueueByStatus(newQueue));
    } else {
      const queuedRecipe = {
        ...recipe,
        gates: [],
        gatesAssigned: 0,
        minGates: adjustedMinGates,
        status: 'halted',
      };
      setAssignedRecipes(sortQueueByStatus([...assignedRecipes, queuedRecipe]));
    }

    if (recipe.orderId) {
      try {
        await api.put(`/orders/${recipe.orderId}/status`, { status: 'halted' });
        loadOrders();
      } catch (error) {
        console.error('[Setup] Failed to update order status:', error);
      }
    }

    setEditingActiveIndex(null);
    setEditActiveData(null);
  };

  // Move active recipe back to queue (REMOVE - removes from active but returns to queue)
  const handleMoveToQueue = async (index) => {
    const recipe = activeRecipes[index];
    
    // Get updated recipes without the removed one
    let updatedRecipes = activeRecipes
      .filter((r, i) => i !== index && !r.isRemovedTransitioning);
    
    // If removing a finishing recipe (batch limit transition), clean up transition flags
    // from the remaining recipes (the incoming recipe becomes normal)
    const isFinishingRecipe = recipe.batchLimitTransitioning || recipe.isFinishing;
    if (isFinishingRecipe) {
      updatedRecipes = updatedRecipes.map(r => {
        const cleaned = { ...r };
        delete cleaned._isIncomingFromQueue;
        delete cleaned._queueBatchId;
        delete cleaned.batchLimitTransitioning;
        delete cleaned.isFinishing;
        return cleaned;
      });
    }
    
    // Push updated recipes to backend
    // Use immediateRemoval flag for finishing recipes with empty gates to skip transition tracking
    try {
      await api.post('/machine/recipes', { 
        recipes: cleanRecipesForBackend(updatedRecipes),
        immediateRemoval: isFinishingRecipe,
      });
      console.log('[Setup] Removed active recipe to move to queue', isFinishingRecipe ? '(immediate, finishing recipe)' : '');
    } catch (error) {
      console.error('[Setup] Failed to update active recipes on backend:', error);
      return;
    }
    
    // Calculate minGates: cap at remaining batches so we don't overshoot the target.
    // e.g. 9/10 completed with original 2 gates → only 1 batch remaining → minGates = 1
    const originalMinGates = recipe.minGates || recipe.gates?.length || 1;
    const completedBatches = recipe.completedBatches || 0;
    const requestedBatches = recipe.requestedBatches || 0;
    const remainingBatches = requestedBatches > 0 ? Math.max(1, requestedBatches - completedBatches) : originalMinGates;
    const adjustedMinGates = Math.min(originalMinGates, remainingBatches);
    
    // Check if this recipe already exists in the queue (e.g., partially assigned)
    // Match by orderId for orders, or by recipeName for non-orders
    const existingQueueIndex = assignedRecipes.findIndex(qItem => {
      if (recipe.orderId && qItem.orderId) return qItem.orderId === recipe.orderId;
      if (!recipe.orderId && !qItem.orderId) return qItem.recipeName === recipe.recipeName;
      return false;
    });
    
    lastQueueSyncSourceRef.current = 'handleMoveToQueue_REMOVE_button';
    
    if (existingQueueIndex >= 0) {
      // Recipe already in queue (was partially assigned) - merge: update existing entry
      // Keep the existing queue entry but update its completedBatches and reset assigned count
      const existingEntry = assignedRecipes[existingQueueIndex];
      const mergedCompletedBatches = Math.max(recipe.completedBatches || 0, existingEntry.completedBatches || 0);
      const mergedRequested = recipe.requestedBatches || existingEntry.requestedBatches || 0;
      const mergedRemaining = mergedRequested > 0 ? Math.max(1, mergedRequested - mergedCompletedBatches) : (existingEntry.minGates || 1);
      const mergedMinGates = Math.min(existingEntry.minGates || 1, mergedRemaining);
      const mergedEntry = {
        ...existingEntry,
        gates: [],
        gatesAssigned: 0,
        completedBatches: mergedCompletedBatches,
        minGates: mergedMinGates,
        status: 'halted',
      };
      const newQueue = [...assignedRecipes];
      newQueue[existingQueueIndex] = mergedEntry;
      console.log('[MoveToQueue] Merged with existing queue entry:', mergedEntry.recipeName, 'at index:', existingQueueIndex, 'minGates:', mergedMinGates);
      setAssignedRecipes(sortQueueByStatus(newQueue));
    } else {
      // Recipe not in queue - add as new entry
      const queuedRecipe = {
        ...recipe,
        gates: [], // Clear gates since it's going back to queue
        gatesAssigned: 0, // Reset assigned gates count
        minGates: adjustedMinGates,
        status: 'halted', // Mark as halted since it was removed mid-production
      };
      console.log('[MoveToQueue] Adding new queue entry:', queuedRecipe.recipeName, 'minGates:', adjustedMinGates, '(original:', originalMinGates, ', remaining batches:', remainingBatches, ')');
      setAssignedRecipes(sortQueueByStatus([...assignedRecipes, queuedRecipe]));
    }
    
    // Update order status if it's an order
    if (recipe.orderId) {
      try {
        await api.put(`/orders/${recipe.orderId}/status`, { status: 'halted' });
        loadOrders();
      } catch (error) {
        console.error("Failed to update order status:", error);
      }
    }
    
    setEditingActiveIndex(null);
    setEditActiveData(null);
  };

  // Start editing active recipe
  const handleEditActive = (index) => {
    const recipe = activeRecipes[index];
    if (!recipe) return;
    setEditingActiveIndex(index);
    setEditActiveData({
      pieceMinWeight: recipe.params?.pieceMinWeight || '',
      pieceMaxWeight: recipe.params?.pieceMaxWeight || '',
      batchMinWeight: recipe.params?.batchMinWeight || '',
      batchMaxWeight: recipe.params?.batchMaxWeight || '',
      countType: recipe.params?.countType || 'NA',
      countValue: recipe.params?.countValue || '',
      gates: recipe.gates,
      requestedBatches: recipe.requestedBatches || '',
      isOrder: !!recipe.orderId,
    });
  };

  // Cancel editing active recipe
  const handleCancelEditActive = () => {
    setEditingActiveIndex(null);
    setEditActiveData(null);
    setEditActiveError("");
  };

  // Open skip transition dialog
  const handleOpenSkipDialog = (recipeIndex) => {
    setSkipRecipeIndex(recipeIndex);
    setSkipDialogOpen(true);
  };

  // Close skip transition dialog
  const handleCloseSkipDialog = () => {
    setSkipDialogOpen(false);
    setSkipRecipeIndex(null);
  };

  // Confirm skip transition - force complete batches on all transitioning gates for this recipe
  const handleConfirmSkip = async () => {
    if (skipRecipeIndex === null) return;
    
    const recipe = activeRecipes[skipRecipeIndex];
    if (!recipe) {
      handleCloseSkipDialog();
      return;
    }
    
    // Find all gates for this recipe that are currently transitioning
    const gatesToSkip = recipe.gates.filter(gate => transitioningGates.includes(gate));
    
    if (gatesToSkip.length === 0) {
      handleCloseSkipDialog();
      return;
    }
    
    try {
      // Call backend to force-complete batches on these gates
      for (const gate of gatesToSkip) {
        await api.post('/machine/skip-transition', { gate });
      }
      console.log(`[Setup] Skipped transition for gates: ${gatesToSkip.join(', ')}`);
    } catch (error) {
      console.error('[Setup] Failed to skip transition:', error);
      setEditActiveError(`Failed to skip transition: ${error.response?.data?.message || error.message}`);
      setTimeout(() => setEditActiveError(""), 5000);
    }
    
    handleCloseSkipDialog();
  };

  // Accept editing active recipe
  const handleAcceptEditActive = async () => {
    // Validate at least one gate is selected
    if (!editActiveData.gates || editActiveData.gates.length === 0) {
      setEditActiveError("Please select at least one gate.");
      setTimeout(() => setEditActiveError(""), 5000);
      return;
    }

    // Validate piece count: if type is Min/Max/Exact, value must be provided and > 0
    if (editActiveData.countType && editActiveData.countType !== 'NA') {
      const countVal = parseInt(editActiveData.countValue);
      if (!editActiveData.countValue || isNaN(countVal) || countVal <= 0) {
        setEditActiveError(`Piece count value is required when type is "${editActiveData.countType}". Use "NA" for no piece count constraint.`);
        setTimeout(() => setEditActiveError(""), 5000);
        return;
      }
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
    
    // Look up the new recipe's display name from the recipes list
    let newDisplayName = null;
    let newRecipeId = recipeNameChanged ? null : oldRecipe.recipeId;
    if (recipeNameChanged) {
      const matchingRecipe = recipes.find(r => r.name === newRecipeName);
      if (matchingRecipe) {
        newDisplayName = matchingRecipe.display_name || null;
        newRecipeId = matchingRecipe.id;
      }
    } else {
      // Keep the original display name if recipe name didn't change
      newDisplayName = oldRecipe.displayName || oldRecipe.display_name || null;
    }
    
    const updatedRecipes = [...activeRecipes];
    const updatedActiveItem = {
      ...updatedRecipes[editingActiveIndex],
      recipeId: newRecipeId,
      recipeName: newRecipeName,
      displayName: newDisplayName,
      params: newParams,
      gates: editActiveData.gates
    };
    if (!editActiveData.isOrder && editActiveData.requestedBatches !== '') {
      updatedActiveItem.requestedBatches = parseInt(editActiveData.requestedBatches) || 0;
    }
    updatedRecipes[editingActiveIndex] = updatedActiveItem;
    
    if (recipeNameChanged) {
      console.log(`[Setup] Recipe name changed: ${oldRecipe.recipeName} → ${newRecipeName}, new displayName: ${newDisplayName}`);
    }

    // Push updated recipes to backend (so it knows about the edit)
    try {
      await api.post('/machine/recipes', { recipes: cleanRecipesForBackend(updatedRecipes) });
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

  // Show server offline screen if not connected
  if (!machineConnected) {
    return <ServerOffline title="Setup" />;
  }

  return (
    <Box m="20px">
      <Header title="Setup" subtitle="Set up production" />

      <Box 
        mt="54px"
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
          <Tabs
            value={mainTabIndex}
            onChange={handleMainTabChange}
            variant="fullWidth"
            sx={{
              mb: 1,
              '& .MuiTab-root': {
                fontWeight: 'bold',
                fontSize: '14px',
                textTransform: 'none',
                color: colors.grey[500],
                alignItems: 'flex-start',
                justifyContent: 'flex-start',
                pl: 1,
              },
              '& .Mui-selected': {
                color: `${colors.tealAccent[500]} !important`,
              },
              '& .MuiTabs-indicator': {
                backgroundColor: colors.tealAccent[500],
                height: 3,
                borderRadius: '3px 3px 0 0',
              },
            }}
          >
            <Tab label="Order List" />
            <Tab label="Recipe" />
            <Tab label="Program" />
          </Tabs>

          {/* Sub-variant toggle for Recipe tab */}
          {mainTabIndex === 1 && (
            <Box display="flex" justifyContent="flex-start" mb={1}>
              <ToggleButtonGroup
                value={recipeVariant}
                exclusive
                onChange={handleRecipeVariant}
                size="small"
                sx={{
                  '& .MuiToggleButton-root': {
                    textTransform: 'none',
                    fontWeight: 500,
                    fontSize: '13px',
                    px: 2.5,
                    py: 0.5,
                    border: `1px solid ${colors.grey[300]}`,
                    color: colors.grey[500],
                    '&.Mui-selected': {
                      backgroundColor: colors.tealAccent[500],
                      color: '#fff',
                      borderColor: colors.tealAccent[500],
                      '&:hover': {
                        backgroundColor: colors.tealAccent[600],
                      },
                    },
                  },
                }}
              >
                <ToggleButton value="existing">Existing</ToggleButton>
                <ToggleButton value="manual">Manual</ToggleButton>
              </ToggleButtonGroup>
            </Box>
          )}

          {/* Sub-variant toggle for Program tab */}
          {mainTabIndex === 2 && (
            <Box display="flex" justifyContent="flex-start" mb={1}>
              <ToggleButtonGroup
                value={programVariant}
                exclusive
                onChange={handleProgramVariant}
                size="small"
                sx={{
                  '& .MuiToggleButton-root': {
                    textTransform: 'none',
                    fontWeight: 500,
                    fontSize: '13px',
                    px: 2.5,
                    py: 0.5,
                    border: `1px solid ${colors.grey[300]}`,
                    color: colors.grey[500],
                    '&.Mui-selected': {
                      backgroundColor: colors.tealAccent[500],
                      color: '#fff',
                      borderColor: colors.tealAccent[500],
                      '&:hover': {
                        backgroundColor: colors.tealAccent[600],
                      },
                    },
                  },
                }}
              >
                <ToggleButton value="existing">Existing</ToggleButton>
                <ToggleButton value="manual">Manual</ToggleButton>
              </ToggleButtonGroup>
            </Box>
          )}

          {/* Pre-specified Program Selection */}
          {mode === "presetProgram" && (
            <Box mt={2} display="flex" flexDirection="column" gap={2}>
              {!canAddSavedProgram && machineState !== "running" ? (
                <Typography variant="body2" sx={{ color: colors.redAccent[500] }}>
                  To add a program, first remove all active and assigned recipes.
                </Typography>
              ) : !canAddSavedProgram ? null : (
                <>
                  <Autocomplete
                    options={savedPrograms}
                    getOptionLabel={(option) => 
                      option.display_name 
                        ? `${option.display_name}` 
                        : option.name
                    }
                    renderOption={(props, option) => {
                      const { key, ...otherProps } = props;
                      return (
                        <li key={option.id} {...otherProps} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <Box sx={{ display: 'flex', alignItems: 'center', flex: 1, minWidth: 0 }}>
                            {option.is_favorite ? (
                              <StarIcon sx={{ color: colors.tealAccent[500], fontSize: '18px', mr: 1 }} />
                            ) : null}
                            <Typography noWrap sx={{ flex: 1 }}>
                              {option.display_name || option.name}
                            </Typography>
                            <Typography variant="caption" sx={{ ml: 1, color: colors.grey[500], flexShrink: 0 }}>
                              ({option.recipes?.length || 0} recipes)
                            </Typography>
                          </Box>
                          <Box sx={{ display: 'flex', ml: 1, flexShrink: 0 }}>
                            <Tooltip title={option.is_favorite ? "Remove from favorites" : "Add to favorites"}>
                              <IconButton
                                size="small"
                                onClick={(e) => handleToggleProgramFavorite(option.id, e)}
                                sx={{ p: 0.5 }}
                              >
                                {option.is_favorite ? (
                                  <StarIcon sx={{ fontSize: '18px', color: colors.tealAccent[500] }} />
                                ) : (
                                  <StarBorderIcon sx={{ fontSize: '18px', color: colors.grey[500] }} />
                                )}
                              </IconButton>
                            </Tooltip>
                            <Tooltip title="Delete program">
                              <IconButton
                                size="small"
                                onClick={(e) => handleDeleteProgram(option.id, option.display_name || option.name, e)}
                                sx={{ p: 0.5 }}
                              >
                                <DeleteOutlineIcon sx={{ fontSize: '18px', color: colors.redAccent[500] }} />
                              </IconButton>
                            </Tooltip>
                          </Box>
                        </li>
                      );
                    }}
                    value={selectedSavedProgram}
                    onChange={(event, newValue) => setSelectedSavedProgram(newValue)}
                    loading={loadingSavedPrograms}
                    renderInput={(params) => (
                      <TextField
                        {...params}
                        label="Select Program"
                        color="secondary"
                        placeholder="Type to search..."
                      />
                    )}
                    sx={{ width: "100%" }}
                  />

                  <Button
                    variant="contained"
                    color="secondary"
                    onClick={handleAddSavedProgram}
                    disabled={!selectedSavedProgram}
                  >
                    Add Program
                  </Button>
                </>
              )}
            </Box>
          )}

          {/* Preset Recipe Selection */}
          {mode === "preset" && (
            <Box mt={2} display="flex" flexDirection="column" gap={2}>
              <Autocomplete
                options={recipes.filter(
                  (recipe) =>
                        !assignedRecipes.some((assigned) => assigned.recipeName === recipe.name) &&
                        !activeRecipes.some((active) => active.recipeName === recipe.name)
                    )}
                    getOptionLabel={(option) => 
                      option.display_name 
                        ? `${option.display_name} (${option.name})` 
                        : option.name
                    }
                    renderOption={(props, option) => {
                      const { key, ...otherProps } = props;
                      return (
                        <li key={option.id} {...otherProps} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <Box sx={{ display: 'flex', alignItems: 'center', flex: 1, minWidth: 0 }}>
                            {option.is_favorite ? (
                              <StarIcon sx={{ color: colors.tealAccent[500], fontSize: '18px', mr: 1 }} />
                            ) : null}
                            <Typography noWrap sx={{ flex: 1 }}>
                              {option.display_name 
                                ? `${option.display_name} (${option.name})` 
                                : option.name
                              }
                            </Typography>
                          </Box>
                          <Box sx={{ display: 'flex', ml: 1, flexShrink: 0 }}>
                            <Tooltip title={option.is_favorite ? "Remove from favorites" : "Add to favorites"}>
                              <IconButton
                                size="small"
                                onClick={(e) => handleToggleRecipeFavorite(option.id, e)}
                                sx={{ p: 0.5 }}
                              >
                                {option.is_favorite ? (
                                  <StarIcon sx={{ fontSize: '18px', color: colors.tealAccent[500] }} />
                                ) : (
                                  <StarBorderIcon sx={{ fontSize: '18px', color: colors.grey[500] }} />
                                )}
                              </IconButton>
                            </Tooltip>
                            <Tooltip title="Delete recipe">
                              <IconButton
                                size="small"
                                onClick={(e) => handleDeleteRecipe(option.id, option.display_name || option.name, e)}
                                sx={{ p: 0.5 }}
                              >
                                <DeleteOutlineIcon sx={{ fontSize: '18px', color: colors.redAccent[500] }} />
                              </IconButton>
                            </Tooltip>
                          </Box>
                        </li>
                      );
                    }}
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
                  {/* Number of Batches */}
                  <TextField
                    label="Number of Batches"
                    type="number"
                    color="secondary"
                    fullWidth
                    value={presetRequestedBatches}
                    onChange={(e) => setPresetRequestedBatches(e.target.value)}
                    inputProps={{ min: 1 }}
                    required
                  />
                  
                  {/* Destination Radio - Show only when there are empty gates */}
                  {hasEmptyGates && (
                    <Box>
                      <Typography variant="body1" fontWeight="500" sx={{ mb: 0.5 }}>
                        Send to:
                      </Typography>
                      <RadioGroup
                        row
                        value={presetDestination}
                        onChange={(e) => setPresetDestination(e.target.value)}
                      >
                        <FormControlLabel
                          value="active"
                          control={<Radio color="secondary" size="small" />}
                          label="Active Orders"
                        />
                        <FormControlLabel
                          value="queue"
                          control={<Radio color="secondary" size="small" />}
                          label="Order Queue"
                        />
                      </RadioGroup>
                    </Box>
                  )}
                  
                  {/* Gate Assignment - Show when sending to Active Orders */}
                  {hasEmptyGates && presetDestination === "active" && (
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
                  
                  {/* Min Gates - Show when sending to queue (no empty gates or queue selected) */}
                  {(!hasEmptyGates || presetDestination === "queue") && (
                    <Box display="flex" alignItems="center" gap={2}>
                      <Typography variant="body1" fontWeight="500">
                        Minimum Gates:
                      </Typography>
                      <TextField
                        size="small"
                        value={presetMinGates}
                        onChange={(e) => {
                          const val = e.target.value;
                          // Allow empty for typing, validate on blur
                          if (val === '') {
                            setPresetMinGates('');
                          } else {
                            const num = parseInt(val);
                            if (!isNaN(num) && num >= 1 && num <= 8) {
                              setPresetMinGates(num);
                            }
                          }
                        }}
                        onBlur={(e) => {
                          // Ensure valid value on blur
                          const num = parseInt(e.target.value);
                          if (isNaN(num) || num < 1) setPresetMinGates(1);
                          else if (num > 8) setPresetMinGates(8);
                        }}
                        sx={{ width: '80px' }}
                        color="secondary"
                      />
                    </Box>
                  )}
                </>
              )}

              <Button
                variant="contained"
                color="secondary"
                onClick={handleAddPreset}
                disabled={!selectedRecipe || !presetRequestedBatches || (hasEmptyGates && presetDestination === "active" && presetGates.length === 0)}
              >
                {(!hasEmptyGates || presetDestination === "queue") ? 'Add to Order Queue' : 'Add to Active Orders'}
              </Button>
            </Box>
          )}

          {/* From Order List */}
          {mode === "fromOrder" && (
            <Box mt={2} display="flex" flexDirection="column" gap={2}>
              {orders.length === 0 ? (
                <Typography variant="body2" sx={{ color: colors.grey[600] }}>
                  No orders available for assignment. Orders must be in "Received" status.
                </Typography>
              ) : (
                <>
                  {/* Orders Table */}
                  <Paper 
                    elevation={0} 
                    sx={{ 
                      border: `1px solid ${theme.palette.mode === 'dark' ? 'inherit' : colors.grey[300]}`,
                      borderRadius: '8px',
                      overflow: 'hidden',
                      backgroundColor: theme.palette.mode === 'dark' ? colors.primary[300] : 'inherit',
                      display: 'flex',
                      flexDirection: 'column',
                    }}
                  >
                    <Box sx={{ flexShrink: 0, overflowX: 'hidden', backgroundColor: theme.palette.mode === 'dark' ? colors.primary[200] : colors.primary[200] }}>
                      <Table size="small" sx={{ tableLayout: 'fixed', width: olScrollbarW ? `calc(100% - ${olScrollbarW}px)` : '100%' }}>
                        <colgroup>
                          <col style={{ width: '12%' }} />
                          <col style={{ width: '22%' }} />
                          <col style={{ width: 'auto' }} />
                          <col style={{ width: '14%' }} />
                          <col style={{ width: '16%' }} />
                        </colgroup>
                        <TableHead>
                          <TableRow>
                            {['Order', 'Customer', 'Recipe', 'Batches', 'Due Date'].map(col => (
                              <TableCell key={col} sx={{
                                fontWeight: 'bold',
                                color: theme.palette.mode === 'dark' ? colors.grey[800] : colors.grey[800],
                                borderBottom: `2px solid ${theme.palette.mode === 'dark' ? colors.grey[500] : colors.grey[300]}`,
                                backgroundColor: theme.palette.mode === 'dark' ? colors.primary[200] : colors.primary[200],
                                py: 1.5,
                              }}>{col}</TableCell>
                            ))}
                          </TableRow>
                        </TableHead>
                      </Table>
                    </Box>
                    <Box ref={orderListBodyRef} sx={{ maxHeight: 258, overflowY: 'auto', overflowX: 'hidden' }}>
                      <Table size="small" sx={{ tableLayout: 'fixed' }}>
                        <colgroup>
                          <col style={{ width: '12%' }} />
                          <col style={{ width: '22%' }} />
                          <col style={{ width: 'auto' }} />
                          <col style={{ width: '14%' }} />
                          <col style={{ width: '16%' }} />
                        </colgroup>
                        <TableBody>
                          {orders.map((order) => (
                            <TableRow
                              key={order.id}
                              hover
                              selected={selectedOrder?.id === order.id}
                              onClick={() => {
                                setSelectedOrder(order);
                                setOrderGates([]);
                              }}
                              sx={{
                                cursor: 'pointer',
                                '&.Mui-selected, &.Mui-selected:hover': {
                                  backgroundColor: theme.palette.mode === 'dark' ? colors.tealAccent[700] : colors.tealAccent[100],
                                },
                              }}
                            >
                              <TableCell sx={{ borderBottom: `1px solid ${theme.palette.mode === 'dark' ? colors.grey[400] : colors.grey[200]}`, py: 1.5 }}>
                                <Typography variant="body2" fontWeight="bold" color={colors.grey[600]}>
                                  {order.id}
                                </Typography>
                              </TableCell>
                              <TableCell sx={{ borderBottom: `1px solid ${theme.palette.mode === 'dark' ? colors.grey[400] : colors.grey[200]}`, py: 1.5 }}>
                                <Typography variant="body2">{order.customer_name}</Typography>
                              </TableCell>
                              <TableCell sx={{ borderBottom: `1px solid ${theme.palette.mode === 'dark' ? colors.grey[400] : colors.grey[200]}`, py: 1.5 }}>
                                <Typography variant="body2" fontWeight="500">
                                  {order.recipe_display_name || order.recipe_name}
                                </Typography>
                              </TableCell>
                              <TableCell sx={{ borderBottom: `1px solid ${theme.palette.mode === 'dark' ? colors.grey[400] : colors.grey[200]}`, py: 1.5 }}>
                                <Typography variant="body2">{order.requested_batches}</Typography>
                              </TableCell>
                              <TableCell sx={{ borderBottom: `1px solid ${theme.palette.mode === 'dark' ? colors.grey[400] : colors.grey[200]}`, py: 1.5 }}>
                                <Typography variant="body2">
                                  {order.due_date ? new Date(order.due_date).toLocaleDateString() : '-'}
                                </Typography>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </Box>
                  </Paper>

                  {/* Destination Radio - Show only when there are empty gates */}
                  {selectedOrder && hasEmptyGates && (
                    <Box>
                      <Typography variant="body1" fontWeight="500" sx={{ mb: 0.5 }}>
                        Send to:
                      </Typography>
                      <RadioGroup
                        row
                        value={orderDestination}
                        onChange={(e) => setOrderDestination(e.target.value)}
                      >
                        <FormControlLabel
                          value="active"
                          control={<Radio color="secondary" size="small" />}
                          label="Active Orders"
                        />
                        <FormControlLabel
                          value="queue"
                          control={<Radio color="secondary" size="small" />}
                          label="Order Queue"
                        />
                      </RadioGroup>
                    </Box>
                  )}
                  
                  {/* Gate Assignment - Show when sending to Active Orders */}
                  {selectedOrder && hasEmptyGates && orderDestination === "active" && (
                    <Box>
                      <Typography variant="body1" fontWeight="500" sx={{ mb: 1 }}>
                        Assign to Gates:
                      </Typography>
                      <Box display="grid" gridTemplateColumns="repeat(4, 1fr)" gap={1}>
                        {Array.from({ length: 8 }, (_, i) => i + 1).map((gate) => (
                          <FormControlLabel
                            key={gate}
                            control={
                              <Checkbox
                                checked={orderGates.includes(gate)}
                                onChange={() => toggleOrderGate(gate)}
                                disabled={usedGates.includes(gate)}
                                color="secondary"
                              />
                            }
                            label={`Gate ${gate}`}
                          />
                        ))}
                      </Box>
                    </Box>
                  )}
                  
                  {/* Min Gates - Show when sending to queue (no empty gates or queue selected) */}
                  {selectedOrder && (!hasEmptyGates || orderDestination === "queue") && (
                    <Box display="flex" alignItems="center" gap={2}>
                      <Typography variant="body1" fontWeight="500">
                        Minimum Gates:
                      </Typography>
                      <TextField
                        size="small"
                        value={orderMinGates}
                        onChange={(e) => {
                          const val = e.target.value;
                          if (val === '') {
                            setOrderMinGates('');
                          } else {
                            const num = parseInt(val);
                            if (!isNaN(num) && num >= 1 && num <= 8) {
                              setOrderMinGates(num);
                            }
                          }
                        }}
                        onBlur={(e) => {
                          const num = parseInt(e.target.value);
                          if (isNaN(num) || num < 1) setOrderMinGates(1);
                          else if (num > 8) setOrderMinGates(8);
                        }}
                        sx={{ width: '80px' }}
                        color="secondary"
                      />
                    </Box>
                  )}

                  <Button
                    variant="contained"
                    color="secondary"
                    onClick={handleAddOrder}
                    disabled={!selectedOrder || (hasEmptyGates && orderDestination === "active" && orderGates.length === 0)}
                  >
                    {(!hasEmptyGates || orderDestination === "queue") ? 'Add to Order Queue' : 'Add to Active Orders'}
                  </Button>
                </>
              )}
            </Box>
          )}

          {/* Manual Setup */}
          {mode === "manual" && (
            <Box mt={2} display="flex" flexDirection="column" gap={2}>
              {/* Recipe Name (Optional) */}
              <TextField
                label="Recipe Name (optional)"
                color="secondary"
                fullWidth
                value={manualDisplayName}
                onChange={(e) => setManualDisplayName(e.target.value)}
                placeholder=""
              />

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

              {/* Number of Batches */}
              <TextField
                label="Number of Batches"
                type="number"
                color="secondary"
                fullWidth
                value={manualRequestedBatches}
                onChange={(e) => setManualRequestedBatches(e.target.value)}
                inputProps={{ min: 1 }}
                required
              />

              {/* Destination Radio - Show only when there are empty gates */}
              {hasEmptyGates && (
                <Box>
                  <Typography variant="body1" fontWeight="500" sx={{ mb: 0.5 }}>
                    Send to:
                  </Typography>
                  <RadioGroup
                    row
                    value={manualDestination}
                    onChange={(e) => setManualDestination(e.target.value)}
                  >
                    <FormControlLabel
                      value="active"
                      control={<Radio color="secondary" size="small" />}
                      label="Active Orders"
                    />
                    <FormControlLabel
                      value="queue"
                      control={<Radio color="secondary" size="small" />}
                      label="Order Queue"
                    />
                  </RadioGroup>
                </Box>
              )}

              {/* Gate Assignment - Show when sending to Active Orders */}
              {hasEmptyGates && manualDestination === "active" && (
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
                </>
              )}
              
              {/* Min Gates - Show when sending to queue (no empty gates or queue selected) */}
              {(!hasEmptyGates || manualDestination === "queue") && (
                <Box display="flex" alignItems="center" gap={2}>
                  <Typography variant="body1" fontWeight="500">
                    Minimum Gates:
                  </Typography>
                  <TextField
                    size="small"
                    value={manualMinGates}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val === '') {
                        setManualMinGates('');
                      } else {
                        const num = parseInt(val);
                        if (!isNaN(num) && num >= 1 && num <= 8) {
                          setManualMinGates(num);
                        }
                      }
                    }}
                    onBlur={(e) => {
                      const num = parseInt(e.target.value);
                      if (isNaN(num) || num < 1) setManualMinGates(1);
                      else if (num > 8) setManualMinGates(8);
                    }}
                    sx={{ width: '80px' }}
                    color="secondary"
                  />
                </Box>
              )}

              <Button
                variant="contained"
                color="secondary"
                onClick={handleAddManual}
                disabled={!manualPieceMin || !manualPieceMax || !manualRequestedBatches || (hasEmptyGates && manualDestination === "active" && manualGates.length === 0) || (!manualBatchWeightEnabled && !manualPieceCountEnabled)}
              >
                {(!hasEmptyGates || manualDestination === "queue") ? 'Add to Order Queue' : 'Add to Active Orders'}
              </Button>

              {addError && (
                <Typography variant="body2" sx={{ color: colors.redAccent[500] }}>
                  {addError}
                    </Typography>
              )}
            </Box>
          )}

          {/* Manual Program Creation */}
          {mode === "manualProgram" && (
            <Box mt={2} display="flex" flexDirection="column" gap={2}>
              {!canAddSavedProgram && machineState !== "running" ? (
                <Typography variant="body2" sx={{ color: colors.redAccent[500] }}>
                  To create and add a program, first remove all active and assigned recipes.
                </Typography>
              ) : !canAddSavedProgram ? null : (
                <>
                  {/* Recipe Selection for Program */}
                  <Autocomplete
                    options={recipes.filter(
                      (recipe) => !programRecipes.some((pr) => pr.recipeName === recipe.name)
                    )}
                    getOptionLabel={(option) => 
                      option.display_name 
                        ? `${option.display_name} (${option.name})` 
                        : option.name
                    }
                    renderOption={(props, option) => (
                      <li {...props} key={option.id}>
                        {option.display_name 
                          ? `${option.display_name} (${option.name})` 
                          : option.name
                        }
                      </li>
                    )}
                    value={programSelectedRecipe}
                    onChange={(event, newValue) => setProgramSelectedRecipe(newValue)}
                    loading={loadingRecipes}
                    renderInput={(params) => (
                      <TextField
                        {...params}
                        label="Select Recipe"
                        color="secondary"
                        placeholder="Type to search..."
                      />
                    )}
                    sx={{ width: "100%" }}
                  />

                  {/* Gate Assignment for Program Recipe */}
                  {programSelectedRecipe && (
                    <>
                      <Typography variant="h6">
                        Assign to Gates:
                      </Typography>
                      <Box display="grid" gridTemplateColumns="repeat(4, 1fr)" gap={1}>
                        {Array.from({ length: 8 }, (_, i) => i + 1).map((gate) => (
                          <FormControlLabel
                            key={gate}
                            control={
                              <Checkbox
                                checked={programGates.includes(gate)}
                                onChange={() => toggleProgramGate(gate)}
                                disabled={programUsedGates.includes(gate)}
                                color="secondary"
                              />
                            }
                            label={`Gate ${gate}`}
                          />
                        ))}
                      </Box>

                    <Button
                        variant="outlined"
                      color="secondary"
                        onClick={handleAddRecipeToProgram}
                        disabled={programGates.length === 0}
                    >
                        Add Recipe to Program
                    </Button>
                    </>
                  )}

                  {/* Program Recipes Table */}
                  {programRecipes.length > 0 && (
                    <Paper sx={{ p: 2, mt: 2, backgroundColor: colors.primary[200] }}>
                      <Box display="grid" gridTemplateColumns="250px repeat(8, 20px) 100px" gap="2px">
                        {/* Header */}
                        <Box sx={{ p: 0.5, display: 'flex', alignItems: 'center' }}>
                          <Typography variant="body2" fontWeight="bold">Recipe</Typography>
                        </Box>
                        {[1, 2, 3, 4, 5, 6, 7, 8].map(gate => (
                          <Box key={gate} sx={{ p: 0.5, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <Typography variant="body2" fontWeight="bold">{gate}</Typography>
                          </Box>
                        ))}
                        <Box />

                        {/* Recipe rows */}
                        {programRecipes.map((recipe, i) => {
                          const recipeColor = recipeColors[i % recipeColors.length];
                          return (
                            <React.Fragment key={i}>
                              <Box sx={{ p: 0.5, display: 'flex', alignItems: 'center', height: '28px' }}>
                                <Typography variant="body2">
                                  {recipe.displayName || recipe.recipeName}
                                </Typography>
                              </Box>
                              {[1, 2, 3, 4, 5, 6, 7, 8].map(gate => (
                                <Box 
                                  key={`${i}-${gate}`} 
                  sx={{
                                    backgroundColor: recipe.gates.includes(gate) ? recipeColor : undefined,
                                    width: '20px',
                                    height: '20px',
                                    alignSelf: 'center',
                                  }}
                                />
                              ))}
                              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '28px' }}>
                    <Button
                      size="small"
                                  color="error"
                                  onClick={() => handleRemoveProgramRecipe(i)}
                                  sx={{ minWidth: 'auto', p: 0.5, fontSize: '0.7rem' }}
                    >
                                  REMOVE
                    </Button>
                  </Box>
                            </React.Fragment>
                          );
                        })}
                </Box>
                    </Paper>
                  )}

                  {/* Program Name */}
                  {programRecipes.length > 0 && (
                    <>
                      <TextField
                        label="Program Name"
                        color="secondary"
                        fullWidth
                        value={programName}
                        onChange={(e) => setProgramName(e.target.value)}
                        placeholder="Enter a name for this program"
                        sx={{ mt: 3 }}
                      />

                    <Button
                      variant="contained"
                      color="secondary"
                        onClick={handleSaveAndAddProgram}
                        disabled={!programName.trim()}
                    >
                        Save and Add Program
                    </Button>
                    </>
                  )}

                  {programError && (
                <Typography variant="body2" sx={{ color: colors.redAccent[500] }}>
                      {programError}
                </Typography>
                  )}
                </>
              )}
            </Box>
          )}
        </Box>

          {/* Machine Controls (Right) */}
          <Box sx={{ width: "50%", alignSelf: 'flex-start' }}>
            <MachineControls 
              layout="horizontal" 
              activeRecipesCount={activeRecipes.length}
              machineStateOverride={setupMachineHook}
              onStop={() => {
                console.log('[MachineControls.onStop] Machine stopped. Recipes remain in Active Orders for operator cleanup.');
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
            <WeightControls colors={colors} />
          </Box>
        </Box>

        {/* Order Queue - Below Recipe Selection */}
        <Box mt={6}>
          <Typography
            variant="h4"
            fontWeight="bold"
            sx={{ mb: 2, color: colors.tealAccent[500] }}
          >
            Order Queue ({assignedRecipes.length})
          </Typography>

          <Paper 
            elevation={0} 
            sx={{ 
              border: `1px solid ${theme.palette.mode === 'dark' ? 'inherit' : colors.grey[300]}`,
              borderRadius: '8px',
              overflow: 'hidden',
              backgroundColor: theme.palette.mode === 'dark' ? colors.primary[300] : 'inherit',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            {(() => {
              const qHdrSx = {
                fontWeight: 'bold',
                color: theme.palette.mode === 'dark' ? colors.grey[800] : colors.grey[800],
                borderBottom: `2px solid ${theme.palette.mode === 'dark' ? colors.grey[500] : colors.grey[300]}`,
                backgroundColor: theme.palette.mode === 'dark' ? colors.primary[200] : colors.primary[200],
                py: 1.5,
              };
              const qCol = (
                <colgroup>
                  <col style={{ width: '7%' }} />
                  <col style={{ width: 'auto' }} />
                  <col style={{ width: '9%' }} />
                  <col style={{ width: '10%' }} />
                  <col style={{ width: '10%' }} />
                  <col style={{ width: '8%' }} />
                  <col style={{ width: '8%' }} />
                  <col style={{ width: '12%' }} />
                </colgroup>
              );
              return (<>
              <Box sx={{ flexShrink: 0, overflowX: 'hidden', backgroundColor: theme.palette.mode === 'dark' ? colors.primary[200] : colors.primary[200] }}>
                <Table size="small" sx={{ tableLayout: 'fixed', width: oqScrollbarW ? `calc(100% - ${oqScrollbarW}px)` : '100%' }}>
                  {qCol}
                  <TableHead>
                    <TableRow>
                      <TableCell sx={qHdrSx}>#</TableCell>
                      <TableCell sx={qHdrSx}>Order</TableCell>
                      <TableCell sx={qHdrSx}>Batches</TableCell>
                      <TableCell sx={qHdrSx}>Due Date</TableCell>
                      <TableCell sx={qHdrSx}>Status</TableCell>
                      <TableCell sx={qHdrSx}>Min Gates</TableCell>
                      <TableCell sx={qHdrSx}>Assigned</TableCell>
                      <TableCell sx={{ ...qHdrSx, textAlign: 'right' }}>Actions</TableCell>
                    </TableRow>
                  </TableHead>
                </Table>
              </Box>
              <Box ref={orderQueueBodyRef} sx={{ maxHeight: 398, overflowY: 'auto', overflowX: 'hidden' }}>
                <Table size="small" sx={{ tableLayout: 'fixed' }}>
                  {qCol}
                  <TableBody>
                  {assignedRecipes.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} align="center" sx={{ py: 4 }}>
                        <Typography color={colors.grey[500]}>No orders in queue</Typography>
                      </TableCell>
                    </TableRow>
                  ) : (
                    assignedRecipes.map((recipe, i) => {
                      // Show divider before first halted item
                      const queueItemStatus = getQueueItemStatus(recipe);
                      const isItemHalted = queueItemStatus === 'halted';
                      const prevItem = i > 0 ? assignedRecipes[i - 1] : null;
                      const isPrevHalted = prevItem && getQueueItemStatus(prevItem) === 'halted';
                      const isFirstHalted = isItemHalted && (i === 0 || !isPrevHalted);
                      const hasNonHaltedAbove = isFirstHalted && i > 0;
                      
                      return (
                      <React.Fragment key={i}>
                        {hasNonHaltedAbove && (
                          <TableRow>
                            <TableCell colSpan={8} sx={{ 
                              py: 0.3, 
                              px: 2,
                              borderBottom: `2px dashed ${colors.orangeAccent[500]}40`,
                              bgcolor: 'transparent',
                            }}>
                              <Typography variant="caption" sx={{ 
                                color: colors.orangeAccent[500], 
                                fontWeight: 600,
                                fontSize: '10px',
                                textTransform: 'uppercase',
                                letterSpacing: '0.5px',
                              }}>
                                Halted
                              </Typography>
                            </TableCell>
                          </TableRow>
                        )}
                        <TableRow 
                          hover
                          draggable
                          onDragStart={(e) => handleQueueDragStart(e, i)}
                          onDragEnd={handleQueueDragEnd}
                          onDragOver={(e) => handleQueueDragOver(e, i)}
                          onDragLeave={handleQueueDragLeave}
                          onDrop={(e) => handleQueueDrop(e, i)}
                          sx={{
                            cursor: 'grab',
                            opacity: draggedQueueIndex === i ? 0.5 : (isItemHalted ? 0.7 : 1),
                            backgroundColor: dragOverQueueIndex === i && draggedQueueIndex !== i 
                              ? colors.tealAccent[500] 
                              : isItemHalted 
                                ? (theme.palette.mode === 'dark' ? 'rgba(255,165,0,0.04)' : 'rgba(255,165,0,0.03)')
                                : 'transparent',
                        '&:hover': {
                              backgroundColor: theme.palette.mode === 'dark' ? colors.primary[500] : colors.grey[100],
                              '& .MuiTableCell-root': {
                                color: theme.palette.mode === 'dark' ? colors.grey[800] : 'inherit',
                              }
                            },
                          }}
                          onClick={() => setExpandedQueueIndex(expandedQueueIndex === i ? null : i)}
                        >
                          {/* Row number, drag handle, and expand */}
                          <TableCell sx={{
                            borderBottom: `1px solid ${theme.palette.mode === 'dark' ? colors.grey[400] : colors.grey[200]}`,
                            color: theme.palette.mode === 'dark' ? colors.primary[800] : 'inherit',
                            py: 1.5,
                          }}>
                            <Box display="flex" alignItems="center" gap={0.5}>
                              <DragIndicatorIcon sx={{ fontSize: '16px', color: colors.grey[500], cursor: 'grab' }} />
                              <Typography 
                                variant="body2" 
                                sx={{ 
                                  minWidth: '18px', 
                                  fontWeight: 'bold', 
                                  color: colors.grey[600]
                                }}
                              >
                                {i + 1}
                              </Typography>
                              <IconButton size="small" sx={{ p: 0 }} onClick={(e) => { e.stopPropagation(); setExpandedQueueIndex(expandedQueueIndex === i ? null : i); }}>
                                {expandedQueueIndex === i ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
                              </IconButton>
                  </Box>
                          </TableCell>
                          
                          {/* Order name */}
                          <TableCell sx={{
                            borderBottom: `1px solid ${theme.palette.mode === 'dark' ? colors.grey[400] : colors.grey[200]}`,
                            color: theme.palette.mode === 'dark' ? colors.primary[800] : 'inherit',
                            py: 1.5,
                          }}>
                            <Typography fontWeight="600" color={colors.primary[800]}>
                              {getOrderDisplayName(recipe)}
                            </Typography>
                          </TableCell>
                          
                          {/* Batches */}
                          <TableCell sx={{
                            borderBottom: `1px solid ${theme.palette.mode === 'dark' ? colors.grey[400] : colors.grey[200]}`,
                            color: theme.palette.mode === 'dark' ? colors.primary[800] : 'inherit',
                            py: 1.5,
                          }}>
                            <Typography variant="body2">
                              {getBatchCount(recipe).completed} / {getBatchCount(recipe).requested || '-'}
                            </Typography>
                          </TableCell>
                          
                          {/* Due Date */}
                          <TableCell sx={{
                            borderBottom: `1px solid ${theme.palette.mode === 'dark' ? colors.grey[400] : colors.grey[200]}`,
                            color: theme.palette.mode === 'dark' ? colors.primary[800] : 'inherit',
                            py: 1.5,
                          }}>
                            <Typography variant="body2">
                              {recipe.dueDate ? new Date(recipe.dueDate).toLocaleDateString() : '-'}
                            </Typography>
                          </TableCell>
                          
                          {/* Status */}
                          <TableCell sx={{
                            borderBottom: `1px solid ${theme.palette.mode === 'dark' ? colors.grey[400] : colors.grey[200]}`,
                            py: 1.5,
                          }}>
                            <Chip 
                              label={(() => {
                                // Determine status based on:
                                // 1. Check if gates are assigned in active recipes → "Assigned"
                                // 2. Check explicit status
                                // 3. Fallback: has completed batches → "Halted", else "Queued"
                                const existingActiveRecipe = activeRecipes.find(r => {
                                  if (recipe.orderId) return r.orderId === recipe.orderId;
                                  return r.recipeName === recipe.recipeName && !r.orderId;
                                });
                                const actualAssigned = existingActiveRecipe ? (existingActiveRecipe.gates?.length || 0) : 0;
                                
                                let status = recipe.status;
                                if (actualAssigned > 0) {
                                  // Has gates assigned - show "Assigned"
                                  status = 'assigned';
                                } else if (!status) {
                                  const batchInfo = getBatchCount(recipe);
                                  status = batchInfo.completed > 0 ? 'halted' : 'queued';
                                }
                                return status.charAt(0).toUpperCase() + status.slice(1);
                              })()}
                              size="small"
                              sx={{ 
                                bgcolor: (() => {
                                  // Determine status for color
                                  const existingActiveRecipe = activeRecipes.find(r => {
                                    if (recipe.orderId) return r.orderId === recipe.orderId;
                                    return r.recipeName === recipe.recipeName && !r.orderId;
                                  });
                                  const actualAssigned = existingActiveRecipe ? (existingActiveRecipe.gates?.length || 0) : 0;
                                  
                                  let status = recipe.status;
                                  if (actualAssigned > 0) {
                                    status = 'assigned';
                                  } else if (!status) {
                                    const batchInfo = getBatchCount(recipe);
                                    status = batchInfo.completed > 0 ? 'halted' : 'queued';
                                  }
                                  return status === 'in-production' ? colors.tealAccent[300] :
                                         status === 'halted' ? colors.orangeAccent[500] :
                                         status === 'completed' ? colors.purpleAccent[500] :
                                         status === 'assigned' ? colors.purpleAccent[500] :
                                         colors.tealAccent[500];
                                })(),
                                color: '#fff',
                                fontWeight: 'bold',
                                fontSize: '11px',
                              }}
                            />
                          </TableCell>
                          
                          {/* Min Gates */}
                          <TableCell sx={{
                            borderBottom: `1px solid ${theme.palette.mode === 'dark' ? colors.grey[400] : colors.grey[200]}`,
                            color: theme.palette.mode === 'dark' ? colors.primary[800] : 'inherit',
                            py: 1.5,
                          }}>
                            <Typography variant="body2">{recipe.minGates || 1}</Typography>
                          </TableCell>
                          
                          {/* Gates Assigned */}
                          <TableCell sx={{
                            borderBottom: `1px solid ${theme.palette.mode === 'dark' ? colors.grey[400] : colors.grey[200]}`,
                            color: theme.palette.mode === 'dark' ? colors.primary[800] : 'inherit',
                            py: 1.5,
                          }}>
                            {(() => {
                              // Calculate actual gates assigned in active recipes
                              // Don't rely on stored gatesAssigned which could be stale
                              const existingActiveRecipe = activeRecipes.find(r => {
                                if (recipe.orderId) return r.orderId === recipe.orderId;
                                return r.recipeName === recipe.recipeName && !r.orderId;
                              });
                              const actualAssigned = existingActiveRecipe ? (existingActiveRecipe.gates?.length || 0) : 0;
                              const minGates = recipe.minGates || 1;
                              
                              return (
                                <Typography variant="body2" color={
                                  actualAssigned >= minGates 
                                    ? colors.tealAccent[500] 
                                    : actualAssigned === 0
                                      ? 'inherit'
                                      : colors.orangeAccent[500]
                                }>
                                  {actualAssigned}/{minGates}
                                </Typography>
                              );
                            })()}
                          </TableCell>
                          
                          {/* Actions - Icon buttons */}
                          <TableCell 
                            sx={{
                              borderBottom: `1px solid ${theme.palette.mode === 'dark' ? colors.grey[400] : colors.grey[200]}`,
                              py: 1.5,
                            }}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <Box display="flex" gap={0.5} justifyContent="flex-end">
                              {(() => {
                                const queueStatus = getQueueItemStatus(recipe);
                                const isOnMachine = queueStatus === 'assigned';
                                return (
                                  <Tooltip title={isOnMachine ? "Active on machine" : "Edit"}>
                                    <span>
                                      <IconButton 
                                        size="small" 
                                        onClick={() => !isOnMachine && handleEditAssigned(i)}
                                        disabled={isOnMachine}
                                        sx={{ color: isOnMachine ? colors.grey[500] : colors.orangeAccent[500] }}
                                      >
                                        <EditIcon fontSize="small" />
                                      </IconButton>
                                    </span>
                                  </Tooltip>
                                );
                              })()}
                              {(() => {
                                const queueStatus = getQueueItemStatus(recipe);
                                const isOnMachine = queueStatus === 'assigned';
                                const batchInfo = getBatchCount(recipe);
                                const hasBatches = batchInfo.completed > 0;
                                const effectiveStatus = recipe.status || (hasBatches ? 'halted' : 'queued');
                                const isHalted = effectiveStatus === 'halted';
                                const canDelete = !isOnMachine && (!hasBatches || isHalted);
                                const tooltip = isOnMachine
                                  ? "Active on machine"
                                  : !canDelete
                                    ? "Change status to halted first to remove"
                                    : "Remove";
                                return (
                                  <Tooltip title={tooltip}>
                                    <span>
                                      <IconButton
                                        size="small"
                                        onClick={() => canDelete && handleRemoveAssignment(i)}
                                        disabled={!canDelete}
                                        sx={{ color: canDelete ? colors.redAccent[500] : colors.grey[500] }}
                                      >
                                        <DeleteIcon fontSize="small" />
                                      </IconButton>
                                    </span>
                                  </Tooltip>
                                );
                              })()}
                              {(() => {
                                const status = getQueueItemStatus(recipe);
                                if (status === 'assigned') {
                                  return (
                                    <Tooltip title="Skip waiting for more gates">
                                      <IconButton
                                        size="small"
                                        onClick={() => handleSkipQueueItem(i)}
                                        sx={{ color: colors.tealAccent[500] }}
                                      >
                                        <SkipNextIcon fontSize="small" />
                                      </IconButton>
                                    </Tooltip>
                                  );
                                }
                                return (
                                  <Tooltip title="Activate">
                                    <span>
                                      <IconButton 
                                        size="small" 
                                        onClick={() => hasEmptyGates && handleActivateFromQueue(i)}
                                        disabled={!hasEmptyGates}
                                        sx={{ color: hasEmptyGates ? colors.tealAccent[500] : colors.grey[500] }}
                                      >
                                        <PlayArrowIcon fontSize="small" />
                                      </IconButton>
                                    </span>
                                  </Tooltip>
                                );
                              })()}
                </Box>
                          </TableCell>
                        </TableRow>
                        
                        {/* Expandable details row */}
                        <TableRow>
                          <TableCell 
                            colSpan={8} 
                            sx={{ py: 0, borderBottom: expandedQueueIndex === i ? `1px solid ${colors.grey[200]}` : 'none' }}
                          >
                            <Collapse in={expandedQueueIndex === i}>
                              <Box sx={{ 
                                p: 2, 
                                bgcolor: theme.palette.mode === 'dark' ? colors.primary[400] : colors.grey[100],
                                borderRadius: 1, 
                                my: 1 
                              }}>
                                <Typography variant="subtitle2" fontWeight="bold" color={theme.palette.mode === 'dark' ? colors.grey[800] : colors.grey[800]} mb={1}>
                                  Configuration Details
                                </Typography>
                                <Box display="grid" gridTemplateColumns="repeat(4, 1fr)" gap={2}>
                                  <Box>
                                    <Typography variant="caption" color={theme.palette.mode === 'dark' ? colors.grey[100] : colors.grey[600]}>Piece Weight Range</Typography>
                                    <Typography variant="body2" fontWeight="500" color={theme.palette.mode === 'dark' ? colors.grey[800] : 'inherit'}>
                                      {recipe.params?.pieceMinWeight || '-'}g - {recipe.params?.pieceMaxWeight || '-'}g
                                    </Typography>
                                  </Box>
                                  <Box>
                                    <Typography variant="caption" color={theme.palette.mode === 'dark' ? colors.grey[100] : colors.grey[600]}>Batch Weight Range</Typography>
                                    <Typography variant="body2" fontWeight="500" color={theme.palette.mode === 'dark' ? colors.grey[800] : 'inherit'}>
                                      {recipe.params?.batchMinWeight && recipe.params?.batchMaxWeight 
                                        ? `${recipe.params?.batchMinWeight}g - ${recipe.params?.batchMaxWeight}g`
                                        : '-'
                                      }
                                    </Typography>
                                  </Box>
                                  <Box>
                                    <Typography variant="caption" color={theme.palette.mode === 'dark' ? colors.grey[100] : colors.grey[600]}>Type / Value</Typography>
                                    <Typography variant="body2" fontWeight="500" color={theme.palette.mode === 'dark' ? colors.grey[800] : 'inherit'}>
                                      {recipe.params?.countType || 'NA'} / {recipe.params?.countValue || '-'}
                                    </Typography>
                                  </Box>
                                  <Box>
                                    <Typography variant="caption" color={theme.palette.mode === 'dark' ? colors.grey[100] : colors.grey[600]}>Requested Batches</Typography>
                                    <Typography variant="body2" fontWeight="500" color={theme.palette.mode === 'dark' ? colors.grey[800] : 'inherit'}>
                                      {recipe.requestedBatches || '-'}
                                    </Typography>
                                  </Box>
                                </Box>
                              </Box>
                            </Collapse>
                          </TableCell>
                        </TableRow>
                      </React.Fragment>
                    );})
                  )}
                </TableBody>
              </Table>
            </Box>
              </>);
            })()}
          </Paper>

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

        {/* Active Orders - Below Order Queue */}
        <Box mt={6}>
          <Box display="flex" alignItems="center" gap={2} mb={2}>
          <Typography
            variant="h4"
            fontWeight="bold"
              sx={{ color: colors.tealAccent[500] }}
          >
              Active Orders
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
            <Typography>No active orders. Add orders to start production.</Typography>
          ) : (
            <>
              {/* Active Recipe Table */}
              <Paper sx={{ p: 3, backgroundColor: colors.primary[200], mb: 3, width: '100%' }}>
                <Box display="grid" gridTemplateColumns="3fr 80px repeat(8, 20px) 40px repeat(6, minmax(40px, 1fr)) minmax(180px, 2fr)" gap="2px" sx={{ width: '100%' }}>
                  {/* Header Level 1 - Grouped headers */}
                  <Box sx={{ p: 0, display: 'flex', alignItems: 'center', minHeight: '20px' }}>
                    <Typography variant="body2" fontWeight="bold">Order</Typography>
                  </Box>
                  <Box sx={{ p: 0, display: 'flex', alignItems: 'center', minHeight: '20px' }}>
                    <Typography variant="body2" fontWeight="bold">Batches</Typography>
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
                  <Box sx={{ pl: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '20px' }}>
                    <Typography variant="body2" fontWeight="bold"> </Typography>
                  </Box>

                  {/* Header Level 2 - Detail headers */}
                  <Box sx={{ p: 0, display: 'flex', alignItems: 'center', minHeight: '20px', mb: 1 }}>
                    {/* Empty cell for Recipe column */}
                  </Box>
                  <Box sx={{ p: 0, display: 'flex', alignItems: 'center', minHeight: '20px', mb: 1 }}>
                    {/* Empty cell for Batches column */}
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
                  <Box sx={{ p: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '20px', mb: 1 }}>
                    {/* Empty cell for Actions column */}
                  </Box>

                  {/* Recipe rows */}
                  {activeRecipes.map((recipe, i) => {
                    // Use stable color index to prevent color shifts when incoming recipes are inserted
                    // _stableColorIndex: >= 0 uses that slot, -1 means incoming recipe (uses explicit color)
                    const colorIndex = recipe._stableColorIndex >= 0 ? recipe._stableColorIndex : i;
                    const recipeColor = recipeColors[colorIndex % recipeColors.length];
                    
                    // Create unique key for partial removal and replacement entries
                    const rowKey = recipe._isPartialRemoval 
                      ? `${i}-removed-${recipe.recipeName}` 
                      : recipe._isReplacementRecipe
                        ? `${i}-replacement-${recipe.recipeName}`
                        : `${i}-${recipe.recipeName}`;
                    
                    // Determine recipe name color based on transition status
                    // - Teal: Recipe finishing (batch limit transitioning - outgoing)
                    // - Red: Incoming recipe from queue during batch limit transition
                    // - Red: Recipe being removed/replaced (outgoing) during normal transitions
                    // - Teal: Replacement recipe (incoming, for edits) during normal transitions
                    const isOnTransitioningGate = recipe.gates.some(g => transitioningGates.includes(g));
                    const isOnCompletedGate = recipe.gates.some(g => completedTransitionGates.includes(g));
                    const allGatesCompleted = recipe.gates.length > 0 && recipe.gates.every(g => completedTransitionGates.includes(g));
                    const isActivelyTransitioning = isOnTransitioningGate || isOnCompletedGate;
                    
                    // Only show replacement styling if gates are still transitioning (not all completed/LOCKED)
                    const showAsReplacement = recipe._isReplacementRecipe && isOnTransitioningGate;
                    
                    // Check if this recipe is in batch limit transitioning (finishing)
                    // Primary: trust the recipe object's own flags (set by backend)
                    // Secondary: batchLimitTransitions SSE state, but ONLY if the recipe
                    // object also has the flag (prevents stale SSE state from showing labels)
                    const isFinishing = recipe.batchLimitTransitioning || recipe.isFinishing;
                    
                    // Check if this is an incoming recipe from the queue during batch limit transition
                    const isIncomingFromQueue = recipe._isIncomingFromQueue || recipe._isReplacementRecipe;
                    
                    // Check if there's ANY recipe currently finishing (batch limit transitioning)
                    const anyRecipeFinishing = activeRecipes.some(r => 
                      r.batchLimitTransitioning || r.isFinishing
                    );
                    
                    // Gate square color: incoming recipes inherit the finishing recipe's color
                    const gateSquareColor = recipeColor;
                    
                    let recipeNameColor = undefined;
                    let showArrow = false;
                    let labelSuffix = '';
                    
                    if (isFinishing) {
                      // This recipe is finishing (batch limit transitioning) - show in TEAL
                      recipeNameColor = colors.tealAccent[500];
                      labelSuffix = ' (Finishing)';
                    } else if (isIncomingFromQueue && anyRecipeFinishing) {
                      // This is an incoming recipe from queue while something is finishing - show in RED with arrow
                      recipeNameColor = colors.redAccent[500];
                      showArrow = true;
                      labelSuffix = ' (Replacing)';
                    } else if (recipe.isRemovedTransitioning) {
                      // This recipe is being removed or replaced (full or partial) - normal transition
                      recipeNameColor = colors.redAccent[500];
                      labelSuffix = recipe._transitionType === 'removing' ? ' (Removing)' : ' (Finishing)';
                    } else if (showAsReplacement) {
                      // This is a replacement recipe for an edit (gates still transitioning) - show with arrow
                      recipeNameColor = colors.tealAccent[500];
                      showArrow = true;
                    } else if (isActivelyTransitioning && !allGatesCompleted) {
                      // This is a new/addition recipe waiting to fully activate (but not fully LOCKED)
                      recipeNameColor = colors.tealAccent[500];
                    }

                    return (
                      <React.Fragment key={rowKey}>
                        {/* Recipe name - left-aligned, colored by transition status */}
                        <Box sx={{ p: 0.5, display: 'flex', alignItems: 'center', height: '28px' }}>
                          <Typography 
                            variant="body2" 
                            sx={{ 
                              color: recipeNameColor,
                              fontWeight: recipeNameColor ? 600 : undefined, // Bold when transitioning
                              fontStyle: (recipe._isPartialRemoval || showAsReplacement || showArrow) ? 'italic' : undefined,
                            }}
                          >
                            {recipe._isPartialRemoval 
                              ? `↳ Gate${recipe.gates.length > 1 ? 's' : ''} ${recipe.gates.join(', ')} (removing)`
                              : showArrow
                                ? `↳ ${getOrderDisplayName(recipe)}${labelSuffix}`
                                : `${getOrderDisplayName(recipe)}${labelSuffix}`
                            }
                          </Typography>
                        </Box>
                        
                        {/* Batches column */}
                        <Box sx={{ p: 0.5, display: 'flex', alignItems: 'center', height: '28px' }}>
                          <Typography variant="body2">
                            {getBatchCount(recipe).completed}/{getBatchCount(recipe).requested || '-'}
                          </Typography>
                        </Box>
                        
                        {/* Gate assignments - square boxes with pause hover */}
                        {[1, 2, 3, 4, 5, 6, 7, 8].map(gate => {
                          const isAssigned = recipe.gates.includes(gate);
                          const isOutgoingRecipe = recipe.isRemovedTransitioning || recipe._isPartialRemoval;
                          const isTransitioning = isOutgoingRecipe && transitioningGates.includes(gate) && isAssigned;
                          const isGatePaused = isAssigned && (backendPausedGates || []).includes(gate);
                          return (
                            <Box
                              key={`${rowKey}-${gate}`}
                              onClick={isAssigned ? () => handleToggleGatePause(gate) : undefined}
                              sx={{
                                position: 'relative',
                                backgroundColor: isAssigned
                                  ? isGatePaused ? `${gateSquareColor}66` : gateSquareColor
                                  : undefined,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                width: '20px',
                                height: '20px',
                                alignSelf: 'center',
                                cursor: isAssigned ? 'pointer' : 'default',
                                ...(isTransitioning && {
                                  ...getSyncedAnimationStyle(),
                                  border: `2px solid ${theme.palette.mode === 'dark' 
                                    ? 'rgba(255, 255, 255, 0.5)' 
                                    : 'rgba(0, 0, 0, 0.38)'}`,
                                }),
                                ...(isGatePaused && {
                                  backgroundImage: 'repeating-linear-gradient(45deg, transparent, transparent 3px, rgba(0,0,0,0.15) 3px, rgba(0,0,0,0.15) 5px)',
                                }),
                                '&:hover .gate-pause-icon': {
                                  opacity: isAssigned ? 1 : 0,
                                },
                              }}
                            >
                              {isAssigned && (
                                <Box
                                  className="gate-pause-icon"
                                  sx={{
                                    opacity: isGatePaused ? 1 : 0,
                                    transition: 'opacity 0.15s',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    position: 'absolute',
                                    inset: 0,
                                    backgroundColor: 'rgba(0,0,0,0.35)',
                                    borderRadius: '2px',
                                  }}
                                >
                                  {isGatePaused
                                    ? <PlayArrowIcon sx={{ fontSize: 14, color: '#fff' }} />
                                    : <PauseIcon sx={{ fontSize: 14, color: '#fff' }} />
                                  }
                                </Box>
                              )}
                            </Box>
                          );
                        })}
                        
                        {/* Spacer column */}
                        <Box sx={{ height: '28px' }} />
                        
                        {/* Recipe specifications */}
                        <Box sx={{ p: 0.5, display: 'flex', alignItems: 'center', justifyContent: 'left', height: '28px' }}>
                          <Typography variant="body2">{recipe.params?.pieceMinWeight || '-'}</Typography>
                        </Box>
                        <Box sx={{ p: 0.5, display: 'flex', alignItems: 'center', justifyContent: 'left', height: '28px' }}>
                          <Typography variant="body2">{recipe.params?.pieceMaxWeight || '-'}</Typography>
                        </Box>
                        <Box sx={{ p: 0.5, display: 'flex', alignItems: 'center', justifyContent: 'left', height: '28px' }}>
                          <Typography variant="body2">{recipe.params?.batchMinWeight || '-'}</Typography>
                        </Box>
                        <Box sx={{ p: 0.5, display: 'flex', alignItems: 'center', justifyContent: 'left', height: '28px' }}>
                          <Typography variant="body2">{recipe.params?.batchMaxWeight || '-'}</Typography>
                        </Box>
                        <Box sx={{ p: 0.5, display: 'flex', alignItems: 'center', justifyContent: 'left', height: '28px' }}>
                          <Typography variant="body2">
                            {recipe.params?.countType === 'min' || recipe.params?.countType === 'exact' 
                              ? recipe.params?.countValue || '-' 
                              : '-'}
                          </Typography>
                        </Box>
                        <Box sx={{ p: 0.5, display: 'flex', alignItems: 'center', justifyContent: 'left', height: '28px' }}>
                          <Typography variant="body2">
                            {recipe.params?.countType === 'max' || recipe.params?.countType === 'exact' 
                              ? recipe.params?.countValue || '-' 
                              : '-'}
                          </Typography>
                        </Box>
                        
                        {/* Actions column - fixed layout: [status text] [edit] [remove] [finish/skip] */}
                        {(() => {
                          const isRemovedRecipe = recipe.isRemovedTransitioning === true;
                          const isRecipeTransitioning = recipe.gates.some(gate => transitioningGates.includes(gate));
                          const isRecipeLocked = recipe.gates.some(gate => completedTransitionGates.includes(gate));
                          const isInTransitionPeriod = transitioningGates.length > 0 || completedTransitionGates.length > 0;
                          const isRecipeFinishing = isFinishing;
                          
                          // Determine state
                          const isTransitionState = isRecipeFinishing 
                            || (isIncomingFromQueue && (isActivelyTransitioning || anyRecipeFinishing))
                            || isRemovedRecipe 
                            || isRecipeTransitioning;
                          const isLockedState = !isTransitionState && isRecipeLocked && isInTransitionPeriod;
                          const isNormalState = !isTransitionState && !isLockedState;
                          
                          // For finishing recipes, check if gates have pieces in them
                          // If yes: can't remove (batch in progress would be lost)
                          // If no (all gates empty): can remove immediately without transition
                          let finishingGatesEmpty = false;
                          if (isRecipeFinishing && gateSnapshot && gateSnapshot.length > 0) {
                            const recipeGateNums = recipe.gates || [];
                            finishingGatesEmpty = recipeGateNums.every(g => {
                              const gs = gateSnapshot.find(s => s.gate === g);
                              return !gs || (gs.pieces === 0 && gs.grams === 0);
                            });
                          }
                          
                          // Hide ALL buttons for replacing (incoming) recipe rows
                          const isReplacingRow = isIncomingFromQueue && anyRecipeFinishing && !isRecipeFinishing;

                          // Button visibility
                          const isStopped = machineState === "idle" && activeRecipes.length > 0;
                          const canInteract = machineState !== "running";
                          const showEdit = !isReplacingRow && !isStopped && isNormalState;
                          const showRemove = !isReplacingRow && !isStopped && (isNormalState || (isRecipeFinishing && finishingGatesEmpty));
                          const showFinish = !isReplacingRow && (isStopped || isNormalState);
                          const showSkip = !isReplacingRow && (isStopped || isRecipeFinishing || isRemovedRecipe);
                          
                          // Status label
                          const isRecipePaused = !!recipe.paused;
                          const statusLabel = isStopped ? null : isRecipePaused ? 'PAUSED' : isTransitionState ? 'TRANSITIONING' : isLockedState ? 'LOCKED' : null;
                          
                          return (
                            <Box display="flex" alignItems="center" justifyContent="flex-end" sx={{ height: '28px' }}>
                              {statusLabel && (
                                <Typography 
                                  variant="body2" 
                                  sx={{ 
                                    color: theme.palette.action.disabled,
                                    fontSize: '0.7rem',
                                    whiteSpace: 'nowrap',
                                    mr: 0.5,
                                  }}
                                >
                                  {statusLabel}
                                </Typography>
                              )}
                              {/* Fixed-width slot container prevents flex-shrink from misaligning buttons */}
                              <Box display="flex" sx={{ width: 112, flexShrink: 0 }}>
                              {/* Slot 0: Pause/Resume */}
                              <Box sx={{ width: 28, display: 'flex', justifyContent: 'center' }}>
                                {!isStopped && !isReplacingRow && (
                                  <Tooltip title={recipe.paused ? "Resume" : "Pause"}>
                                    <IconButton 
                                      size="small"
                                      onClick={() => handleToggleRecipePause(i)}
                                      sx={{ color: recipe.paused ? colors.tealAccent[500] : colors.orangeAccent[500] }}
                                    >
                                      {recipe.paused ? <PlayArrowIcon fontSize="small" /> : <PauseIcon fontSize="small" />}
                                    </IconButton>
                                  </Tooltip>
                                )}
                              </Box>
                              {/* Slot 1: Edit (hidden when stopped) */}
                              <Box sx={{ width: 28, display: 'flex', justifyContent: 'center' }}>
                                {showEdit ? (
                                  <Tooltip title="Edit">
                                    <span>
                                      <IconButton 
                                        size="small"
                                        onClick={() => canInteract && handleEditActive(i)}
                                        disabled={!canInteract}
                                        sx={{ color: canInteract ? colors.orangeAccent[500] : colors.grey[500] }}
                                      >
                                        <EditIcon fontSize="small" />
                                      </IconButton>
                                    </span>
                                  </Tooltip>
                                ) : null}
                              </Box>
                              {/* Slot 2: Remove / Finish (when stopped) */}
                              <Box sx={{ width: 28, display: 'flex', justifyContent: 'center' }}>
                                {isStopped ? (
                                  <Tooltip title="Finish">
                                    <IconButton 
                                      size="small"
                                      onClick={() => handleFinishWhileStopped(i)}
                                      sx={{ color: colors.tealAccent[500] }}
                                    >
                                      <CheckCircleIcon fontSize="small" />
                                    </IconButton>
                                  </Tooltip>
                                ) : showRemove ? (
                                  <Tooltip title="Remove to Queue">
                                    <span>
                                      <IconButton 
                                        size="small" 
                                        onClick={() => canInteract && handleMoveToQueue(i)}
                                        disabled={!canInteract}
                                        sx={{ color: canInteract ? colors.redAccent[500] : colors.grey[500] }}
                                      >
                                        <DeleteIcon fontSize="small" />
                                      </IconButton>
                                    </span>
                                  </Tooltip>
                                ) : null}
                              </Box>
                              {/* Slot 3: Skip to Queue (when stopped) / Skip Transition / Finish */}
                              <Box sx={{ width: 28, display: 'flex', justifyContent: 'center' }}>
                                {isStopped ? (
                                  <Tooltip title="Skip to Queue">
                                    <IconButton 
                                      size="small"
                                      onClick={() => handleSkipToQueueWhileStopped(i)}
                                      sx={{ color: colors.orangeAccent[500] }}
                                    >
                                      <SkipNextIcon fontSize="small" />
                                    </IconButton>
                                  </Tooltip>
                                ) : showSkip ? (
                                  <Tooltip title="Skip Transition">
                                    <IconButton 
                                      size="small"
                                      onClick={() => handleOpenSkipDialog(i)}
                                      sx={{ color: colors.tealAccent[500] }}
                                    >
                                      <SkipNextIcon fontSize="small" />
                                    </IconButton>
                                  </Tooltip>
                                ) : showFinish ? (
                                  <Tooltip title="Finish">
                                    <span>
                                      <IconButton 
                                        size="small" 
                                        onClick={() => canInteract && handleFinishActiveRecipe(i)}
                                        disabled={!canInteract}
                                        sx={{ color: canInteract ? colors.tealAccent[500] : colors.grey[500] }}
                                      >
                                        <CheckCircleIcon fontSize="small" />
                                      </IconButton>
                                    </span>
                                  </Tooltip>
                                ) : null}
                              </Box>
                              </Box>{/* end fixed-width slot container */}
                            </Box>
                          );
                        })()}

                        {/* Edit row - shown when editing */}
                        {editingActiveIndex === i && (
                          <>
                            {/* Recipe name placeholder */}
                            <Box sx={{ p: 0.5, display: 'flex', alignItems: 'center', minHeight: '20px' }} />
                            {/* Batches - editable for non-orders */}
                            <Box sx={{ p: 0.5, display: 'flex', alignItems: 'center', minHeight: '20px' }}>
                              {editActiveData && !editActiveData.isOrder ? (
                                <TextField
                                  type="number"
                                  value={editActiveData?.requestedBatches || ''}
                                  onChange={(e) => {
                                    const val = e.target.value;
                                    if (val === '') {
                                      setEditActiveData({...editActiveData, requestedBatches: ''});
                                    } else {
                                      const num = parseInt(val);
                                      if (!isNaN(num) && num >= 1) {
                                        setEditActiveData({...editActiveData, requestedBatches: num});
                                      }
                                    }
                                  }}
                                  size="small"
                                  color="secondary"
                                  inputProps={{ min: 1, step: 1, style: { fontSize: '0.7rem' } }}
                                  sx={{ width: '100%' }}
                                />
                              ) : null}
                            </Box>
                            
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

                              // Get the recipe's color (use stable index)
                              const editColorIndex = recipe._stableColorIndex >= 0 ? recipe._stableColorIndex : i;
                              const recipeColor = recipeColors[editColorIndex % recipeColors.length];

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
                            
                            {/* Action Buttons - Combined into single column */}
                            <Box sx={{ p: 0.5, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 0.5, minHeight: '20px' }}>
                              <Button
                                variant="outlined"
                                size="small"
                                onClick={handleCancelEditActive}
                                sx={{ minWidth: 'auto', padding: '2px 8px', fontSize: '0.75rem', color: colors.grey[500], borderColor: colors.grey[500] }}
                              >
                                CANCEL
                              </Button>
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
            </>
          )}
                      </React.Fragment>
                    );
                  })}
                </Box>
              </Paper>

              {/* Error/Success messages for Active Recipes */}
              {editActiveError && (
                <Typography variant="body2" sx={{ color: colors.redAccent[500], mt: 1 }}>
                  {editActiveError}
            </Typography>
              )}

              {editActiveSuccess && (
                <Typography variant="body2" sx={{ color: colors.tealAccent[400], mt: 1 }}>
                  {editActiveSuccess}
            </Typography>
              )}
            </>
          )}
        </Box>
      </Box>

      {/* Skip Transition Confirmation Dialog */}
      <Dialog
        open={skipDialogOpen}
        onClose={handleCloseSkipDialog}
        PaperProps={{
          sx: { borderRadius: '12px' }
        }}
      >
        <DialogTitle sx={{ 
          fontWeight: 'bold',
          color: colors.tealAccent[500]
        }}>
          Skip Transition?
        </DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ 
            color: theme.palette.mode === 'dark' ? colors.grey[100] : colors.grey[800]
          }}>
            Are you sure you want to end the transition period and directly start the new recipe?
            This will register the current batch as incomplete.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button 
            onClick={handleCloseSkipDialog} 
            sx={{ 
              color: theme.palette.mode === 'dark' ? colors.grey[100] : colors.grey[900],
              '&:hover': {
                backgroundColor: theme.palette.mode === 'dark' ? colors.grey[500] : colors.grey[400],
              }
            }}
          >
            Cancel
          </Button>
          <Button 
            onClick={handleConfirmSkip} 
            sx={{ 
              color: colors.tealAccent[500],
              '&:hover': {
                backgroundColor: colors.tealAccent[500],
                color: '#fff',
              }
            }}
          >
            Confirm Skip
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={deleteDialogOpen}
        onClose={handleCloseDeleteDialog}
        PaperProps={{
          sx: { borderRadius: '12px' }
        }}
      >
        <DialogTitle sx={{ 
          fontWeight: 'bold',
          color: colors.redAccent[500]
        }}>
          Delete {deleteItemType === 'recipe' ? 'Recipe' : 'Program'}?
        </DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ 
            color: theme.palette.mode === 'dark' ? colors.grey[100] : colors.grey[800]
          }}>
            Are you sure you want to delete "{deleteItemName}"? This action cannot be undone.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button 
            onClick={handleCloseDeleteDialog} 
            sx={{ 
              color: theme.palette.mode === 'dark' ? colors.grey[100] : colors.grey[900],
              '&:hover': {
                backgroundColor: theme.palette.mode === 'dark' ? colors.grey[500] : colors.grey[400],
              }
            }}
          >
            Cancel
          </Button>
          <Button 
            onClick={handleConfirmDelete} 
            sx={{ 
              color: colors.redAccent[500],
              '&:hover': {
                backgroundColor: colors.redAccent[500],
                color: '#fff',
              }
            }}
          >
            Delete
          </Button>
        </DialogActions>
      </Dialog>

      {/* Edit Queue Item Dialog */}
      <Dialog
        open={editingAssignedIndex !== null}
        onClose={handleCancelEditAssigned}
        maxWidth="md"
        fullWidth
        PaperProps={{
          sx: { borderRadius: '12px', maxHeight: '90vh' }
        }}
      >
        <DialogTitle sx={{ 
          fontWeight: 'bold',
          color: colors.tealAccent[500],
        }}>
          Edit Queue Item
        </DialogTitle>
        <DialogContent sx={{ overflowY: 'auto' }}>
          {editAssignedData && (
            <Box display="grid" gridTemplateColumns="1fr 1fr" gap={2.5} sx={{ mt: 2 }}>
              <TextField
                label="Piece Min Weight (g)"
                type="number"
                color="secondary"
                value={editAssignedData.pieceMinWeight}
                onChange={(e) => setEditAssignedData({ ...editAssignedData, pieceMinWeight: e.target.value })}
                fullWidth
                required
              />
              
              <TextField
                label="Piece Max Weight (g)"
                type="number"
                color="secondary"
                value={editAssignedData.pieceMaxWeight}
                onChange={(e) => setEditAssignedData({ ...editAssignedData, pieceMaxWeight: e.target.value })}
                fullWidth
                required
              />
              
              <TextField
                label="Batch Min Weight (g)"
                type="number"
                color="secondary"
                value={editAssignedData.batchMinWeight}
                onChange={(e) => setEditAssignedData({ ...editAssignedData, batchMinWeight: e.target.value })}
                fullWidth
              />
              
              <TextField
                label="Batch Max Weight (g)"
                type="number"
                color="secondary"
                value={editAssignedData.batchMaxWeight}
                onChange={(e) => setEditAssignedData({ ...editAssignedData, batchMaxWeight: e.target.value })}
                fullWidth
              />
              
              <FormControl fullWidth color="secondary">
                <InputLabel color="secondary">Count Type</InputLabel>
                <Select
                  value={editAssignedData.countType || 'NA'}
                  onChange={(e) => setEditAssignedData({ ...editAssignedData, countType: e.target.value })}
                  label="Count Type"
                  color="secondary"
                >
                  <MenuItem value="NA">NA</MenuItem>
                  <MenuItem value="min">Min</MenuItem>
                  <MenuItem value="max">Max</MenuItem>
                  <MenuItem value="exact">Exact</MenuItem>
                </Select>
              </FormControl>
              
              <TextField
                label="Count Value"
                type="number"
                color="secondary"
                value={editAssignedData.countValue}
                onChange={(e) => setEditAssignedData({ ...editAssignedData, countValue: e.target.value })}
                fullWidth
                disabled={!editAssignedData.countType || editAssignedData.countType === 'NA'}
              />
              
              <TextField
                label={`Min Gates (max ${editAssignedData.maxGatesAllowed || 8})`}
                type="text"
                color="secondary"
                value={editAssignedData.minGates}
                onChange={(e) => {
                  const val = e.target.value;
                  const maxAllowed = editAssignedData.maxGatesAllowed || 8;
                  if (val === '') {
                    setEditAssignedData({ ...editAssignedData, minGates: '' });
                  } else {
                    const num = parseInt(val);
                    if (!isNaN(num) && num >= 1 && num <= maxAllowed) {
                      setEditAssignedData({ ...editAssignedData, minGates: num });
                    }
                  }
                }}
                onBlur={(e) => {
                  const num = parseInt(e.target.value);
                  const maxAllowed = editAssignedData.maxGatesAllowed || 8;
                  if (isNaN(num) || num < 1) {
                    setEditAssignedData({ ...editAssignedData, minGates: 1 });
                  } else if (num > maxAllowed) {
                    setEditAssignedData({ ...editAssignedData, minGates: maxAllowed });
                  }
                }}
                helperText={editAssignedData.maxGatesAllowed < 8 ? `Capped to remaining batches` : ''}
                fullWidth
              />
              
              {/* Requested Batches - only for non-order recipes */}
              {editAssignedData && !editAssignedData.isOrder && (
                <TextField
                  label="Requested Batches"
                  type="number"
                  color="secondary"
                  value={editAssignedData.requestedBatches}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val === '') {
                      setEditAssignedData({ ...editAssignedData, requestedBatches: '' });
                    } else {
                      const num = parseInt(val);
                      if (!isNaN(num) && num >= 1) {
                        setEditAssignedData({ ...editAssignedData, requestedBatches: num });
                      }
                    }
                  }}
                  fullWidth
                  inputProps={{ min: 1 }}
                />
              )}

              {/* Status dropdown */}
              <FormControl fullWidth color="secondary">
                <InputLabel color="secondary">Status</InputLabel>
                <Select
                  value={editAssignedData.status || 'queued'}
                  onChange={(e) => setEditAssignedData({ ...editAssignedData, status: e.target.value })}
                  label="Status"
                  color="secondary"
                  disabled={editAssignedData.status === 'assigned'}
                  renderValue={(selected) => (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Box sx={{
                        width: 10,
                        height: 10,
                        borderRadius: '50%',
                        bgcolor: selected === 'halted' ? colors.orangeAccent[500] :
                                 selected === 'assigned' ? colors.purpleAccent[500] :
                                 colors.tealAccent[500],
                      }} />
                      {selected.charAt(0).toUpperCase() + selected.slice(1)}
                    </Box>
                  )}
                >
                  <MenuItem value="queued">
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                      <Chip 
                        size="small" 
                        label="Queued" 
                        sx={{ 
                          bgcolor: colors.tealAccent[500], 
                          color: '#fff', 
                          fontWeight: 'bold', 
                          fontSize: '11px',
                          minWidth: 70,
                        }} 
                      />
                      <Typography variant="body2" sx={{ color: colors.grey[300] }}>
                        Ready for auto-assignment
                      </Typography>
                    </Box>
                  </MenuItem>
                  <MenuItem value="halted">
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                      <Chip 
                        size="small" 
                        label="Halted" 
                        sx={{ 
                          bgcolor: colors.orangeAccent[500], 
                          color: '#fff', 
                          fontWeight: 'bold', 
                          fontSize: '11px',
                          minWidth: 70,
                        }} 
                      />
                      <Typography variant="body2" sx={{ color: colors.grey[300] }}>
                        Paused, requires manual activation
                      </Typography>
                    </Box>
                  </MenuItem>
                  {editAssignedData.status === 'assigned' && (
                    <MenuItem value="assigned" disabled>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                        <Chip 
                          size="small" 
                          label="Assigned" 
                          sx={{ 
                            bgcolor: colors.purpleAccent[500], 
                            color: '#fff', 
                            fontWeight: 'bold', 
                            fontSize: '11px',
                            minWidth: 70,
                          }} 
                        />
                        <Typography variant="body2" sx={{ color: colors.grey[300] }}>
                          Currently assigned to gates (automatic)
                        </Typography>
                      </Box>
                    </MenuItem>
                  )}
                </Select>
              </FormControl>
            </Box>
          )}
          
          {editAssignedError && (
            <Typography variant="body2" sx={{ color: colors.redAccent[500], mt: 2 }}>
              {editAssignedError}
            </Typography>
          )}
        </DialogContent>
        <DialogActions sx={{ p: 2, gap: 1 }}>
          <Button 
            onClick={handleCancelEditAssigned}
            variant="contained"
            sx={{ 
              bgcolor: colors.grey[500],
              color: '#fff',
              '&:hover': { bgcolor: colors.grey[600] },
            }}
          >
            Cancel
          </Button>
          <Button 
            onClick={handleAcceptEditAssigned} 
            variant="contained"
            color="secondary"
          >
            Update
          </Button>
        </DialogActions>
      </Dialog>
      
      {/* Snackbar for queue drag-drop warnings */}
      <Snackbar
        open={!!queueDragWarning}
        autoHideDuration={5000}
        onClose={() => setQueueDragWarning(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert 
          onClose={() => setQueueDragWarning(null)} 
          severity="warning" 
          variant="filled"
          sx={{ width: '100%' }}
        >
          {queueDragWarning}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default Setup;
