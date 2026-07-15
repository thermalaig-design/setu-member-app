import { useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useNavigation } from '../context/ImprovedNavigationProvider';

/**
 * useBackNavigation Hook
 * 
 * ✅ UPDATED: Now uses NavigationProvider's stack tracking
 * No more conflicting listeners or window.history.back()
 * 
 * Usage:
 * useBackNavigation();  // Will go back one step
 * 
 * Or with custom callback:
 * useBackNavigation(() => navigate('/home'));
 * 
 * @param {Function} onBackPress - Optional callback when back is pressed
 */
export const useBackNavigation = (onBackPress) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { registerBackCallback, unregisterBackCallback, getPreviousRoute } = useNavigation();
  const handlerRef = useRef(onBackPress);
  
  useEffect(() => {
    const handleBackPress = () => {
      if (handlerRef.current && typeof handlerRef.current === 'function') {
        handlerRef.current();
      } else {
        // Default: go back one step using navigation stack
        const previousRoute = getPreviousRoute();
        if (previousRoute) {
          navigate(-1);
        }
      }
    };

    const currentPath = location.pathname;
    registerBackCallback(currentPath, handleBackPress);
    
    return () => {
      unregisterBackCallback(currentPath);
    };
  }, [location.pathname, navigate, registerBackCallback, unregisterBackCallback, getPreviousRoute]);

  useEffect(() => {
    handlerRef.current = onBackPress;
  }, [onBackPress]);
};

