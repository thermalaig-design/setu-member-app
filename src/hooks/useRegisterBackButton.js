import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useNavigation } from '../context/NavigationContext';

/**
 * Hook to register a back button callback for the current route
 * 
 * Usage in any page component:
 * useRegisterBackButton(() => {
 *   navigate('/previous-page');
 * });
 */
export const useRegisterBackButton = (backButtonCallback) => {
  const location = useLocation();
  const { registerBackCallback, unregisterBackCallback } = useNavigation();

  useEffect(() => {
    if (backButtonCallback && typeof backButtonCallback === 'function') {
      console.log(`✅ Registering back callback for route: ${location.pathname}`);
      registerBackCallback(location.pathname, backButtonCallback);
    }

    // Cleanup on unmount
    return () => {
      console.log(`❌ Unregistering back callback for route: ${location.pathname}`);
      unregisterBackCallback(location.pathname);
    };
  }, [location.pathname, backButtonCallback, registerBackCallback, unregisterBackCallback]);
};

export default useRegisterBackButton;
