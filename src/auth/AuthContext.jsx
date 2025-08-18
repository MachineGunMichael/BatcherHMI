import { createContext, useContext, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import authService from '../services/authService';
import { useAppContext } from '../context/AppContext';

const AuthContext = createContext();

// Helper function to check server connectivity
const checkServerConnectivity = async () => {
  const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:5001';
  console.log("Checking server connectivity at:", API_URL);
  
  try {
    // Use a more direct approach - just ping the base URL
    // Most servers will respond to this even without specific endpoint handling
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    
    const response = await fetch(`${API_URL}`, {
      method: 'GET',
      signal: controller.signal,
      // Skip content-type to avoid preflight CORS issues
      mode: 'cors',
      cache: 'no-cache'
    });
    
    clearTimeout(timeoutId);
    console.log("Server connectivity success - status:", response.status);
    return true;
  } catch (error) {
    console.error("Server connectivity failed:", error.name, error.message);
    
    // Try a second method if the first fails
    try {
      console.log("Trying alternative connectivity check...");
      // Use a very simple image request which often bypasses CORS
      const img = document.createElement('img');
      img.src = `${API_URL}/favicon.ico?_=${Date.now()}`;
      
      await new Promise((resolve, reject) => {
        img.onload = () => {
          console.log("Image load successful - server is running");
          resolve();
        };
        img.onerror = () => {
          // Even errors mean the server responded
          console.log("Image errored but server responded");
          resolve(); 
        };
        setTimeout(() => reject(new Error("Timeout")), 3000);
      });
      
      return true;
    } catch (secondError) {
      console.error("All connectivity checks failed");
      return false;
    }
  }
};

export const AuthProvider = ({ children }) => {
  // Initialize state
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const navigate = useNavigate();
  const { setCurrentRole } = useAppContext();

  // Check if user is already logged in (token exists)
  useEffect(() => {
    const checkLoggedIn = async () => {
      const token = localStorage.getItem('token');
      if (token) {
        try {
          setLoading(true);
          
          // First verify server is available
          const isServerAvailable = await checkServerConnectivity();
          if (!isServerAvailable) {
            throw new Error("Authentication server is not available");
          }
          
          const userData = await authService.validateToken();
          setUser(userData);
          setCurrentRole(userData.role);
          setIsAuthenticated(true);
          console.log("User restored from token:", userData);
        } catch (error) {
          console.error("Token validation failed:", error);
          localStorage.removeItem('token');
          setIsAuthenticated(false);
          setUser(null);
          setError("Server unavailable or token invalid. Please log in again.");
        } finally {
          setLoading(false);
        }
      } else {
        setLoading(false);
        setIsAuthenticated(false);
      }
    };

    checkLoggedIn();
  }, [setCurrentRole]);

  // Login function
  const login = async (username, password, role) => {
    setLoading(true);
    setError('');
    
    try {
      // First check server connectivity
      const isServerAvailable = await checkServerConnectivity();
      if (!isServerAvailable) {
        throw new Error("Authentication server is not available. Please check if the server is running.");
      }
      
      const data = await authService.login(username, password, role);
      
      // Verify we got a valid token from the server
      if (!data || !data.token) {
        throw new Error("Invalid authentication response");
      }
      
      setUser(data.user);
      localStorage.setItem('token', data.token);
      setCurrentRole(role);
      setIsAuthenticated(true);
      
      navigate('/');
      
      return { success: true, user: data.user };
    } catch (error) {
      const errorMessage = error.message || "Authentication failed";
      console.error("Login error:", errorMessage);
      setError(errorMessage);
      setIsAuthenticated(false);
      return { success: false, error: errorMessage };
    } finally {
      setLoading(false);
    }
  };

  // Logout function
  const logout = () => {
    setUser(null);
    setIsAuthenticated(false);
    localStorage.removeItem('token');
    navigate('/login');
  };

  const value = { 
    user, 
    login, 
    logout, 
    loading, 
    error,
    isAuthenticated, // Use the explicit state variable
    clearError: () => setError(null)
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => useContext(AuthContext);

export default AuthContext;