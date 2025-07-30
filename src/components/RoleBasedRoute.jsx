import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAppContext } from '../context/AppContext';
import { hasRouteAccess, getDefaultRouteForRole } from '../config/roleRoutes';

const RoleBasedRoute = ({ children, requiredRoute }) => {
  const { currentRole } = useAppContext();
  
  // Check if current role has access to this route
  if (!hasRouteAccess(currentRole, requiredRoute)) {
    // Redirect to default route for this role
    return <Navigate to={getDefaultRouteForRole(currentRole)} replace />;
  }
  
  return children;
};

export default RoleBasedRoute;
