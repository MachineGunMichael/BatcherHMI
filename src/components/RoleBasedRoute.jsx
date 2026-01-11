import React, { useEffect, useRef } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAppContext } from '../context/AppContext';
import { hasRouteAccess, getDefaultRouteForRole } from '../config/roleRoutes';
import logService from '../services/logService';

const RoleBasedRoute = ({ children, requiredRoute }) => {
  const { currentRole } = useAppContext();
  const location = useLocation();
  const lastLoggedPath = useRef(null);
  
  // Log page view when route changes
  useEffect(() => {
    const currentPath = location.pathname;
    if (currentPath !== lastLoggedPath.current) {
      lastLoggedPath.current = currentPath;
      logService.pageViewed(currentPath);
    }
  }, [location.pathname]);
  
  // Check if current role has access to this route
  if (!hasRouteAccess(currentRole, requiredRoute)) {
    // Redirect to default route for this role
    return <Navigate to={getDefaultRouteForRole(currentRole)} replace />;
  }
  
  return children;
};

export default RoleBasedRoute;
