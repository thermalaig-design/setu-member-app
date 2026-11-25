import React from 'react';
import { Navigate } from 'react-router-dom';

const ProtectedRoute = ({ children }) => {
  // Check if user is authenticated using user object in localStorage
  const user = localStorage.getItem('user');
  const isLoggedInFlag = localStorage.getItem('isLoggedIn') === 'true';
  const hasUser = user !== null && user !== 'null' && user !== 'undefined';
  const isLoggedIn = hasUser && isLoggedInFlag;
  
  if (!isLoggedIn) {
    return <Navigate to="/login" replace />;
  }
  return children;
};

export default ProtectedRoute;
