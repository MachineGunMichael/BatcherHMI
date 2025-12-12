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
    transitionStartRecipes: {},
    lastUpdated: null,
  });
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState(null);
  const eventSourceRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);

  // Fetch initial state
  const fetchState = async () => {
    try {
      // Note: api already has /api as baseURL, so don't duplicate it
      const response = await api.get('/machine/state');
      setMachineState(response.data);
      setError(null);
    } catch (err) {
      console.error('[useMachineState] Error fetching state:', err);
      setError(err.message);
    }
  };

  // Setup SSE connection
  useEffect(() => {
    const connectSSE = () => {
      try {
        // SSE endpoint is at http://localhost:5001/api/machine/stream
        // REACT_APP_API_URL might include /api suffix, so we need to handle both cases
        let baseURL = process.env.REACT_APP_API_URL || 'http://localhost:5001/api';
        // Remove trailing /api if present, then add the full path
        baseURL = baseURL.replace(/\/api\/?$/, '');
        const url = `${baseURL}/api/machine/stream`;
        
        console.log('[useMachineState] Connecting to SSE:', url);
        const eventSource = new EventSource(url);
        eventSourceRef.current = eventSource;

        eventSource.onopen = () => {
          console.log('[useMachineState] SSE connected');
          setIsConnected(true);
          setError(null);
        };

        eventSource.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            console.log('[useMachineState] State update:', data);
            setMachineState(data);
          } catch (err) {
            console.error('[useMachineState] Error parsing SSE data:', err);
          }
        };

        eventSource.onerror = (err) => {
          console.error('[useMachineState] SSE error:', err);
          setIsConnected(false);
          eventSource.close();
          
          // Attempt to reconnect after 5 seconds
          reconnectTimeoutRef.current = setTimeout(() => {
            console.log('[useMachineState] Attempting to reconnect...');
            connectSSE();
          }, 5000);
        };
      } catch (err) {
        console.error('[useMachineState] Error creating EventSource:', err);
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

  return {
    state: machineState.state,
    activeRecipes: machineState.activeRecipes,
    currentProgramId: machineState.currentProgramId,
    programStartRecipes: machineState.programStartRecipes,
    transitioningGates: machineState.transitioningGates || [],
    transitionStartRecipes: machineState.transitionStartRecipes || {},
    lastUpdated: machineState.lastUpdated,
    isConnected,
    error,
    refetch: fetchState,
  };
}

export default useMachineState;

