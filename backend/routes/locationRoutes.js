import express from 'express';
import { getClientLocation } from '../controllers/locationController.js';

const router = express.Router();

// Approximate location of the requesting client (local GeoLite2 lookup)
router.get('/', getClientLocation);

export default router;
