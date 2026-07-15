// ============================================================
// NavigationProvider.jsx — COMPLETE INTEGRATED SOLUTION
// 
// Pehle 2 alag files thi jo ek doosre se connect nahi thi:
//   ❌ useAndroidBackHandler.js — back button sunta tha
//   ❌ NavigationProvider.jsx   — stack track karta tha
//   ❌ Dono alag = app exit hota tha
//
// Ab ek hi file mein sab kuch:
//   ✅ NavigationProvider — stack track karta hai
//   ✅ useAndroidBackHandler — Provider ka canGoBack use karta hai
//   ✅ Dono connected = back sahi kaam karta hai
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
// Global sidebar state (same as before)
// ─────────────────────────────────────────────────────────────
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
// NavigationProvider
// App.jsx mein Router ke andar wrap karo — bas ek baar
// ─────────────────────────────────────────────────────────────
export const NavigationProvider = ({ children }) => {
  const navigate = useNavigate();
  const location = useLocation();

  const [navigationStack, setNavigationStack] = useState(['/']);
  const [backCallbacks, setBackCallbacks] = useState({});

  // ✅ locationRef — listener ke andar hamesha latest path milega
  const locationRef = useRef(location);
  const stackRef = useRef(navigationStack);

  // Refs ko sync rakho
  useEffect(() => {
    locationRef.current = location;
  }, [location]);

  useEffect(() => {
    stackRef.current = navigationStack;
  }, [navigationStack]);

  // ── Stack management ──────────────────────────────────────

  const pushRoute = useCallback((route) => {
    setNavigationStack((prev) => {
      const newStack = [...prev];
      const index = newStack.indexOf(route);
      if (index !== -1) newStack.splice(index, 1);
      newStack.push(route);
      console.log('📍 Navigation stack:', newStack);
      return newStack;
    });
  }, []);

  // ✅ Route change pe automatically stack update karo
  // Pehle yeh nahi tha — pushRoute manually call karna padta tha
  // ✅ IMPROVED: Better stack management for MemoryRouter
  // Yeh detect karta hai ki forward navigate ho raha hai ya back
  const prevPathRef = useRef(location.pathname);
  const isBackNavigationRef = useRef(false);

  useEffect(() => {
    const currentPath = location.pathname;
    const prevPath = prevPathRef.current;

    setNavigationStack((prev) => {
      const newStack = [...prev];
      const stackIndex = newStack.indexOf(currentPath);

      // Agar current page already stack mein hai to back navigation hua
      if (stackIndex !== -1 && stackIndex < newStack.length - 1) {
        // Back navigation — stack ko trim karo
        console.log(`⬅️ Back detected: ${prevPath} → ${currentPath}`);
        isBackNavigationRef.current = true;
        return newStack.slice(0, stackIndex + 1);
      }

      // New page — add karo
      if (currentPath !== prev[prev.length - 1]) {
        console.log(`➡️ Forward navigation: ${prevPath} → ${currentPath}`);
        newStack.push(currentPath);
        isBackNavigationRef.current = false;
      }

      console.log('📍 Updated stack:', newStack);
      return newStack;
    });

    prevPathRef.current = currentPath;
  }, [location.pathname]);

  // ── Callback management ───────────────────────────────────

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
    [backCallbacks]
  );

  // ── Helpers ───────────────────────────────────────────────

  const getPreviousRoute = useCallback(() => {
    if (navigationStack.length < 2) return null;
    return navigationStack[navigationStack.length - 2];
  }, [navigationStack]);

  const getCurrentRoute = useCallback(() => {
    return navigationStack[navigationStack.length - 1] || '/';
  }, [navigationStack]);

  // ✅ canGoBack — stack se check hoga, window.history se nahi
  const canGoBack = navigationStack.length > 1;

  // ── Android Back Button Listener ──────────────────────────
  // ✅ IMPROVED: Better navigation and app exit prevention
  useEffect(() => {
    const rootScreens = ['/', '/login'];

    const subscriptionPromise = App.addListener('backButton', async () => {
      const currentPath = locationRef.current.pathname;
      const currentStack = stackRef.current;

      console.log('📱 Back button pressed!');
      console.log('   Current Path:', currentPath);
      console.log('   Stack:', currentStack);
      console.log('   Stack Length:', currentStack.length);

      // 1. Sidebar khula hai? Pehle band karo
      if (globalSidebarState.isOpen && globalSidebarState.closeCallback) {
        console.log('📂 Closing sidebar...');
        globalSidebarState.closeCallback();
        return;
      }

      // 2. Is route ke liye custom callback registered hai?
      const callback = backCallbacks[currentPath];
      if (callback && typeof callback === 'function') {
        console.log('✅ Executing custom callback for:', currentPath);
        callback();
        return;
      }

      // 3. ✅ IMPROVED: Stack mein pichhe ja sakte hain?
      if (currentStack.length > 1) {
        console.log('⬅️ Navigating back in stack...');
        console.log('   From:', currentPath);
        console.log('   To:', currentStack[currentStack.length - 2]);
        navigate(-1);
        return;
      }

      // 4. ✅ IMPROVED: Root screen par hain — confirm + exit
      if (rootScreens.includes(currentPath)) {
        console.log('🚪 At root screen, exiting app...');
        App.exitApp();
        return;
      }

      // 5. Safety fallback — unexpected case
      console.log('⚠️  Fallback: Going back or exiting...');
      if (currentStack.length > 1) {
        navigate(-1);
      } else {
        App.exitApp();
      }
    });

    return () => {
      subscriptionPromise.then((sub) => {
        sub.remove();
        console.log('🧹 Back listener cleaned up');
      });
    };
  }, [navigate, backCallbacks]);

  return (
    <NavigationContext.Provider
      value={{
        navigationStack,
        pushRoute,
        registerBackCallback,
        unregisterBackCallback,
        executeBackButton,
        getPreviousRoute,
        getCurrentRoute,
        canGoBack,
        exitApp: () => App.exitApp(),
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

// useAndroidBackHandler — purana naam same rakha taaki
// baaki files mein kuch change na karna pade
export const useAndroidBackHandler = () => {
  const { exitApp } = useNavigation();
  // Ab kuch alag karne ki zaroorat nahi — Provider sab handle karta hai
  return { exitApp };
};
