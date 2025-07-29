import axios from 'axios';

const API_URL = 'http://localhost:5000/api';

const authService = {
  login: async (username, password, role) => {
    try {
      const response = await axios.post(`${API_URL}/auth/login`, {
        username,
        password,
        role
      });
      return response.data;
    } catch (error) {
      throw new Error(error.response?.data?.message || 'Login failed');
    }
  },

  validateToken: async () => {
    const token = localStorage.getItem('token');
    if (!token) {
      throw new Error('No token found');
    }
    
    try {
      const response = await axios.post(
        `${API_URL}/auth/validate`,
        {},
        {
          headers: {
            Authorization: `Bearer ${token}`
          }
        }
      );
      return response.data.user;
    } catch (error) {
      // Remove invalid token
      localStorage.removeItem('token');
      throw new Error('Invalid token');
    }
  }
};

export default authService;