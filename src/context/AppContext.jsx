import React, { createContext, useState, useContext, useEffect } from 'react';

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
  
  // Assigned Recipes (shared between Setup and MachineControls)
  const [assignedRecipes, setAssignedRecipesState] = useState([]);

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
    
    try {
      const assignedRecipesData = localStorage.getItem('assignedRecipes');
      if (assignedRecipesData) {
        setAssignedRecipesState(JSON.parse(assignedRecipesData));
      }
    } catch (error) { /* ignore */ }
  }, []);

  // Update function with localStorage persistence
  const setDashboardVisibleSeries = (value) => {
    if (typeof value === 'function') {
      setDashboardVisibleSeriesState(prev => {
        const updated = value(prev);
        try {
          localStorage.setItem('dashboard_visibleSeries', JSON.stringify(updated));
        } catch (error) { /* ignore */ }
        return updated;
      });
    } else {
      setDashboardVisibleSeriesState(value);
      try {
        localStorage.setItem('dashboard_visibleSeries', JSON.stringify(value));
      } catch (error) { /* ignore */ }
    }
  };
  
  const setSelectedSimulation = (value) => {
    setSelectedSimulationState(value);
    try {
      localStorage.setItem('simulation_selectedSimulation', value);
    } catch (error) { /* ignore */ }
  };
  
  const setSliderValue = (value) => {
    setSliderValueState(value);
    try {
      localStorage.setItem('simulation_sliderValue', String(value));
    } catch (error) { /* ignore */ }
  };
  
  const setSettingsMode = (value) => {
    setSettingsModeState(value);
    try {
      localStorage.setItem('settings_mode', value);
    } catch (error) { /* ignore */ }
  };
  
  const setAssignedPrograms = (value) => {
    if (typeof value === 'function') {
      setAssignedProgramsState(prev => {
        const updated = value(prev);
        try {
          localStorage.setItem('settings_assignedPrograms', JSON.stringify(updated));
        } catch (error) { /* ignore */ }
        return updated;
      });
    } else {
      setAssignedProgramsState(value);
      try {
        localStorage.setItem('settings_assignedPrograms', JSON.stringify(value));
      } catch (error) { /* ignore */ }
    }
  };
  
  const setAssignedRecipes = (value) => {
    if (typeof value === 'function') {
      setAssignedRecipesState(prev => {
        const updated = value(prev);
        try {
          localStorage.setItem('assignedRecipes', JSON.stringify(updated));
        } catch (error) { /* ignore */ }
        return updated;
      });
    } else {
      setAssignedRecipesState(value);
      try {
        localStorage.setItem('assignedRecipes', JSON.stringify(value));
      } catch (error) { /* ignore */ }
    }
  };

  const contextValue = {
    // Role
    currentRole,
    setCurrentRole,
    
    // Dashboard
    dashboardVisibleSeries,
    setDashboardVisibleSeries,
    
    // Simulation
    selectedSimulation,
    setSelectedSimulation,
    sliderValue,
    setSliderValue,
    
    // Settings
    settingsMode,
    setSettingsMode,
    assignedPrograms,
    setAssignedPrograms,
    
    // Assigned Recipes (shared between Setup and MachineControls)
    assignedRecipes,
    setAssignedRecipes,
  };

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
    };
  }
  return context;
}

// For backward compatibility
export { AppContextProvider as AppProvider };
