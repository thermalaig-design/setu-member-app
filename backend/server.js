import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import process from 'process';
import path from 'path';
import { fileURLToPath } from 'url';
import marqueeRoutes from './routes/marqueeRoutes.js';
import appointmentRoutes from './routes/appointmentRoutes.js';
import { errorHandler, notFound } from './middleware/errorHandler.js';
import memberRoutes from './routes/memberRoutes.js';
import authRoutes from './routes/authRoutes.js';
import reportRoutes from './routes/reportRoutes.js';
import referralRoutes from './routes/referralRoutes.js';
import profileRoutes from './routes/profileRoutes.js';
import adminRoutes from './routes/adminRoutes.js';
import sponsorRoutes from './routes/sponsorRoutes.js';
import notificationRoutes from './routes/notificationRoutes.js';
import galleryRoutes from './routes/galleryRoutes.js';
import familyRoutes from './routes/familyRoutes.js';
import { initFirebaseAdmin } from './config/firebaseAdmin.js';
import { startNotificationPushWorker } from './services/notificationPushWorker.js';

// ES module fix for __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config();

// Initialize express app
const app = express();
const PORT = process.env.PORT || 5005;
const TRUST_BRAND_NAME = process.env.VITE_DEFAULT_TRUST_NAME || process.env.DEFAULT_TRUST_NAME || 'Trust';

// --------------------
// MIDDLEWARE
// --------------------

// CORS configuration
const corsOptions = {
  origin: function(origin, callback) {
    const allowedOrigins = [
      'http://localhost:5173', // Vite default port
      'https://localhost', // Capacitor Android/iOS WebView origin
      'http://localhost:3000', // React default port
      'http://localhost:3001', // Alternative React port
      'http://localhost:5002', // Alternative port
      'https://localhost:5002', // Local HTTPS backend testing
      'capacitor://localhost', // Native Capacitor origin
      'ionic://localhost', // Legacy Ionic origin
    ];
    
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    const isLocalhostOrigin = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);

    // Check if origin is in allowed list
    if (allowedOrigins.indexOf(origin) !== -1 || isLocalhostOrigin || process.env.NODE_ENV === 'development') {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  optionsSuccessStatus: 200
};

app.use(cors(corsOptions));

  app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files from public directory
app.use(express.static(path.join(__dirname, '../public')));

// Handle favicon requests
app.get('/favicon.ico', (req, res) => res.status(204).end());

// --------------------
// HEALTH CHECK ROUTES
// --------------------
app.get('/', (req, res) => {
  res.json({
    success: true,
    message: `${TRUST_BRAND_NAME} Backend API running`,
    status: 'healthy',
    timestamp: new Date().toISOString(),
    endpoints: {
      auth: '/api/auth',
      members: '/api/members',
      appointments: '/api/appointments',
      reports: '/api/reports',
      referrals: '/api/referrals',
      profile: '/api/profile',
      familyMembers: '/api/family-members',
      sponsors: '/api/sponsors',
      admin: '/api/admin'
    }
  });
});

app.get('/api', (req, res) => {
  res.json({
    success: true,
    message: `${TRUST_BRAND_NAME} API`,
    version: '1.0.0',
    endpoints: {
      auth: '/api/auth',
      members: '/api/members',
      appointments: '/api/appointments',
      reports: '/api/reports',
      referrals: '/api/referrals',
      profile: '/api/profile',
      familyMembers: '/api/family-members',
      sponsors: '/api/sponsors',
      admin: '/api/admin'
    }
  });
});

// --------------------
// API ROUTES
// --------------------
app.use('/api/auth', authRoutes);
app.use('/api/marquee', marqueeRoutes); // Marquee routes BEFORE member routes
app.use('/api/appointments', appointmentRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/referrals', referralRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/family-members', familyRoutes);
app.use('/api/sponsors', sponsorRoutes); // Sponsor routes
app.use('/api/notifications', notificationRoutes);
app.use('/api/gallery', galleryRoutes); // Gallery routes
app.use('/api/admin', adminRoutes); // Admin routes
app.use('/api', memberRoutes); // Member routes last to avoid catching other routes
// --------------------
// ERROR HANDLING
// --------------------
app.use(notFound);
app.use(errorHandler);

// --------------------
// START SERVER
// --------------------
app.listen(PORT, () => {
  console.log('🚀 Server is running on port', PORT);
  console.log(`📍 API URL: https://hospital-trustee-fiwe.vercel.app/`);
  console.log(`📍 API URL: https://hospital-trustee-fiwe.vercel.app/api/auth`);
  console.log('🌐 Production URL:', `https://hospital-trustee-fiwe.vercel.app/`);
});
  

initFirebaseAdmin();
startNotificationPushWorker();
