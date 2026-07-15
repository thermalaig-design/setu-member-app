import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';

// Global navigation stack to track history
let navigationStack = ['/'];

/**
 * Hook to track navigation history
 * Maintains a stack of visited routes
 */
export const useHistoryTracker = () => {
  const location = useLocation();
  const previousPathRef = useRef('/');

  useEffect(() => {
    const currentPath = location.pathname;
    const previousPath = previousPathRef.current;

    // Only add to stack if path changed
    if (currentPath !== previousPath) {
      // Check if we're going back (path already in stack) or going forward
      const pathIndex = navigationStack.indexOf(currentPath);
      
      if (pathIndex !== -1) {
        // Going back - remove everything after this path
        navigationStack = navigationStack.slice(0, pathIndex + 1);
        console.log('Going back - Updated stack:', navigationStack);
      } else {
        // Going forward - add new path
        navigationStack.push(currentPath);
        console.log('Going forward - Updated stack:', navigationStack);
      }

      previousPathRef.current = currentPath;
    }
  }, [location.pathname]);

  return {
    canGoBack: navigationStack.length > 1,
    navigationStack: [...navigationStack],
    currentIndex: navigationStack.indexOf(location.pathname)
  };
};

/**
 * Get the current navigation stack (for debugging)
 */
export const getNavigationStack = () => {
  return [...navigationStack];
};

/**
 * Reset navigation stack (useful for login/logout)
 */
export const resetNavigationStack = () => {
  navigationStack = ['/'];
};
