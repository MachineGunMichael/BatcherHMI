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
  
  // DEBUG - Log state changes
  useEffect(() => {
    console.log("Context state changed:", {
      currentRole,
      dashboardVisibleSeries,
      selectedSimulation,
      sliderValue,
      settingsMode,
      assignedPrograms
    });
  }, [currentRole, dashboardVisibleSeries, selectedSimulation, sliderValue, settingsMode, assignedPrograms]);

  // Load persisted data on mount
  useEffect(() => {
    console.log("Loading persisted data");
    
    try {
      const dashboardData = localStorage.getItem('dashboard_visibleSeries');
      if (dashboardData) {
        const parsed = JSON.parse(dashboardData);
        console.log("Loaded dashboard data:", parsed);
        setDashboardVisibleSeriesState(parsed);
      }
    } catch (error) {
      console.error("Error loading dashboard data:", error);
    }
    
    try {
      const simulationData = localStorage.getItem('simulation_selectedSimulation');
      if (simulationData) {
        console.log("Loaded simulation selection:", simulationData);
        setSelectedSimulationState(simulationData);
      }
    } catch (error) {
      console.error("Error loading simulation selection:", error);
    }
    
    try {
      const sliderData = localStorage.getItem('simulation_sliderValue');
      if (sliderData) {
        console.log("Loaded slider value:", sliderData);
        setSliderValueState(Number(sliderData));
      }
    } catch (error) {
      console.error("Error loading slider value:", error);
    }
    
    try {
      const settingsModeData = localStorage.getItem('settings_mode');
      if (settingsModeData) {
        console.log("Loaded settings mode:", settingsModeData);
        setSettingsModeState(settingsModeData);
      }
    } catch (error) {
      console.error("Error loading settings mode:", error);
    }
    
    try {
      const assignedProgramsData = localStorage.getItem('settings_assignedPrograms');
      if (assignedProgramsData) {
        const parsed = JSON.parse(assignedProgramsData);
        console.log("Loaded assigned programs:", parsed);
        setAssignedProgramsState(parsed);
      }
    } catch (error) {
      console.error("Error loading assigned programs:", error);
    }
  }, []);

  // Update function with localStorage persistence
  const setDashboardVisibleSeries = (value) => {
    console.log("Setting dashboard visible series:", value);
    if (typeof value === 'function') {
      setDashboardVisibleSeriesState(prev => {
        const updated = value(prev);
        try {
          localStorage.setItem('dashboard_visibleSeries', JSON.stringify(updated));
        } catch (error) {
          console.error("Error saving dashboard data:", error);
        }
        return updated;
      });
    } else {
      setDashboardVisibleSeriesState(value);
      try {
        localStorage.setItem('dashboard_visibleSeries', JSON.stringify(value));
      } catch (error) {
        console.error("Error saving dashboard data:", error);
      }
    }
  };
  
  const setSelectedSimulation = (value) => {
    console.log("Setting selected simulation:", value);
    setSelectedSimulationState(value);
    try {
      localStorage.setItem('simulation_selectedSimulation', value);
    } catch (error) {
      console.error("Error saving simulation selection:", error);
    }
  };
  
  const setSliderValue = (value) => {
    console.log("Setting slider value:", value);
    setSliderValueState(value);
    try {
      localStorage.setItem('simulation_sliderValue', String(value));
    } catch (error) {
      console.error("Error saving slider value:", error);
    }
  };
  
  const setSettingsMode = (value) => {
    console.log("Setting settings mode:", value);
    setSettingsModeState(value);
    try {
      localStorage.setItem('settings_mode', value);
    } catch (error) {
      console.error("Error saving settings mode:", error);
    }
  };
  
  const setAssignedPrograms = (value) => {
    console.log("Setting assigned programs:", value);
    if (typeof value === 'function') {
      setAssignedProgramsState(prev => {
        const updated = value(prev);
        try {
          localStorage.setItem('settings_assignedPrograms', JSON.stringify(updated));
        } catch (error) {
          console.error("Error saving assigned programs:", error);
        }
        return updated;
      });
    } else {
      setAssignedProgramsState(value);
      try {
        localStorage.setItem('settings_assignedPrograms', JSON.stringify(value));
      } catch (error) {
        console.error("Error saving assigned programs:", error);
      }
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
    console.error("useAppContext must be used within an AppContextProvider");
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
    };
  }
  return context;
}

// For backward compatibility
export { AppContextProvider as AppProvider };