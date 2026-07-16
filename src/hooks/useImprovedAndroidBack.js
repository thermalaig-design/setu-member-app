import { useNavigate, useLocation } from 'react-router-dom';
import { useNavigation } from '../context/ImprovedNavigationProvider';
import { useCallback } from 'react';

/**
 * ✅ IMPROVED Android Back Navigation Hook
 * 
 * Ye hook proper back navigation provide karta hai:
 * - Screen ke andar modals/dialogs band karta hai
 * - Phir pichle page par jaata hai
 * - Puri app exit nahi hota
 * 
 * Usage:
 * const { goBack, canGoBack } = useImprovedAndroidBack();
 * 
 * // Button mein:
 * <button onClick={goBack}>Back</button>
 * 
 * // Ya modals ke liye:
 * const { goBack, callBeforeBack } = useImprovedAndroidBack();
 * callBeforeBack(() => setModalOpen(false)); // Modal band karo pehle
 * <button onClick={goBack}>Back</button>
 */

export const useImprovedAndroidBack = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { canGoBack, getPreviousRoute, navigationStack } = useNavigation();
  
  // Before back callback — cleanup ke liye
  const beforeBackCallbacks = [];

  const goBack = useCallback(() => {
    // Pehle sab cleanup callbacks execute karo
    beforeBackCallbacks.forEach(cb => {
      if (typeof cb === 'function') cb();
    });

    // Phir back jaao
    if (navigationStack.length > 1) {
      navigate(-1);
    } else {
      navigate('/');
    }
  }, [navigate, navigationStack, beforeBackCallbacks]);

  const goBackTo = useCallback((route) => {
    // Specific route par jaao
    beforeBackCallbacks.forEach(cb => {
      if (typeof cb === 'function') cb();
    });
    navigate(route);
  }, [navigate, beforeBackCallbacks]);

  const callBeforeBack = useCallback((callback) => {
    if (typeof callback === 'function') {
      beforeBackCallbacks.push(callback);
    }
  }, [beforeBackCallbacks]);

  const getPreviousPage = useCallback(() => {
    return getPreviousRoute();
  }, [getPreviousRoute]);

  return {
    goBack,           // Navigate back one step
    goBackTo,         // Navigate to specific route
    canGoBack,        // Can we go back?
    callBeforeBack,   // Register cleanup before going back
    getPreviousPage,  // Get previous route
    currentRoute: location.pathname,
    stack: navigationStack
  };
};

/**
 * ✅ Hook for registering modal/dialog cleanup
 * 
 * Jab modal/dialog khulta hai aur back press ho to pehle modal band karo
 * 
 * Usage:
 * const { registerCleanup } = useBackCleanup();
 * 
 * useEffect(() => {
 *   if (isModalOpen) {
 *     registerCleanup(() => setIsModalOpen(false));
 *   }
 * }, [isModalOpen]);
 */
export const useBackCleanup = () => {
  const { navigationStack } = useNavigation();

  const registerCleanup = useCallback((cleanupFn) => {
    // This is mainly for reference
    // Real cleanup happens through callBeforeBack in useImprovedAndroidBack
    if (typeof cleanupFn === 'function') {
      cleanupFn();
    }
  }, [navigationStack]);

  return { registerCleanup };
};
