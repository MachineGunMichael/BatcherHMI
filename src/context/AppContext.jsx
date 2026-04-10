import React, { createContext, useState, useContext, useEffect, useMemo, useCallback } from 'react';

// Create the context
const AppContext = createContext(null);

export function AppContextProvider({ children }) {
  // User role
  const [currentRole, setCurrentRole] = useState('admin');
  
  // Dashboard - Initialize with default values
  const [dashboardVisibleSeries, setDashboardVisibleSeriesState] = useState({
    "Program A": true,
    "Program B": true,
    "Program C": true,
    "Program D": true,
    "Total": true
  });
  
  // Simulation - Initialize with default values
  const [selectedSimulation, setSelectedSimulationState] = useState("");
  const [sliderValue, setSliderValueState] = useState(0);
  
  // Settings - Initialize with default values
  const [settingsMode, setSettingsModeState] = useState("preset");
  const [assignedPrograms, setAssignedProgramsState] = useState([]);
  
  // Assigned Recipes (queue - shared between Setup and MachineControls)
  const [assignedRecipes, setAssignedRecipesState] = useState([]);
  
  // Active Recipes (currently running on gates - includes order info)
  const [activeRecipes, setActiveRecipesState] = useState([]);
  
  // Recipe to Order mapping (for displaying order info on Dashboard)
  // { recipeName: { orderId, customerName, requestedBatches, completedBatches, status } }
  const [recipeOrderMap, setRecipeOrderMapState] = useState({});

  // Load persisted data on mount
  useEffect(() => {
    try {
      const dashboardData = localStorage.getItem('dashboard_visibleSeries');
      if (dashboardData) {
        setDashboardVisibleSeriesState(JSON.parse(dashboardData));
      }
    } catch (error) { /* ignore */ }
    
    try {
      const simulationData = localStorage.getItem('simulation_selectedSimulation');
      if (simulationData) {
        setSelectedSimulationState(simulationData);
      }
    } catch (error) { /* ignore */ }
    
    try {
      const sliderData = localStorage.getItem('simulation_sliderValue');
      if (sliderData) {
        setSliderValueState(Number(sliderData));
      }
    } catch (error) { /* ignore */ }
    
    try {
      const settingsModeData = localStorage.getItem('settings_mode');
      if (settingsModeData) {
        setSettingsModeState(settingsModeData);
      }
    } catch (error) { /* ignore */ }
    
    try {
      const assignedProgramsData = localStorage.getItem('settings_assignedPrograms');
      if (assignedProgramsData) {
        setAssignedProgramsState(JSON.parse(assignedProgramsData));
      }
    } catch (error) { /* ignore */ }
    
    // Note: assignedRecipes (order queue) is now loaded from backend database
    // in the Setup component, not from localStorage
    
    try {
      const activeRecipesData = localStorage.getItem('activeRecipes');
      if (activeRecipesData) {
        setActiveRecipesState(JSON.parse(activeRecipesData));
      }
    } catch (error) { /* ignore */ }
    
    try {
      const recipeOrderMapData = localStorage.getItem('recipeOrderMap');
      if (recipeOrderMapData) {
        setRecipeOrderMapState(JSON.parse(recipeOrderMapData));
      }
    } catch (error) { /* ignore */ }
  }, []);

  // Stable setter wrappers — useCallback keeps references stable across renders
  const setDashboardVisibleSeries = useCallback((value) => {
    if (typeof value === 'function') {
      setDashboardVisibleSeriesState(prev => {
        const updated = value(prev);
        try { localStorage.setItem('dashboard_visibleSeries', JSON.stringify(updated)); } catch (_) {}
        return updated;
      });
    } else {
      setDashboardVisibleSeriesState(value);
      try { localStorage.setItem('dashboard_visibleSeries', JSON.stringify(value)); } catch (_) {}
    }
  }, []);
  
  const setSelectedSimulation = useCallback((value) => {
    setSelectedSimulationState(value);
    try { localStorage.setItem('simulation_selectedSimulation', value); } catch (_) {}
  }, []);
  
  const setSliderValue = useCallback((value) => {
    setSliderValueState(value);
    try { localStorage.setItem('simulation_sliderValue', String(value)); } catch (_) {}
  }, []);
  
  const setSettingsMode = useCallback((value) => {
    setSettingsModeState(value);
    try { localStorage.setItem('settings_mode', value); } catch (_) {}
  }, []);
  
  const setAssignedPrograms = useCallback((value) => {
    if (typeof value === 'function') {
      setAssignedProgramsState(prev => {
        const updated = value(prev);
        try { localStorage.setItem('settings_assignedPrograms', JSON.stringify(updated)); } catch (_) {}
        return updated;
      });
    } else {
      setAssignedProgramsState(value);
      try { localStorage.setItem('settings_assignedPrograms', JSON.stringify(value)); } catch (_) {}
    }
  }, []);
  
  const setAssignedRecipes = useCallback((value) => {
    if (typeof value === 'function') {
      setAssignedRecipesState(prev => value(prev));
    } else {
      setAssignedRecipesState(value);
    }
  }, []);
  
  const setActiveRecipes = useCallback((value) => {
    if (typeof value === 'function') {
      setActiveRecipesState(prev => {
        const updated = value(prev);
        try { localStorage.setItem('activeRecipes', JSON.stringify(updated)); } catch (_) {}
        return updated;
      });
    } else {
      setActiveRecipesState(value);
      try { localStorage.setItem('activeRecipes', JSON.stringify(value)); } catch (_) {}
    }
  }, []);
  
  const setRecipeOrderMap = useCallback((value) => {
    if (typeof value === 'function') {
      setRecipeOrderMapState(prev => {
        const updated = value(prev);
        try { localStorage.setItem('recipeOrderMap', JSON.stringify(updated)); } catch (_) {}
        return updated;
      });
    } else {
      setRecipeOrderMapState(value);
      try { localStorage.setItem('recipeOrderMap', JSON.stringify(value)); } catch (_) {}
    }
  }, []);

  const contextValue = useMemo(() => ({
    currentRole, setCurrentRole,
    dashboardVisibleSeries, setDashboardVisibleSeries,
    selectedSimulation, setSelectedSimulation,
    sliderValue, setSliderValue,
    settingsMode, setSettingsMode,
    assignedPrograms, setAssignedPrograms,
    assignedRecipes, setAssignedRecipes,
    activeRecipes, setActiveRecipes,
    recipeOrderMap, setRecipeOrderMap,
  }), [
    currentRole, dashboardVisibleSeries, selectedSimulation, sliderValue,
    settingsMode, assignedPrograms, assignedRecipes, activeRecipes, recipeOrderMap,
    setCurrentRole, setDashboardVisibleSeries, setSelectedSimulation, setSliderValue,
    setSettingsMode, setAssignedPrograms, setAssignedRecipes, setActiveRecipes, setRecipeOrderMap,
  ]);

  return (
    <AppContext.Provider value={contextValue}>
      {children}
    </AppContext.Provider>
  );
}

// Custom hook with error handling
export function useAppContext() {
  const context = useContext(AppContext);
  if (context === null || context === undefined) {
    // Return default values instead of throwing - more resilient
    return {
      currentRole: 'admin',
      setCurrentRole: () => {},
      dashboardVisibleSeries: {
        "Program A": true,
        "Program B": true,
        "Program C": true,
        "Program D": true,
        "Total": true
      },
      setDashboardVisibleSeries: () => {},
      selectedSimulation: "",
      setSelectedSimulation: () => {},
      sliderValue: 0,
      setSliderValue: () => {},
      settingsMode: "preset",
      setSettingsMode: () => {},
      assignedPrograms: [],
      setAssignedPrograms: () => {},
      assignedRecipes: [],
      setAssignedRecipes: () => {},
      activeRecipes: [],
      setActiveRecipes: () => {},
      recipeOrderMap: {},
      setRecipeOrderMap: () => {},
    };
  }
  return context;
}

// For backward compatibility
export { AppContextProvider as AppProvider };
