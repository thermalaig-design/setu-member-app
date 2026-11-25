import React, { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useNavigation } from './NavigationContext';

/**
 * Wrapper component to automatically register back button callbacks for routes
 * Usage: <RouteBackButton onBack={() => navigate('/')}>
 *          <YourComponent />
 *        </RouteBackButton>
 */
export const RouteBackButton = ({ onBack, children }) => {
  const location = useLocation();
  const { registerBackCallback, unregisterBackCallback } = useNavigation();

  useEffect(() => {
    if (onBack && typeof onBack === 'function') {
      console.log(`✅ Registering back button for route: ${location.pathname}`);
      registerBackCallback(location.pathname, onBack);

      return () => {
        console.log(`❌ Unregistering back button for route: ${location.pathname}`);
        unregisterBackCallback(location.pathname);
      };
    }
  }, [location.pathname, onBack, registerBackCallback, unregisterBackCallback]);

  return children;
};

export default RouteBackButton;
