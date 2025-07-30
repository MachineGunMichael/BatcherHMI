import { createContext, useContext, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import authService from '../services/authService';
import { useAppContext } from '../context/AppContext';

const AuthContext = createContext();

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
          const userData = await authService.validateToken();
          setUser(userData);
          setCurrentRole(userData.role);
          setIsAuthenticated(true); // Set to true only after successful validation
          console.log("User restored from token:", userData);
        } catch (error) {
          console.error("Token validation failed:", error);
          localStorage.removeItem('token');
          setIsAuthenticated(false);
          setUser(null);
        } finally {
          setLoading(false);
        }
      } else {
        setLoading(false);
        setIsAuthenticated(false);
      }
    };

    // Enable token validation check to persist login across refreshes
    checkLoggedIn();
  }, [setCurrentRole]);

  // Login function
  const login = async (username, password, role) => {
    setLoading(true);
    setError('');
    
    try {
      const data = await authService.login(username, password, role);
      setUser(data.user);
      localStorage.setItem('token', data.token);
      setCurrentRole(role);
      setIsAuthenticated(true); // Set authenticated after successful login
      
      // Navigate to dashboard after successful login
      navigate('/');
      
      return { success: true, user: data.user };
    } catch (error) {
      setError(error.message);
      setIsAuthenticated(false); // Ensure it's false on login failure
      return { success: false, error: error.message };
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