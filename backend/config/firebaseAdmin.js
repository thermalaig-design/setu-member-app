import fs from 'fs';
import admin from 'firebase-admin';

let initialized = false;

const getServiceAccount = () => {
  const encoded = process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64;
  if (encoded) {
    const decoded = Buffer.from(encoded, 'base64').toString('utf8');
    return JSON.parse(decoded);
  }

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (raw) {
    return JSON.parse(raw);
  }

  const filePath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  if (filePath && fs.existsSync(filePath)) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  }

  return null;
};

export const initFirebaseAdmin = () => {
  if (initialized) return admin;

  const serviceAccount = getServiceAccount();
  if (!serviceAccount) {
    console.warn('Firebase Admin not initialized. Missing service account env.');
    return null;
  }

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });

  initialized = true;
  console.log('Firebase Admin initialized for FCM');
  return admin;
};

export const getFirebaseAdmin = () => (initialized ? admin : initFirebaseAdmin());

