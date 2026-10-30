import { Capacitor } from '@capacitor/core';
import { FirebaseAnalytics } from '@capacitor-firebase/analytics';

// koi bhi event bhejne ke liye
export const track = async (name, params = {}) => {
  if (!Capacitor.isNativePlatform()) return; // sirf Android app mein
  try {
    await FirebaseAnalytics.logEvent({ name, params });
  } catch (e) {
    console.warn('analytics error', e);
  }
};

// Har successful login par 'login'. 'generate_lead' (signup) sirf is device par
// pehli baar, taaki purane members ke repeat login leads na ginein.
// TODO: backend verify-otp se new-user flag aaye to device flag ki jagah wo use karo.
const LEAD_SENT_KEY = 'analytics_signup_lead_sent';
export const trackLogin = () => {
  track('login');
  try {
    if (localStorage.getItem(LEAD_SENT_KEY)) return;
    localStorage.setItem(LEAD_SENT_KEY, '1');
  } catch {
    return; // storage na ho to lead mat bhejo, over-count se bachne ke liye
  }
  track('generate_lead', { lead_type: 'signup' });
};

// screen kholne par
export const trackScreen = (screenName) =>
  track('screen_view', { screen_name: screenName });