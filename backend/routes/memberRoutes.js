import express from 'express';
import * as memberController from '../controllers/memberController.js';

const router = express.Router();

// Get all members
router.get('/members', memberController.getAllMembers);
// Preview members (limited) for faster initial loads
router.get('/members/preview', memberController.getMembersPreview);

// Get member types
router.get('/members/types', memberController.getMemberTypes);

// Search members
router.get('/members/search', memberController.searchMembers);

// Get members by type
router.get('/members/type/:type', memberController.getMembersByType);

// Get all doctors from opd_schedule
router.get('/doctors', memberController.getAllDoctors);

// Get all committee members
router.get('/committee', memberController.getAllCommitteeMembers);

// Get all hospitals
router.get('/hospitals', memberController.getAllHospitals);

// Get all elected members
router.get('/elected-members', memberController.getAllElectedMembers);

// Debug endpoint for elected members (optional)
router.get('/elected-members-debug', memberController.getElectedMembersDebug);

// Get member trust links
router.get('/member/:member_id/trust-links', memberController.getMemberTrustLinks);

// Get member by ID (must be last to avoid conflicts)
router.get('/members/:id', memberController.getMemberById);

export default router;