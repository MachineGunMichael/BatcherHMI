import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import authService from '../services/authService';
import { useAppContext } from '../context/AppContext';
import useIdleTimeout from '../hooks/useIdleTimeout';

// Idle timeout configuration: 12 hours in milliseconds
const IDLE_TIMEOUT_MS = 12 * 60 * 60 * 1000;

const AuthContext = createContext();

// Helper function to check server connectivity
const checkServerConnectivity = async () => {
  const API_URL = process.env.REACT_APP_API_URL || '';
  
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    
    const response = await fetch(`${API_URL}`, {
      method: 'GET',
      signal: controller.signal,
      mode: 'cors',
      cache: 'no-cache'
    });
    
    clearTimeout(timeoutId);
    return true;
  } catch (error) {
    // Try alternative method
    try {
      const img = document.createElement('img');
      img.src = `${API_URL}/favicon.ico?_=${Date.now()}`;
      
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = resolve; // Even errors mean server responded
        setTimeout(() => reject(new Error("Timeout")), 3000);
      });
      
      return true;
    } catch (secondError) {
      return false;
    }
  }
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const navigate = useNavigate();
  const { setCurrentRole } = useAppContext();

  // Check if user is already logged in
  useEffect(() => {
    const checkLoggedIn = async () => {
      const token = localStorage.getItem('token');
      if (token) {
        try {
          setLoading(true);
          
          const isServerAvailable = await checkServerConnectivity();
          if (!isServerAvailable) {
            throw new Error("Authentication server is not available");
          }
          
          const userData = await authService.validateToken();
          setUser(userData);
          setCurrentRole(userData.role);
          setIsAuthenticated(true);
        } catch (error) {
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
  const login = async (username, password) => {
    setLoading(true);
    setError('');
    
    try {
      const isServerAvailable = await checkServerConnectivity();
      if (!isServerAvailable) {
        throw new Error("Authentication server is not available. Please check if the server is running.");
      }
      
      const data = await authService.login(username, password);
      
      if (!data || !data.token) {
        throw new Error("Invalid authentication response");
      }
      
      setUser(data.user);
      localStorage.setItem('token', data.token);
      setCurrentRole(data.user.role);
      setIsAuthenticated(true);
      
      navigate('/');
      
      return { success: true, user: data.user };
    } catch (error) {
      const errorMessage = error.message || "Authentication failed";
      setError(errorMessage);
      setIsAuthenticated(false);
      return { success: false, error: errorMessage };
    } finally {
      setLoading(false);
    }
  };

  // Logout function
  const logout = useCallback((reason = 'manual') => {
    setUser(null);
    setIsAuthenticated(false);
    localStorage.removeItem('token');
    localStorage.removeItem('lastActivityTimestamp');
    navigate('/login');
  }, [navigate]);

  // Idle timeout - logs out user after 2 hours of inactivity
  useIdleTimeout(
    () => logout('idle'),
    IDLE_TIMEOUT_MS,
    isAuthenticated
  );

  const value = { 
    user, 
    login, 
    logout, 
    loading, 
    error,
    isAuthenticated,
    clearError: () => setError(null)
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => useContext(AuthContext);

export default AuthContext;
