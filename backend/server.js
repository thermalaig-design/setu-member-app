import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import process from 'process';
import path from 'path';
import { fileURLToPath } from 'url';
import marqueeRoutes from './features/home-navigation/marqueeRoutes.js';
import appointmentRoutes from './features/appointments-reports-referral/appointmentRoutes.js';
import { errorHandler, notFound } from './shared/middleware/errorHandler.js';
import memberRoutes from './shared/member-api/memberRoutes.js';
import authRoutes from './features/auth/authRoutes.js';
import reportRoutes from './features/appointments-reports-referral/reportRoutes.js';
import referralRoutes from './features/appointments-reports-referral/referralRoutes.js';
import profileRoutes from './features/member/profileRoutes.js';
import adminRoutes from './features/admin/adminRoutes.js';
import adminPaymentRoutes from './features/admin/adminPaymentRoutes.js';
import sponsorRoutes from './features/gallery-sponsors/sponsorRoutes.js';
import notificationRoutes from './features/notifications/notificationRoutes.js';
import galleryRoutes from './features/gallery-sponsors/galleryRoutes.js';
import familyRoutes from './features/member/familyRoutes.js';
import orderHistoryRoutes from './features/products/orderHistoryRoutes.js';
import paymentRoutes, { razorpayWebhookHandler } from './features/products/paymentRoutes.js';
import locationRoutes from './shared/location/locationRoutes.js';
import { initGeoIp } from './shared/location/geoIpService.js';

// ES module fix for __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config();

// Initialize express app
const app = express();
app.set('trust proxy', 1); // Nginx in front: req.ip = real client IP
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

// Razorpay webhook needs the raw body for signature verification, so it is
// mounted before express.json().
app.post('/api/payments/webhook', express.raw({ type: '*/*', limit: '1mb' }), razorpayWebhookHandler);

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
      orderHistory: '/api/order-history',
      payments: '/api/payments',
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
      orderHistory: '/api/order-history',
      payments: '/api/payments',
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
app.use('/api/order-history', orderHistoryRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/admin/payments', adminPaymentRoutes); // Admin-only, before the generic admin router
app.use('/api/admin', adminRoutes); // Admin routes
app.use('/api/client-location', locationRoutes); // Local GeoIP lookup
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
  

initGeoIp();
