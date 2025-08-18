import React, { useMemo } from "react";
import { ColorModeContext, useMode } from "./theme";
import { CssBaseline, ThemeProvider } from "@mui/material";
import { Routes, Route } from "react-router-dom";
import Topbar from "./scenes/global/Topbar";
import Sidebar from "./scenes/global/Sidebar";
import AdminView from './scenes/AdminView';
import ManagerView from './scenes/ManagerView';
import OperatorView from './scenes/OperatorView';
import { useAppContext } from './context/AppContext';
import { useAuth } from './auth/AuthContext';
import Login from './components/auth/Login';

function App() {
  // Call all hooks at the top level - never conditionally
  const modeResult = useMode();
  const context = useAppContext();
  const authContext = useAuth();
  
  // Extract values with defaults
  const [theme, colorMode] = modeResult || [null, null];
  const { currentRole = 'admin' } = context || {};
  const { isAuthenticated = false } = authContext || {};

  // Use useMemo for expensive components
  const MemoizedRoleView = useMemo(() => {
    console.log('Recalculating role view for:', currentRole);
    
    switch (currentRole) {
      case 'admin':
        return <AdminView />;
      case 'manager':
        return <ManagerView />;
      case 'operator':
        return <OperatorView />;
      default:
        return <AdminView />;
    }
  }, [currentRole]); // Only recalculate when role changes

  // Add debugging
  console.log('App render - isAuthenticated:', isAuthenticated, 'currentRole:', currentRole);

  // Early return only after all hooks are called
  if (!theme || !colorMode) {
    return <div>Loading theme...</div>;
  }

  if (!context) {
    return <div>Loading context...</div>;
  }

  // Show login page if not authenticated
  if (!isAuthenticated) {
    console.log('Showing login page');
    return (
      <ColorModeContext.Provider value={colorMode}>
        <ThemeProvider theme={theme}>
          <CssBaseline />
          <Login />
        </ThemeProvider>
      </ColorModeContext.Provider>
    );
  }

  console.log('Showing authenticated view for role:', currentRole);
  

  return (
    <ColorModeContext.Provider value={colorMode}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <div className="app">
          <Sidebar />
          <main className="content">
            <Topbar />
            {MemoizedRoleView}
          </main>
        </div>
      </ThemeProvider>
    </ColorModeContext.Provider>
  );
}

export default React.memo(App); // Memoize the entire App component