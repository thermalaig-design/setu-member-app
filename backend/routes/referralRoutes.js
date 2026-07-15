import express from 'express';
import {
  createReferral,
  getUserReferrals,
  getReferralCounts,
  getAllReferrals,
  updateReferralStatus,
  updateReferral,
  deleteReferral
} from '../controllers/referralController.js';

const router = express.Router();

// Create a new referral
router.post('/', createReferral);

// Get user's referrals
router.get('/my-referrals', getUserReferrals);

// Get user's referral counts (for limit checking)
router.get('/counts', getReferralCounts);

// Get all referrals (admin only)
router.get('/all', getAllReferrals);

// Update referral status (admin)
router.patch('/:id/status', updateReferralStatus);

// Update referral (user can update their own)
router.patch('/:id', updateReferral);

// Delete referral (user can delete their own)
router.delete('/:id', deleteReferral);

export default router;

