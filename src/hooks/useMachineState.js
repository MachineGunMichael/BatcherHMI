// src/hooks/useMachineState.js
// React hook for real-time machine state via Server-Sent Events

import { useState, useEffect, useRef } from 'react';
import api from '../services/api';

/**
 * Hook to subscribe to machine state updates via SSE
 * @returns {Object} { state, activeRecipes, currentProgramId, isConnected, error, refetch }
 */
export function useMachineState() {
  const [machineState, setMachineState] = useState({
    state: 'idle',
    currentProgramId: null,
    activeRecipes: [],
    programStartRecipes: [],
    transitioningGates: [],
    completedTransitionGates: [],
    transitionStartRecipes: {},
    lastUpdated: null,
  });
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState(null);
  const [orderUpdates, setOrderUpdates] = useState({}); // { orderId: { completedBatches, requestedBatches } }
  const [recipeBatchUpdates, setRecipeBatchUpdates] = useState({}); // { recipeName: { completedBatches, requestedBatches } }
  const [recipeCompletions, setRecipeCompletions] = useState([]); // Array of completed recipe events
  const [batchLimitTransitions, setBatchLimitTransitions] = useState({}); // { recipeKey: { transitioning, gates } }
  const [gateHandoffs, setGateHandoffs] = useState([]); // Array of recent gate handoff events
  const eventSourceRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);

  // Fetch initial state
  const fetchState = async () => {
    try {
      const response = await api.get('/machine/state');
      setMachineState(response.data);
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  };

  // Setup SSE connection
  useEffect(() => {
    const connectSSE = () => {
      try {
        let baseURL = process.env.REACT_APP_API_URL || 'http://localhost:5001/api';
        baseURL = baseURL.replace(/\/api\/?$/, '');
        const url = `${baseURL}/api/machine/stream`;
        
        const eventSource = new EventSource(url);
        eventSourceRef.current = eventSource;

        eventSource.onopen = () => {
          setIsConnected(true);
          setError(null);
        };

        eventSource.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            
            // Handle different message types
            if (data.type === 'recipe_batch_update') {
              // Update recipe batch counts using unique recipeKey
              // recipeKey is either "order_${orderId}" or "recipe_${gates.join('_')}"
              const key = data.recipeKey || data.recipeName; // Fallback for backwards compat
              setRecipeBatchUpdates(prev => ({
                ...prev,
                [key]: {
                  completedBatches: data.completedBatches,
                  requestedBatches: data.requestedBatches,
                  recipeName: data.recipeName,
                  orderId: data.orderId,
                  gate: data.gate,
                  gates: data.gates || [],
                  lastUpdated: data.ts,
                }
              }));
            } else if (data.type === 'order_batch_update') {
              // Update order batch counts
              setOrderUpdates(prev => ({
                ...prev,
                [data.orderId]: {
                  completedBatches: data.completedBatches,
                  requestedBatches: data.requestedBatches,
                  recipeName: data.recipeName,
                  lastUpdated: data.ts,
                }
              }));
            } else if (data.type === 'order_completed') {
              // Mark order as completed
              setOrderUpdates(prev => ({
                ...prev,
                [data.orderId]: {
                  ...prev[data.orderId],
                  completedBatches: data.completedBatches,
                  status: 'completed',
                  lastUpdated: data.ts,
                }
              }));
            } else if (data.type === 'recipe_completed') {
              // Mark recipe as completed - add to completions array
              const key = data.recipeKey || data.recipeName;
              setRecipeCompletions(prev => [...prev, {
                recipeKey: key,
                recipeName: data.recipeName,
                completedBatches: data.completedBatches,
                requestedBatches: data.requestedBatches,
                orderId: data.orderId,
                gate: data.gate,
                gates: data.gates || [],
                ts: data.ts,
              }]);
              // Also update batch updates to reflect completion
              setRecipeBatchUpdates(prev => ({
                ...prev,
                [key]: {
                  ...prev[key],
                  completedBatches: data.completedBatches,
                  status: 'completed',
                  lastUpdated: data.ts,
                }
              }));
              // Clear batch limit transition state for this recipe
              setBatchLimitTransitions(prev => {
                const newState = { ...prev };
                delete newState[key];
                return newState;
              });
            } else if (data.type === 'batch_limit_transition_started') {
              // Recipe has entered batch limit transitioning mode
              const key = data.recipeKey;
              setBatchLimitTransitions(prev => ({
                ...prev,
                [key]: {
                  transitioning: true,
                  recipeName: data.recipeName,
                  completedBatches: data.completedBatches,
                  requestedBatches: data.requestedBatches,
                  gates: data.gates || [],
                  startedAt: data.ts,
                }
              }));
              // Also update batch updates to reflect transitioning state
              setRecipeBatchUpdates(prev => ({
                ...prev,
                [key]: {
                  ...prev[key],
                  batchLimitTransitioning: true,
                  lastUpdated: data.ts,
                }
              }));
            } else if (data.type === 'gate_handoff') {
              // A gate has been freed and potentially assigned to next queue item
              setGateHandoffs(prev => [...prev.slice(-9), { // Keep last 10 handoffs
                gate: data.gate,
                fromRecipe: data.fromRecipe,
                fromRecipeKey: data.fromRecipeKey,
                toRecipe: data.toRecipe,
                handoffType: data.handoffType,
                assigned: data.assigned,
                needed: data.needed,
                ts: data.ts,
              }]);
            } else {
              // Regular machine state update
              setMachineState(data);
            }
          } catch (err) {
            // Silent fail for parse errors
          }
        };

        eventSource.onerror = (err) => {
          setIsConnected(false);
          eventSource.close();
          
          // Attempt to reconnect after 5 seconds
          reconnectTimeoutRef.current = setTimeout(() => {
            connectSSE();
          }, 5000);
        };
      } catch (err) {
        setError(err.message);
      }
    };

    // Initial fetch
    fetchState();
    
    // Connect SSE
    connectSSE();

    // Cleanup
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, []);

  // Clear recipe completions after they've been processed
  const clearRecipeCompletions = () => setRecipeCompletions([]);

  // Clear gate handoffs after they've been processed
  const clearGateHandoffs = () => setGateHandoffs([]);

  return {
    state: machineState.state,
    activeRecipes: machineState.activeRecipes,
    currentProgramId: machineState.currentProgramId,
    programStartRecipes: machineState.programStartRecipes,
    transitioningGates: machineState.transitioningGates || [],
    completedTransitionGates: machineState.completedTransitionGates || [],
    transitionStartRecipes: machineState.transitionStartRecipes || {},
    transitionOldProgramId: machineState.transitionOldProgramId || null,
    registeredTransitioningGates: machineState.registeredTransitioningGates || [],
    orderQueue: machineState.orderQueue || [], // Backend order queue (source of truth)
    gateSnapshot: machineState.gateSnapshot || [], // Gate piece/weight data for each gate
    pausedGates: machineState.pausedGates || [], // Gates individually paused
    lastUpdated: machineState.lastUpdated,
    orderUpdates, // Real-time order batch updates
    recipeBatchUpdates, // Real-time recipe batch updates (all recipes)
    recipeCompletions, // Array of recipe completion events
    clearRecipeCompletions, // Function to clear after handling
    batchLimitTransitions, // Recipes in batch limit transitioning mode
    gateHandoffs, // Recent gate handoff events
    clearGateHandoffs, // Function to clear after handling
    isConnected,
    error,
    refetch: fetchState,
  };
}

export default useMachineState;
