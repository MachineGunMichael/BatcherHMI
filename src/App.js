import { useState } from "react";
import { ColorModeContext, useMode } from "./theme";
import { CssBaseline, ThemeProvider, CircularProgress, Box } from "@mui/material";
import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import Topbar from "./scenes/global/Topbar";
import Sidebar from "./scenes/global/Sidebar";
import Dashboard from "./scenes/dashboard";
import Settings from "./scenes/settings";
import Simulator from "./scenes/simulation";
import Login from "./components/auth/Login";
import Unauthorized from "./components/auth/Unauthorized";
import { AppProvider } from "./context/AppContext";
import { useAuth } from "./auth/AuthContext";

// Protected route component
const ProtectedRoute = ({ children, allowedRoles = [] }) => {
  const { user, isAuthenticated, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" height="100vh">
        <CircularProgress />
      </Box>
    );
  }

  if (!isAuthenticated) {
    // Redirect to login if not authenticated
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // Check if user's role is allowed
  if (allowedRoles.length > 0 && !allowedRoles.includes(user.role)) {
    return <Navigate to="/unauthorized" replace />;
  }

  return children;
};

function App() {
  const [theme, colorMode] = useMode();
  const [isSidebar, setIsSidebar] = useState(true);
  const { isAuthenticated, loading } = useAuth();

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" height="100vh">
        <CircularProgress />
      </Box>
    );
  }

  return (
    <ColorModeContext.Provider value={colorMode}>
      <ThemeProvider theme={theme}>
        <AppProvider>
          <CssBaseline />
          <div className="app">
            {isAuthenticated && <Sidebar isSidebar={isSidebar} />}
            <main className="content">
              {isAuthenticated && <Topbar setIsSidebar={setIsSidebar} />}
              <Routes>
                {/* Public routes */}
                <Route path="/login" element={isAuthenticated ? <Navigate to="/" /> : <Login />} />
                <Route path="/unauthorized" element={<Unauthorized />} />

                {/* Protected routes */}
                <Route path="/" element={
                  <ProtectedRoute>
                    <Dashboard />
                  </ProtectedRoute>
                } />
                <Route path="/settings" element={
                  <ProtectedRoute allowedRoles={['admin', 'manager']}>
                    <Settings />
                  </ProtectedRoute>
                } />
                <Route path="/simulation" element={
                  <ProtectedRoute allowedRoles={['admin', 'manager']}>
                    <Simulator />
                  </ProtectedRoute>
                } />

                {/* Fallback */}
                <Route path="*" element={<Navigate to="/" />} />
              </Routes>
            </main>
          </div>
        </AppProvider>
      </ThemeProvider>
    </ColorModeContext.Provider>
  );
}

export default App;