/**
 * Android Keyboard Behavior Handler
 * Manages soft keyboard appearance and behavior without native plugin
 * Uses standard HTML5 APIs for keyboard management
 */
export const useAndroidKeyboard = () => {
  // Function to manually hide keyboard
  const hideKeyboard = async () => {
    // Blur active input element to hide keyboard
    const activeElement = document.activeElement;
    if (activeElement) {
      activeElement.blur();
    }
  };

  // Function to manually show keyboard
  const showKeyboard = async () => {
    // Focus on an input element to show keyboard
    const input = document.querySelector('input, textarea');
    if (input) {
      input.focus();
    }
  };

  // Set body padding when keyboard appears (for scroll adjustment)
  const setKeyboardPadding = (height = 0) => {
    document.body.style.paddingBottom = height + 'px';
  };

  return {
    hideKeyboard,
    showKeyboard,
    setKeyboardPadding
  };
};
