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
            setMachineState(data);
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
    lastUpdated: machineState.lastUpdated,
    isConnected,
    error,
    refetch: fetchState,
  };
}

export default useMachineState;
