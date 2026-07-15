import express from 'express';
import { 
  getSponsors, 
  getAllSponsors, 
  getSponsorById, 
  addSponsor, 
  updateSponsor, 
  deleteSponsor 
} from '../controllers/sponsorController.js';
import { authenticateAdminByKey } from '../middleware/adminAuth.js'; // Using admin key authentication

const router = express.Router();
const publicRateBucket = new Map();

const publicSponsorRateLimit = (req, res, next) => {
  const now = Date.now();
  const ip = req.ip || req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';
  const key = `${ip}:${req.path}`;
  const entry = publicRateBucket.get(key) || { count: 0, startAt: now };

  if (now - entry.startAt > 60 * 1000) {
    entry.count = 0;
    entry.startAt = now;
  }

  entry.count += 1;
  publicRateBucket.set(key, entry);

  if (entry.count > 90) {
    return res.status(429).json({
      success: false,
      message: 'Too many sponsor requests. Please retry shortly.'
    });
  }

  next();
};

// Public routes - anyone can access active sponsors
router.get('/', publicSponsorRateLimit, getSponsors);             // Get sponsor feed
router.get('/active', publicSponsorRateLimit, getSponsors);       // Explicit active feed
router.get('/all', authenticateAdminByKey, getAllSponsors);       // Get all sponsors (active + inactive)
router.get('/:id', getSponsorById);     // Get specific sponsor by ID

// Admin routes - only authenticated admins can access
router.use(authenticateAdminByKey);         // Apply admin authentication to all routes below

router.post('/', addSponsor);          // Add new sponsor
router.put('/:id', updateSponsor);     // Update sponsor
router.delete('/:id', deleteSponsor);  // Delete sponsor

export default router;
