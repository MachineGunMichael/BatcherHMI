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
  
  const getRoleView = () => {
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
  };

  return (
    <ColorModeContext.Provider value={colorMode}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <div className="app">
          <Sidebar />
          <main className="content">
            <Topbar />
            {getRoleView()}
          </main>
        </div>
      </ThemeProvider>
    </ColorModeContext.Provider>
  );
}

export default App;