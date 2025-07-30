// Mock auth service for development
const authService = {
  login: async (username, password, role) => {
    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Mock credential validation - make it more flexible
    // Allow simple credentials for testing
    if ((role === 'admin' && username === 'admin' && password === 'admin') ||
        (role === 'manager' && username === 'manager' && password === 'manager') ||
        (role === 'operator' && username === 'operator' && password === 'operator')) {
      
      const mockUser = {
        id: 1,
        username,
        role,
        name: `${role.charAt(0).toUpperCase() + role.slice(1)} User`
      };
      
      const mockToken = `mock-token-${role}-${Date.now()}`;
      
      return {
        user: mockUser,
        token: mockToken
      };
    } 
    
    // Also try the server database credentials
    else if ((role === 'admin' && username === 'admin' && password === 'admin123') ||
             (role === 'manager' && username === 'manager' && password === 'manager123') ||
             (role === 'operator' && username === 'operator' && password === 'operator123')) {
      
      const mockUser = {
        id: 1,
        username,
        role,
        name: `${role.charAt(0).toUpperCase() + role.slice(1)} User`
      };
      
      const mockToken = `mock-token-${role}-${Date.now()}`;
      
      return {
        user: mockUser,
        token: mockToken
      };
    } 
    else {
      throw new Error('Invalid username or password');
    }
  },

  validateToken: async () => {
    const token = localStorage.getItem('token');
    if (!token || !token.startsWith('mock-token-')) {
      throw new Error('Invalid token');
    }
    
    // Extract role from token
    const parts = token.split('-');
    const role = parts[2];
    
    return {
      id: 1,
      username: role,
      role,
      name: `${role.charAt(0).toUpperCase() + role.slice(1)} User`
    };
  }
};

export default authService;