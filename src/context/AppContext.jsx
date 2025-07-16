import { createContext, useState, useContext, useEffect } from 'react';

// Create the AppContext
const AppContext = createContext();

// Create the AppContext Provider component
export const AppProvider = ({ children }) => {
  // Dashboard state
  const [dashboardVisibleSeries, setDashboardVisibleSeries] = useState(() => {
    const saved = localStorage.getItem('dashboard_visibleSeries');
    return saved ? JSON.parse(saved) : {
      "Program A": true,
      "Program B": true,
      "Program C": true,
      "Program D": true,
      "Total": true
    };
  });

  // Simulation state
  const [selectedSimulation, setSelectedSimulation] = useState(() => {
    return localStorage.getItem('simulation_selectedSimulation') || "";
  });
  
  const [sliderValue, setSliderValue] = useState(() => {
    return Number(localStorage.getItem('simulation_sliderValue') || "0");
  });

  // Settings state
  const [settingsMode, setSettingsMode] = useState(() => {
    return localStorage.getItem('settings_mode') || "preset";
  });
  
  const [assignedPrograms, setAssignedPrograms] = useState(() => {
    const saved = localStorage.getItem('settings_assignedPrograms');
    return saved ? JSON.parse(saved) : [];
  });

  // Save dashboard state to localStorage when it changes
  useEffect(() => {
    localStorage.setItem('dashboard_visibleSeries', JSON.stringify(dashboardVisibleSeries));
  }, [dashboardVisibleSeries]);

  // Save simulation state to localStorage when it changes
  useEffect(() => {
    localStorage.setItem('simulation_selectedSimulation', selectedSimulation);
  }, [selectedSimulation]);

  useEffect(() => {
    localStorage.setItem('simulation_sliderValue', String(sliderValue));
  }, [sliderValue]);

  // Save settings state to localStorage when it changes
  useEffect(() => {
    localStorage.setItem('settings_mode', settingsMode);
  }, [settingsMode]);

  useEffect(() => {
    localStorage.setItem('settings_assignedPrograms', JSON.stringify(assignedPrograms));
  }, [assignedPrograms]);

  return (
    <AppContext.Provider value={{
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
    }}>
      {children}
    </AppContext.Provider>
  );
};

// Create a custom hook to use the AppContext
export const useAppContext = () => useContext(AppContext); 