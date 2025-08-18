const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:5001';

// Helper function to handle fetch errors
const handleResponse = async (response) => {
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.message || `Error ${response.status}: ${response.statusText}`);
  }
  return response.json();
};

// Helper function to provide better error messages for network errors
const handleNetworkError = (error) => {
  // Check for common network error patterns
  if (error.message === "Failed to fetch" || 
      error.message.includes("NetworkError") ||
      error.message.includes("Network Error") ||
      error.name === "AbortError" ||
      error.name === "TypeError") {
    throw new Error("Cannot connect to authentication server. Please check if the server is running.");
  }
  
  // Otherwise pass through the original error
  throw error;
};

const authService = {
  login: async (username, password, role) => {
    try {
      console.log(`Attempting to login at ${API_URL}/api/auth/login`);
      const response = await fetch(`${API_URL}/api/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username, password, role }),
        // Add explicit timeout to prevent hanging requests
        signal: AbortSignal.timeout(5000)
      });
      
      return handleResponse(response);
    } catch (error) {
      console.error("Login request failed:", error);
      return handleNetworkError(error);
    }
  },
  
  validateToken: async () => {
    try {
      const token = localStorage.getItem('token');
      if (!token) {
        throw new Error("No authentication token found");
      }
      
      const response = await fetch(`${API_URL}/api/auth/validate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        // Add explicit timeout
        signal: AbortSignal.timeout(5000)
      });
      
      const data = await handleResponse(response);
      return data.user;
    } catch (error) {
      console.error("Token validation failed:", error);
      return handleNetworkError(error);
    }
  },
  
  // Additional methods as needed
};

export default authService;
