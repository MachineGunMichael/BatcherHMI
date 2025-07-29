const bcrypt = require('bcryptjs');

// This is a simple in-memory user database
// In a production environment, you would use a real database
const users = [
  {
    id: 1,
    username: 'admin',
    password: 'admin123',
    // password: '$2a$10$LGq/QznKVFYfyQDNcZR9p.vgT9XR7UUEfcENrwHsUvYZcEPGQIVZu',
    role: 'admin',
    name: 'System Administrator',
    permissions: ['read', 'write', 'execute', 'configure']
  },
  {
    id: 2,
    username: 'manager',
    password: 'manager123',
    // password: '$2a$10$FvTPbmt3Tus0.ewNoJTige6BXDEJdACrvaXdEtmMzVnexzAw8vj4G',
    role: 'manager',
    name: 'Production Manager',
    permissions: ['read', 'write', 'execute']
  },
  {
    id: 3,
    username: 'operator',
    password: 'operator123',
    // password: '$2a$10$VIGsw1Bt/0f.3IZfQnB3H.0NYtsHtDVPBeQG11WioEYpJ3hJH7iKW',
    role: 'operator',
    name: 'Line Operator',
    permissions: ['read', 'execute']
  }
];

// Helper function to find a user by credentials
const findUserByCredentials = async (username, password, role) => {
  const user = users.find(u => u.username === username && u.role === role);
  if (!user) return null;
  
  // For now, use plain text password comparison (not secure for production)
  // TODO: Use bcrypt for production
  const isPasswordValid = user.password === password;
  if (!isPasswordValid) return null;
  
  return user;
};

// Helper function to find a user by ID
const findUserById = (id) => {
  return users.find(u => u.id === id) || null;
};

// Helper function to get a safe user object (without password)
const getSafeUser = (user) => {
  if (!user) return null;
  
  const { password, ...safeUser } = user;
  return safeUser;
};

// Helper to create a new hashed password (for adding new users)
const hashPassword = async (password) => {
  return await bcrypt.hash(password, 10);
};

module.exports = {
  findUserByCredentials,
  findUserById,
  getSafeUser,
  hashPassword,
  users
};