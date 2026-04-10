// src/hooks/useMachineState.js
// React hook for real-time machine state via Server-Sent Events

import { useState, useEffect, useRef } from 'react';
import api from '../services/api';
import { isPageVisible, bumpSseEvent } from '../utils/renderMonitor';

const FLUSH_INTERVAL_MS = 10;
const EMPTY_ARRAY = [];
const EMPTY_OBJECT = {};

/**
 * Hook to subscribe to machine state updates via SSE
 * @returns {Object} { state, activeRecipes, currentProgramId, isConnected, error, refetch }
 */
export function useMachineState({ disabled = false } = {}) {
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
  const [orderUpdates, setOrderUpdates] = useState({});
  const [recipeBatchUpdates, setRecipeBatchUpdates] = useState({});
  const [recipeCompletions, setRecipeCompletions] = useState([]);
  const [batchLimitTransitions, setBatchLimitTransitions] = useState({});
  const [gateHandoffs, setGateHandoffs] = useState([]);
  const eventSourceRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const machineStateRef = useRef(machineState);
  machineStateRef.current = machineState;

  // Pending SSE updates — batched and flushed every FLUSH_INTERVAL_MS
  const pendingRef = useRef({
    machine: null,
    recipeBatch: {},
    orderBatch: {},
    completions: [],
    transitions: {},
    handoffs: [],
    orderCompleted: {},
  });
  const flushTimerRef = useRef(null);

  const fetchState = async () => {
    try {
      const response = await api.get('/machine/state');
      setMachineState(response.data);
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  };

  useEffect(() => {
    if (disabled) return;

    // Flush logic — defined once at useEffect scope so reconnects don't
    // duplicate visibility listeners.
    const doFlush = () => {
      flushTimerRef.current = null;
      const p = pendingRef.current;

      if (p.machine) {
        const data = p.machine;
        p.machine = null;
        setMachineState(prev => {
          const { lastUpdated: _a, ...prevCore } = prev;
          const { lastUpdated: _b, ...dataCore } = data;
          if (JSON.stringify(prevCore) === JSON.stringify(dataCore)) {
            return prev;
          }
          const next = { ...data };
          const preserve = (key) => {
            if (JSON.stringify(prev[key]) === JSON.stringify(data[key])) {
              next[key] = prev[key];
            }
          };
          preserve('activeRecipes');
          preserve('pausedGates');
          preserve('transitionStartRecipes');
          preserve('orderQueue');
          preserve('programStartRecipes');
          preserve('transitioningGates');
          preserve('completedTransitionGates');
          preserve('gateSnapshot');
          preserve('registeredTransitioningGates');
          return next;
        });
      }

      if (Object.keys(p.recipeBatch).length) {
        const batch = p.recipeBatch;
        p.recipeBatch = {};
        setRecipeBatchUpdates(prev => {
          const allSame = Object.entries(batch).every(([k, v]) =>
            prev[k] && JSON.stringify(prev[k]) === JSON.stringify(v)
          );
          return allSame ? prev : { ...prev, ...batch };
        });
      }

      if (Object.keys(p.orderBatch).length || Object.keys(p.orderCompleted).length) {
        const batch = p.orderBatch;
        const completed = p.orderCompleted;
        p.orderBatch = {};
        p.orderCompleted = {};
        setOrderUpdates(prev => {
          let next = { ...prev, ...batch };
          for (const [id, c] of Object.entries(completed)) {
            next[id] = { ...next[id], ...c };
          }
          if (JSON.stringify(next) === JSON.stringify(prev)) return prev;
          return next;
        });
      }

      if (p.completions.length) {
        const items = p.completions;
        p.completions = [];
        setRecipeCompletions(prev => [...prev.slice(-(50 - items.length)), ...items]);
        const batchUpdates = {};
        for (const c of items) {
          batchUpdates[c.recipeKey] = { ...(batchUpdates[c.recipeKey] || {}), completedBatches: c.completedBatches, status: 'completed', lastUpdated: c.ts };
        }
        setRecipeBatchUpdates(prev => {
          const next = { ...prev };
          for (const [k, v] of Object.entries(batchUpdates)) next[k] = { ...next[k], ...v };
          if (JSON.stringify(next) === JSON.stringify(prev)) return prev;
          return next;
        });
        const keysToRemove = items.map(c => c.recipeKey);
        setBatchLimitTransitions(prev => {
          const next = { ...prev };
          for (const k of keysToRemove) delete next[k];
          return Object.keys(next).length !== Object.keys(prev).length ? next : prev;
        });
      }

      if (Object.keys(p.transitions).length) {
        const batch = p.transitions;
        p.transitions = {};
        setBatchLimitTransitions(prev => {
          const allSame = Object.entries(batch).every(([k, v]) =>
            prev[k] && JSON.stringify(prev[k]) === JSON.stringify(v)
          );
          return allSame ? prev : { ...prev, ...batch };
        });
        const batchUpdates = {};
        for (const [k, v] of Object.entries(batch)) {
          batchUpdates[k] = { batchLimitTransitioning: true, lastUpdated: v.startedAt };
        }
        setRecipeBatchUpdates(prev => {
          const next = { ...prev };
          for (const [k, v] of Object.entries(batchUpdates)) next[k] = { ...next[k], ...v };
          if (JSON.stringify(next) === JSON.stringify(prev)) return prev;
          return next;
        });
      }

      if (p.handoffs.length) {
        const items = p.handoffs;
        p.handoffs = [];
        setGateHandoffs(prev => [...prev.slice(-(10 - items.length)), ...items]);
      }
    };

    const scheduleFlush = () => {
      if (flushTimerRef.current) return;
      if (!isPageVisible()) return;
      flushTimerRef.current = setTimeout(doFlush, FLUSH_INTERVAL_MS);
    };

    const onVisibilityChange = () => {
      if (isPageVisible()) {
        if (flushTimerRef.current) {
          clearTimeout(flushTimerRef.current);
          flushTimerRef.current = null;
        }
        doFlush();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

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
            bumpSseEvent();
            const data = JSON.parse(event.data);
            const p = pendingRef.current;

            if (data.type === 'recipe_batch_update') {
              const key = data.recipeKey || data.recipeName;
              p.recipeBatch[key] = {
                completedBatches: data.completedBatches,
                requestedBatches: data.requestedBatches,
                recipeName: data.recipeName,
                orderId: data.orderId,
                gate: data.gate,
                gates: data.gates || [],
                lastUpdated: data.ts,
              };
            } else if (data.type === 'order_batch_update') {
              p.orderBatch[data.orderId] = {
                completedBatches: data.completedBatches,
                requestedBatches: data.requestedBatches,
                recipeName: data.recipeName,
                lastUpdated: data.ts,
              };
            } else if (data.type === 'order_completed') {
              p.orderCompleted[data.orderId] = {
                completedBatches: data.completedBatches,
                status: 'completed',
                lastUpdated: data.ts,
              };
            } else if (data.type === 'recipe_completed') {
              const key = data.recipeKey || data.recipeName;
              p.completions.push({
                recipeKey: key,
                recipeName: data.recipeName,
                completedBatches: data.completedBatches,
                requestedBatches: data.requestedBatches,
                orderId: data.orderId,
                gate: data.gate,
                gates: data.gates || [],
                ts: data.ts,
              });
            } else if (data.type === 'batch_limit_transition_started') {
              p.transitions[data.recipeKey] = {
                transitioning: true,
                recipeName: data.recipeName,
                completedBatches: data.completedBatches,
                requestedBatches: data.requestedBatches,
                gates: data.gates || [],
                startedAt: data.ts,
              };
            } else if (data.type === 'gate_handoff') {
              p.handoffs.push({
                gate: data.gate,
                fromRecipe: data.fromRecipe,
                fromRecipeKey: data.fromRecipeKey,
                toRecipe: data.toRecipe,
                handoffType: data.handoffType,
                assigned: data.assigned,
                needed: data.needed,
                ts: data.ts,
              });
            } else {
              p.machine = data;
            }

            scheduleFlush();
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

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (flushTimerRef.current) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
    };
  }, [disabled]);

  // Prune stale entries from orderUpdates/recipeBatchUpdates every 60s
  useEffect(() => {
    if (disabled) return;
    const pruneTimer = setInterval(() => {
      const ms = machineStateRef.current;
      const activeRecipes = ms.activeRecipes || [];
      const orderQueue = ms.orderQueue || [];

      if (ms.state === 'idle') {
        setOrderUpdates(prev => Object.keys(prev).length ? {} : prev);
        setRecipeBatchUpdates(prev => Object.keys(prev).length ? {} : prev);
        return;
      }

      const activeOrderIds = new Set();
      const activeRecipeKeys = new Set();
      activeRecipes.forEach(r => {
        if (r.orderId) activeOrderIds.add(String(r.orderId));
        activeRecipeKeys.add(r.recipeName);
        if (r.recipeKey) activeRecipeKeys.add(r.recipeKey);
        if (r.orderId) activeRecipeKeys.add(`order_${r.orderId}`);
      });
      orderQueue.forEach(o => {
        if (o.orderId) activeOrderIds.add(String(o.orderId));
        if (o.recipeName) activeRecipeKeys.add(o.recipeName);
        if (o.orderId) activeRecipeKeys.add(`order_${o.orderId}`);
      });

      setOrderUpdates(prev => {
        const keys = Object.keys(prev);
        if (!keys.length) return prev;
        const next = {};
        for (const k of keys) {
          if (activeOrderIds.has(k)) next[k] = prev[k];
        }
        return keys.length === Object.keys(next).length ? prev : next;
      });

      setRecipeBatchUpdates(prev => {
        const keys = Object.keys(prev);
        if (!keys.length) return prev;
        const next = {};
        for (const k of keys) {
          if (activeRecipeKeys.has(k) || activeRecipeKeys.has(prev[k]?.recipeName)) {
            next[k] = prev[k];
          }
        }
        return keys.length === Object.keys(next).length ? prev : next;
      });
    }, 60000);
    return () => clearInterval(pruneTimer);
  }, [disabled]);

  // Clear recipe completions after they've been processed
  const clearRecipeCompletions = () => setRecipeCompletions([]);

  // Clear gate handoffs after they've been processed
  const clearGateHandoffs = () => setGateHandoffs([]);

  return {
    state: machineState.state,
    activeRecipes: machineState.activeRecipes || EMPTY_ARRAY,
    currentProgramId: machineState.currentProgramId,
    programStartRecipes: machineState.programStartRecipes || EMPTY_ARRAY,
    transitioningGates: machineState.transitioningGates || EMPTY_ARRAY,
    completedTransitionGates: machineState.completedTransitionGates || EMPTY_ARRAY,
    transitionStartRecipes: machineState.transitionStartRecipes || EMPTY_OBJECT,
    transitionOldProgramId: machineState.transitionOldProgramId || null,
    registeredTransitioningGates: machineState.registeredTransitioningGates || EMPTY_ARRAY,
    orderQueue: machineState.orderQueue || EMPTY_ARRAY,
    gateSnapshot: machineState.gateSnapshot || EMPTY_ARRAY,
    pausedGates: machineState.pausedGates || EMPTY_ARRAY,
    weightTareG: machineState.weightTareG ?? 0,
    lastUpdated: machineState.lastUpdated,
    orderUpdates,
    recipeBatchUpdates,
    recipeCompletions,
    clearRecipeCompletions,
    batchLimitTransitions,
    gateHandoffs,
    clearGateHandoffs,
    isConnected,
    error,
    refetch: fetchState,
  };
}

export default useMachineState;
