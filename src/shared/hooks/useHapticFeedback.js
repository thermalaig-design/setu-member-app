import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { Capacitor } from '@capacitor/core';

/**
 * Android Haptic Feedback Handler
 * Provides vibration feedback for user interactions
 * Works on Android and iOS
 */
export const useHapticFeedback = () => {
  const isNativeApp = Capacitor.isNativePlatform();

  // Light tap feedback (for button hovers)
  const lightTap = async () => {
    if (isNativeApp) {
      try {
        await Haptics.impact({ style: ImpactStyle.Light });
      } catch (error) {
        console.log('Haptic feedback not available');
      }
    }
  };

  // Medium tap feedback (for button clicks)
  const mediumTap = async () => {
    if (isNativeApp) {
      try {
        await Haptics.impact({ style: ImpactStyle.Medium });
      } catch (error) {
        console.log('Haptic feedback not available');
      }
    }
  };

  // Heavy tap feedback (for important actions/submissions)
  const heavyTap = async () => {
    if (isNativeApp) {
      try {
        await Haptics.impact({ style: ImpactStyle.Heavy });
      } catch (error) {
        console.log('Haptic feedback not available');
      }
    }
  };

  // Success feedback (for successful operations)
  const success = async () => {
    if (isNativeApp) {
      try {
        await Haptics.notification({ type: 'SUCCESS' });
      } catch (error) {
        console.log('Haptic feedback not available');
      }
    }
  };

  // Warning feedback (for warnings)
  const warning = async () => {
    if (isNativeApp) {
      try {
        await Haptics.notification({ type: 'WARNING' });
      } catch (error) {
        console.log('Haptic feedback not available');
      }
    }
  };

  // Error feedback (for errors)
  const error = async () => {
    if (isNativeApp) {
      try {
        await Haptics.notification({ type: 'ERROR' });
      } catch (error) {
        console.log('Haptic feedback not available');
      }
    }
  };

  // Selection feedback (for selections)
  const selection = async () => {
    if (isNativeApp) {
      try {
        await Haptics.selectionStart();
        setTimeout(() => Haptics.selectionEnd(), 100);
      } catch (error) {
        console.log('Haptic feedback not available');
      }
    }
  };

  return {
    lightTap,
    mediumTap,
    heavyTap,
    success,
    warning,
    error,
    selection
  };
};
