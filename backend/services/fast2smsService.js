import axios from 'axios';
import process from 'process';

// Fast2SMS Configuration
const FAST2SMS_API_KEY = process.env.FAST2SMS_API_KEY;
const FAST2SMS_SENDER_ID = process.env.FAST2SMS_SENDER_ID || 'FSTSMS';
// DLT configuration (India). These MUST match what is approved on your DLT portal + Fast2SMS DLT setup.
// FAST2SMS_ENTITY_ID: DLT Entity ID (19 digits, usually starts with 17...)
// FAST2SMS_MESSAGE_ID: DLT Template/Message ID (e.g. 208140)
const FAST2SMS_ENTITY_ID = process.env.FAST2SMS_ENTITY_ID;
const FAST2SMS_MESSAGE_ID = process.env.FAST2SMS_MESSAGE_ID;
const OTP_EXPIRY_MINUTES = parseInt(process.env.OTP_EXPIRY_MINUTES) || 5;
const NODE_ENV = process.env.NODE_ENV || 'production';

// In-memory OTP storage for Fast2SMS (backup method)
const fast2smsOtpStore = new Map();

/**
 * Generate 6-digit OTP
 */
const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

/**
 * Send OTP via Fast2SMS
 */
export const sendOTP = async (phoneNumber, otp) => {
  try {
    if (!FAST2SMS_API_KEY) {
      throw new Error('Fast2SMS API key not configured');
    }
    if (!FAST2SMS_ENTITY_ID || !FAST2SMS_MESSAGE_ID) {
      throw new Error('Fast2SMS DLT not configured. Please set FAST2SMS_ENTITY_ID and FAST2SMS_MESSAGE_ID');
    }

    // Clean phone number
    const cleanPhone = phoneNumber.replace(/\D/g, '');
    
    // Format for Fast2SMS (should be in 10-digit format for Indian numbers)
    let formattedPhone;
    if (cleanPhone.length === 10) {
      // 10-digit Indian number
      formattedPhone = cleanPhone;
    } else if (cleanPhone.length === 12 && cleanPhone.startsWith('91')) {
      // Remove country code for Fast2SMS
      formattedPhone = cleanPhone.substring(2);
    } else if (cleanPhone.startsWith('+91') && cleanPhone.length === 13) {
      // Remove +91 prefix
      formattedPhone = cleanPhone.substring(3);
    } else {
      throw new Error('Invalid phone number format for Fast2SMS');
    }
    
    console.log(`📱 Sending OTP ${otp} to ${formattedPhone} via Fast2SMS`);
    
    // Fast2SMS API endpoint with DLT route using registered template
    const url = 'https://www.fast2sms.com/dev/bulkV2';
    
    const payload = {
      authorization: FAST2SMS_API_KEY,
      route: 'dlt',
      sender_id: FAST2SMS_SENDER_ID || 'TEIPVT',
      entity_id: FAST2SMS_ENTITY_ID,
      message: FAST2SMS_MESSAGE_ID,
      variables_values: `${otp}|${OTP_EXPIRY_MINUTES}|`, // OTP without underscores
      flash: 0,
      numbers: formattedPhone
    };
    
    const response = await axios.get(url, {
      params: payload,
      headers: {
        'cache-control': 'no-cache'
      }
    });
    
    console.log('✅ Fast2SMS Response:', response.data);
    
    if (response.data.return === true) {
      return {
        success: true,
        message: 'OTP sent successfully via Fast2SMS',
        requestId: response.data.request_id || 'fast2sms_' + Date.now()
      };
    } else {
      throw new Error(response.data.message || 'Failed to send OTP via Fast2SMS');
    }
    
  } catch (error) {
    console.error('❌ Error sending OTP via Fast2SMS:', error.response?.data || error.message);
    throw new Error('Failed to send OTP via Fast2SMS. Please try again.');
  }
};

/**
 * Verify OTP via Fast2SMS (local verification since Fast2SMS doesn't have verify endpoint)
 */
