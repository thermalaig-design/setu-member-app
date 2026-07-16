// ============================================================
// ImprovedNavigationProvider.jsx — FIXED BACK BUTTON LOGIC
// 
// समस्या: Back button पूरी app history से जा रहा था  
// समाधान: Parent-child route mapping के साथ proper back navigation
//
// Example:
//   Home (/) 
//     → Directory (/directory)
//         → Member Details (/member-details)
//
// Back press: Member Details → Directory → Home → Exit
// ============================================================

import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
} from 'react';
import { App } from '@capacitor/app';
import { useNavigate, useLocation } from 'react-router-dom';

// ─────────────────────────────────────────────────────────────
// Route Parent Mapping — Define parent routes
// ─────────────────────────────────────────────────────────────
const ROUTE_HIERARCHY = {
  '/': { parent: null, label: 'Home' },
  '/home': { parent: null, label: 'Home' },
  '/login': { parent: null, label: 'Login' },
  '/otp-verification': { parent: '/login', label: 'OTP Verification' },
  '/special-otp-verification': { parent: '/login', label: 'Special OTP' },
  '/profile': { parent: '/', label: 'Profile' },

  // Main Features - All go back to home
  '/directory': { parent: '/', label: 'Directory' },
  '/member-details': { parent: '/directory', label: 'Member Details' },
  '/healthcare-trustee-directory': { parent: '/', label: 'Healthcare Trustee' },
  '/committee-members': { parent: '/healthcare-trustee-directory', label: 'Committee Members' },
  '/appointment': { parent: '/', label: 'Appointments' },
  '/reports': { parent: '/', label: 'Reports' },
  '/reference': { parent: '/', label: 'Referrals' },
  '/notices': { parent: '/', label: 'Notices' },
  '/facilities': { parent: '/', label: 'Facilities' },
  '/events': { parent: '/', label: 'Events' },
  '/notifications': { parent: '/', label: 'Notifications' },
  '/sponsor-details': { parent: '/', label: 'Sponsor Details' },
  '/developers': { parent: '/', label: 'Developers' },
  '/gallery': { parent: '/', label: 'Gallery' },
  '/nomination-details': { parent: '/', label: 'Nomination Details' },
  '/add-community': { parent: '/', label: 'Add Community' },
  '/terms-and-conditions': { parent: '/', label: 'Terms & Conditions' },
  '/privacy-policy': { parent: '/', label: 'Privacy Policy' },
};

// Global sidebar state
let globalSidebarState = {
  isOpen: false,
  closeCallback: null,
};

export const registerSidebarState = (isOpen, closeCallback) => {
  globalSidebarState.isOpen = isOpen;
  globalSidebarState.closeCallback = closeCallback;
};

// ─────────────────────────────────────────────────────────────
// Context
// ─────────────────────────────────────────────────────────────
const NavigationContext = createContext();

