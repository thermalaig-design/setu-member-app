import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useNavigation } from '../context/ImprovedNavigationProvider';

/**
 * ✅ IMPROVED Android Back Handler Hook
 * 
 * यह hook Android के back button को properly handle करता है
 * 
 * Features:
 * - Modal/Dialog को पहले close करता है, फिर पिछले page पर जाता है
 * - Parent route को automatically get करता है
 * - Route-specific cleanup handlers को support करता है
 * 
 * Usage Examples:
 * 
 * 1. Simple back handling:
 *    const { goBack } = useAndroidBack();
 *    <button onClick={goBack}>Back</button>
 *
 * 2. Modal के साथ:
 *    const { registerModalCleanup } = useAndroidBack();
 *    
 *    useEffect(() => {
 *      if (isModalOpen) {
 *        registerModalCleanup(() => setIsModalOpen(false));
 *      }
 *    }, [isModalOpen]);
 *
 * 3. Custom back handler:
 *    const { registerBackHandler } = useAndroidBack();
 *    
 *    useEffect(() => {
 *      registerBackHandler(() => {
 *        console.log('Do something before navigating back');
 *      });
 *    }, []);
 */

export const useAndroidBack = () => {
  const { registerBackCallback, unregisterBackCallback, getParentRoute } = useNavigation();
  const location = useLocation();

  // Register back callback for this route
  const registerBackHandler = (callback) => {
    registerBackCallback(location.pathname, callback);
    
    // Cleanup on unmount
    return () => {
      unregisterBackCallback(location.pathname);
    };
  };

  // Register modal cleanup - closes modal, then allows back navigation
  const registerModalCleanup = (closeModalFn) => {
    registerBackCallback(location.pathname, closeModalFn);
  };

  // Unregister handler (cleanup)
  const unregisterHandler = () => {
    unregisterBackCallback(location.pathname);
  };

  // Get parent route for this page
  const parentRoute = getParentRoute(location.pathname);

  return {
    registerBackHandler,
    registerModalCleanup,
    unregisterHandler,
    parentRoute,
    currentRoute: location.pathname,
  };
};

/**
 * ✅ Simple hook for modal/dialog cleanup on back
 * 
 * जब भी modal खुला हो और back press हो तो modal close हो जाए
 * 
 * Usage:
 * const { cleanupOnBack } = useModalBackHandler();
 * 
 * useEffect(() => {
 *   if (isModalOpen) {
 *     cleanupOnBack(() => setIsModalOpen(false));
 *   }
 * }, [isModalOpen]);
 */
export const useModalBackHandler = () => {
  const { registerModalCleanup } = useAndroidBack();

  const cleanupOnBack = (closeFunction) => {
    registerModalCleanup(closeFunction);
  };

  return { cleanupOnBack };
};

/**
 * ✅ Hook to prevent app exit and instead go to parent
 * 
 * यह सुनिश्चित करता है कि back button हमेशा parent page को जाए
 * अगर कोई parent नहीं है तो app exit करता है
 */
export const useProperBackNavigation = () => {
  const { registerBackCallback } = useNavigation();
  const location = useLocation();

  // Already handled by ImprovedNavigationProvider
  // यह hook backward compatibility के लिए है

  return {
    route: location.pathname,
  };
};
