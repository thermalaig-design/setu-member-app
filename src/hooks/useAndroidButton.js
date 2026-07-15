import { useHapticFeedback } from './useHapticFeedback';
import { Capacitor } from '@capacitor/core';

/**
 * Android Seamless Button Handler
 * Provides automatic haptic feedback and visual feedback for buttons
 * Wraps buttons with enhanced Android experience
 */
export const useAndroidButton = () => {
  const haptic = useHapticFeedback();

  // Primary button click (main actions)
  const handlePrimaryClick = async (callback) => {
    haptic.mediumTap();
    callback?.();
  };

  // Secondary button click (less important actions)
  const handleSecondaryClick = async (callback) => {
    haptic.lightTap();
    callback?.();
  };

  // Destructive button click (delete, logout, etc)
  const handleDestructiveClick = async (callback) => {
    haptic.warning();
    callback?.();
  };

  // Success action (form submit, save, etc)
  const handleSuccessClick = async (callback) => {
    await callback?.();
    haptic.success();
  };

  // Quick action (rapid interactions)
  const handleQuickClick = async (callback) => {
    haptic.lightTap();
    callback?.();
  };

  return {
    handlePrimaryClick,
    handleSecondaryClick,
    handleDestructiveClick,
    handleSuccessClick,
    handleQuickClick,
    // Also expose raw haptic functions
    haptic
  };
};

/**
 * Get button class based on type
 * Provides consistent styling across Android
 */
export const getAndroidButtonClass = (variant = 'primary') => {
  const baseClass = 'active:scale-95 transition-transform';
  
  const variants = {
    primary: `${baseClass} bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg px-4 py-3 font-semibold shadow-md hover:shadow-lg`,
    secondary: `${baseClass} bg-gray-200 hover:bg-gray-300 text-gray-800 rounded-lg px-4 py-3 font-semibold`,
    destructive: `${baseClass} bg-red-500 hover:bg-red-600 text-white rounded-lg px-4 py-3 font-semibold shadow-md hover:shadow-lg`,
    ghost: `${baseClass} text-gray-700 hover:bg-gray-100 rounded-lg px-4 py-3 font-semibold`,
    card: `${baseClass} bg-white rounded-2xl p-4 shadow-sm border border-gray-200 hover:shadow-md hover:border-indigo-200 hover:-translate-y-1`
  };

  return variants[variant] || variants.primary;
};

/**
 * Android-optimized press feedback wrapper
 * Combines haptics with visual feedback
 */
export const createAndroidButton = ({
  onClick,
  variant = 'primary',
  hapticType = 'medium',
  disabled = false
}) => {
  const haptic = useHapticFeedback();

  const handleClick = async (e) => {
    if (disabled) return;

    // Trigger haptic
    switch (hapticType) {
      case 'light':
        haptic.lightTap();
        break;
      case 'heavy':
        haptic.heavyTap();
        break;
      case 'success':
        haptic.success();
        break;
      case 'warning':
        haptic.warning();
        break;
      case 'error':
        haptic.error();
        break;
      case 'medium':
      default:
        haptic.mediumTap();
    }

    // Call the onClick handler
    onClick?.(e);
  };

  return {
    onClick: handleClick,
    className: getAndroidButtonClass(variant),
    disabled
  };
};
