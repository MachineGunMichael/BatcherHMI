import React from 'react';
import { useAuth } from '../auth/AuthContext';

const LogoutButton = () => {
  const { logout } = useAuth();
  return (
    <button
      onClick={logout}
      className="absolute top-4 right-4 px-3 py-1 bg-red-500 text-white rounded hover:bg-red-600"
    >
      Logout
    </button>
  );
};

export default LogoutButton;