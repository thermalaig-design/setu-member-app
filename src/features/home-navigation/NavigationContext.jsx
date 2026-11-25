import React, { createContext, useContext, useState, useCallback } from 'react';

const NavigationContext = createContext();

export const NavigationProvider = ({ children }) => {
  const [navigationStack, setNavigationStack] = useState(['/']);
  const [backCallbacks, setBackCallbacks] = useState({});

  // Register a back button callback for a specific route
  const registerBackCallback = useCallback((route, callback) => {
    setBackCallbacks(prev => ({
      ...prev,
      [route]: callback
    }));
  }, []);

  // Unregister a back button callback
  const unregisterBackCallback = useCallback((route) => {
    setBackCallbacks(prev => {
      const newCallbacks = { ...prev };
      delete newCallbacks[route];
      return newCallbacks;
    });
  }, []);

  // Push a route to the stack
  const pushRoute = useCallback((route) => {
    setNavigationStack(prev => {
      const newStack = [...prev];
      // If route already exists, remove it and add at end (prevents duplicates)
      const index = newStack.indexOf(route);
      if (index !== -1) {
        newStack.splice(index, 1);
      }
      newStack.push(route);
      console.log('📍 Navigation stack updated:', newStack);
      return newStack;
    });
  }, []);

  // Execute back button callback for current route
  const executeBackButton = useCallback((currentRoute) => {
    console.log('🔙 Executing back button for route:', currentRoute);
    console.log('📊 Available callbacks:', Object.keys(backCallbacks));
    
    // Find the callback for current route
    const callback = backCallbacks[currentRoute];
    
    if (callback && typeof callback === 'function') {
      console.log('✅ Found callback, executing...');
      callback();
      return true;
    } else {
      console.log('⚠️ No callback found for route:', currentRoute);
      return false;
    }
  }, [backCallbacks]);

  // Get current and previous routes
  const getPreviousRoute = useCallback(() => {
    if (navigationStack.length < 2) return null;
    return navigationStack[navigationStack.length - 2];
  }, [navigationStack]);

  const getCurrentRoute = useCallback(() => {
    if (navigationStack.length === 0) return '/';
    return navigationStack[navigationStack.length - 1];
  }, [navigationStack]);

  const canGoBack = navigationStack.length > 1;

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
        canGoBack
      }}
    >
      {children}
    </NavigationContext.Provider>
  );
};

export const useNavigation = () => {
  const context = useContext(NavigationContext);
  if (!context) {
    throw new Error('useNavigation must be used within NavigationProvider');
  }
  return context;
};
