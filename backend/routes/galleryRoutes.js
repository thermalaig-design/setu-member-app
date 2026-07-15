import express from 'express';
import {
  getAllGalleryPhotos,
  getLatestGalleryPhotos,
  getGalleryPhotoById,
  deleteGalleryPhoto,
  getGalleryStats
} from '../controllers/galleryController.js';

const router = express.Router();

/**
 * GET /api/gallery
 * Get all gallery photos with pagination
 * Query params: limit, offset
 */
router.get('/', getAllGalleryPhotos);

/**
 * GET /api/gallery/latest
 * Get latest gallery photos
 * Query params: limit
 */
router.get('/latest', getLatestGalleryPhotos);

/**
 * GET /api/gallery/stats
 * Get gallery statistics
 */
router.get('/stats', getGalleryStats);

/**
 * GET /api/gallery/:id
 * Get single gallery photo by ID
 */
router.get('/:id', getGalleryPhotoById);

/**
 * DELETE /api/gallery/:id
 * Delete gallery photo by ID
 */
router.delete('/:id', deleteGalleryPhoto);

export default router;
