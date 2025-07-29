import React from 'react';
import { Route, Redirect } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

export const PrivateRoute = ({ component: Component, allowedRoles, ...rest }) => {
  const { token, role } = useAuth();
  return (
    <Route
      {...rest}
      render={props =>
        token && allowedRoles.includes(role) ? (
          <Component {...props} />
        ) : (
          <Redirect to="/" />
        )
      }
    />
  );
};