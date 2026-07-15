import express from 'express';
import {
  getMarqueeUpdates,
  addMarqueeUpdate,
  updateMarqueeUpdate,
  deleteMarqueeUpdate,
  getAllMarqueeUpdates
} from '../controllers/marqueeController.js';

const router = express.Router();

// Public route - Get active marquee updates
router.get('/', getMarqueeUpdates);

// Admin routes
router.get('/all', getAllMarqueeUpdates); // Get all (active + inactive)
router.post('/', addMarqueeUpdate);       // Add new update
router.put('/:id', updateMarqueeUpdate);  // Update existing update
router.delete('/:id', deleteMarqueeUpdate); // Delete update

export default router;