// ─────────────────────────────────────────────────────────────
// ImprovedNavigationProvider
// ─────────────────────────────────────────────────────────────
export const NavigationProvider = ({ children }) => {
  const navigate = useNavigate();
  const location = useLocation();

  const [navigationStack, setNavigationStack] = useState(['/']);
  const [backCallbacks, setBackCallbacks] = useState({});

  const locationRef = useRef(location);
  const stackRef = useRef(navigationStack);
  const callbacksRef = useRef({});

  // Sync refs with state
  useEffect(() => {
    locationRef.current = location;
  }, [location]);

  useEffect(() => {
    stackRef.current = navigationStack;
  }, [navigationStack]);

  // ✅ IMPORTANT: Keep callbacksRef in sync with state
  useEffect(() => {
    callbacksRef.current = backCallbacks;
  }, [backCallbacks]);

  // ── Stack Management ──────────────────────────────────────

  // Track route changes - simpler approach
  useEffect(() => {
    setNavigationStack((prev) => {
      const currentPath = location.pathname;
      const lastRoute = prev[prev.length - 1];

      // If path changed and it's new, add to stack
      if (currentPath !== lastRoute) {
        const newStack = [...prev, currentPath];
        console.log('📍 Navigation stack updated:', newStack);
        return newStack;
      }

      return prev;
    });
  }, [location.pathname]);

  // ── Callback Management ───────────────────────────────────

  const registerBackCallback = useCallback((route, callback) => {
    setBackCallbacks((prev) => ({ ...prev, [route]: callback }));
  }, []);

  const unregisterBackCallback = useCallback((route) => {
    setBackCallbacks((prev) => {
      const updated = { ...prev };
      delete updated[route];
      return updated;
    });
  }, []);

  const executeBackButton = useCallback(
    (currentRoute) => {
      const callback = backCallbacks[currentRoute];
      if (callback && typeof callback === 'function') {
        callback();
        return true;
      }
      return false;
    },
    []
  );

  // ── Helpers ───────────────────────────────────────────────

  const getParentRoute = useCallback((currentRoute) => {
    const routeInfo = ROUTE_HIERARCHY[currentRoute];
    if (routeInfo && routeInfo.parent) {
      return routeInfo.parent;
    }
    return null;
  }, []);

  const getPreviousRoute = useCallback(() => {
    if (stackRef.current.length < 2) return null;
    return stackRef.current[stackRef.current.length - 2];
  }, []);

  const getCurrentRoute = useCallback(() => {
    return stackRef.current[stackRef.current.length - 1] || '/';
  }, []);

  const canGoBack = navigationStack.length > 1;

  // ── Android Back Button Listener ──────────────────────────
  useEffect(() => {
    // Store navigate in a ref to avoid dependency issues
    const navigateRef = { current: navigate };

    const subscriptionPromise = App.addListener('backButton', async () => {
      const currentPath = locationRef.current.pathname;
      const currentStack = stackRef.current;

      console.log('📱 Back button pressed!');
      console.log('   Current Path:', currentPath);
      console.log('   Stack:', currentStack);
      console.log('   Callbacks available:', Object.keys(callbacksRef.current));
      console.log('   Parent Route:', ROUTE_HIERARCHY[currentPath]?.parent);

      // 1. Sidebar open? Close it first
      if (globalSidebarState.isOpen && globalSidebarState.closeCallback) {
        console.log('📂 Closing sidebar...');
        globalSidebarState.closeCallback();
        return;
      }

      // 2. Custom callback for this route?
      const callback = callbacksRef.current[currentPath];
      if (callback && typeof callback === 'function') {
        console.log('✅ Executing custom callback for:', currentPath);
        callback();
        return;
      }

      // 3. ✅ IMPROVED: Go to parent route first
      const parentRoute = ROUTE_HIERARCHY[currentPath]?.parent;
      if (parentRoute) {
        console.log('⬅️ Going to parent route:', parentRoute);
        navigateRef.current(parentRoute);
        return;
      }

      // 4. At root level - exit app
      if (
        currentPath === '/' ||
        currentPath === '/login' ||
        currentPath === '/home'
      ) {
        console.log('🚪 At root screen, exiting app...');
        App.exitApp();
        return;
      }

      // 5. Fallback - use stack or exit
      if (currentStack.length > 1) {
        console.log('⬅️ Fallback: Using navigation stack...');
        navigateRef.current(-1);
      } else {
        console.log('🚪 Fallback: Exiting app...');
        App.exitApp();
      }
    });

    return () => {
      subscriptionPromise.then((sub) => {
        sub.remove();
        console.log('🧹 Back listener cleaned up');
      });
    };
  }, [navigate]);

  return (
    <NavigationContext.Provider
      value={{
        navigationStack,
        registerBackCallback,
        unregisterBackCallback,
        executeBackButton,
        getPreviousRoute,
        getCurrentRoute,
        getParentRoute,
        canGoBack,
        exitApp: () => App.exitApp(),
        routeHierarchy: ROUTE_HIERARCHY,
      }}
    >
      {children}
    </NavigationContext.Provider>
  );
};

// ─────────────────────────────────────────────────────────────
// Hooks
// ─────────────────────────────────────────────────────────────

export const useNavigation = () => {
  const context = useContext(NavigationContext);
  if (!context) {
    throw new Error('useNavigation must be used within NavigationProvider');
  }
  return context;
};

// For backward compatibility
export const useAndroidBackHandler = () => {
  const { exitApp } = useNavigation();
  return { exitApp };
};