export const verifyOTP = (phoneNumber, otp) => {
  try {
    // Clean phone number
    const cleanPhone = phoneNumber.replace(/\D/g, '');
    
    // Format for storage lookup
    let formattedPhoneForRetrieval;
    if (cleanPhone.length === 10) {
      formattedPhoneForRetrieval = cleanPhone;
    } else if (cleanPhone.length === 12 && cleanPhone.startsWith('91')) {
      formattedPhoneForRetrieval = cleanPhone.substring(2);
    } else if (cleanPhone.startsWith('+91') && cleanPhone.length === 13) {
      formattedPhoneForRetrieval = cleanPhone.substring(3);
    } else {
      formattedPhoneForRetrieval = cleanPhone;
    }
    
    console.log(`🔍 Verifying OTP ${otp} for ${formattedPhoneForRetrieval} via Fast2SMS local verification`);
    
    const stored = fast2smsOtpStore.get(formattedPhoneForRetrieval);
    
    if (!stored) {
      return { success: false, message: 'OTP expired or not found' };
    }
    
    if (Date.now() > stored.expiryTime) {
      fast2smsOtpStore.delete(formattedPhoneForRetrieval);
      return { success: false, message: 'OTP expired' };
    }
    
    if (stored.attempts >= 3) {
      fast2smsOtpStore.delete(formattedPhoneForRetrieval);
      return { success: false, message: 'Too many failed attempts' };
    }
    
    if (stored.otp === otp) {
      fast2smsOtpStore.delete(formattedPhoneForRetrieval);
      return { success: true, message: 'OTP verified successfully via Fast2SMS' };
    }
    
    stored.attempts += 1;
    return { success: false, message: 'Invalid OTP' };
    
  } catch (error) {
    console.error('❌ Error verifying OTP via Fast2SMS:', error);
    return {
      success: false,
      message: 'Failed to verify OTP'
    };
  }
};

/**
 * Store OTP locally for Fast2SMS verification
 */
export const storeOTP = (phoneNumber, otp) => {
  // Clean phone number
  const cleanPhone = phoneNumber.replace(/\D/g, '');
  
  // Format for storage
  let formattedPhoneForStorage;
  if (cleanPhone.length === 10) {
    formattedPhoneForStorage = cleanPhone;
  } else if (cleanPhone.length === 12 && cleanPhone.startsWith('91')) {
    formattedPhoneForStorage = cleanPhone.substring(2);
  } else if (cleanPhone.startsWith('+91') && cleanPhone.length === 13) {
    formattedPhoneForStorage = cleanPhone.substring(3);
  } else {
    formattedPhoneForStorage = cleanPhone;
  }
  
  const expiryTime = Date.now() + (OTP_EXPIRY_MINUTES * 60 * 1000);
  
  fast2smsOtpStore.set(formattedPhoneForStorage, {
    otp: otp,
    expiryTime: expiryTime,
    attempts: 0
  });
  
  // Auto-delete after expiry
  setTimeout(() => {
    fast2smsOtpStore.delete(formattedPhoneForStorage);
  }, OTP_EXPIRY_MINUTES * 60 * 1000);
  
  console.log(`🔒 OTP stored for ${formattedPhoneForStorage} (expires in ${OTP_EXPIRY_MINUTES} minutes)`);
};

/**
 * Initialize Fast2SMS OTP service
 */
export const initializeFast2SMSService = async (phoneNumber) => {
  try {
    if (!FAST2SMS_API_KEY) {
      throw new Error('Fast2SMS API key not configured');
    }
    
    // Generate OTP
    const otp = generateOTP();
    
    // Store OTP locally for verification
    storeOTP(phoneNumber, otp);
    
    // Send OTP via Fast2SMS
    const sendResult = await sendOTP(phoneNumber, otp);
    
    if (!sendResult.success) {
      throw new Error('Failed to send OTP via Fast2SMS');
    }
    
    console.log(`✅ Fast2SMS OTP sent successfully to ${phoneNumber}`);
    
    return {
      success: true,
      message: 'OTP sent successfully via Fast2SMS',
      data: {
        phoneNumber: phoneNumber,
        requestId: sendResult.requestId
      }
    };
    
  } catch (error) {
    console.error('❌ Error in Fast2SMS initialization:', error);
    throw error;
  }
};

// Export the OTP generation function for testing
export { generateOTP };