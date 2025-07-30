import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { getRoutesForRole, getDefaultRouteForRole } from '../config/roleRoutes';
import RoleBasedRoute from '../components/RoleBasedRoute';

const OperatorView = () => {
  const operatorRoutes = getRoutesForRole('operator');
  const defaultRoute = getDefaultRouteForRole('operator');

  return (
    <Routes>
      {operatorRoutes.map((route) => (
        <Route
          key={route.path}
          path={route.path}
          element={
            <RoleBasedRoute requiredRoute={route.path}>
              <route.component />
            </RoleBasedRoute>
          }
        />
      ))}
      <Route path="/" element={<Navigate to={defaultRoute} replace />} />
      <Route path="*" element={<Navigate to={defaultRoute} replace />} />
    </Routes>
  );
};

export default OperatorView;
