import express from 'express';
import * as adminController from '../controllers/adminController.js';

const router = express.Router();

// Members Table routes
router.get('/members', adminController.getAllMembers);
router.get('/members/:id', adminController.getMemberById);
router.post('/members', adminController.createMember);
router.put('/members/:id', adminController.updateMember);
router.delete('/members/:id', adminController.deleteMember);

// Hospitals routes
router.get('/hospitals', adminController.getAllHospitals);
router.get('/hospitals/:id', adminController.getHospitalById);
router.post('/hospitals', adminController.createHospital);
router.put('/hospitals/:id', adminController.updateHospital);
router.delete('/hospitals/:id', adminController.deleteHospital);

// Elected Members routes
router.get('/elected-members', adminController.getAllElectedMembers);
router.get('/elected-members/:id', adminController.getElectedMemberById);
router.post('/elected-members', adminController.createElectedMember);
router.put('/elected-members/:id', adminController.updateElectedMember);
router.delete('/elected-members/:id', adminController.deleteElectedMember);

// Committee Members routes
router.get('/committee-members', adminController.getAllCommitteeMembers);
router.get('/committee-members/:id', adminController.getCommitteeMemberById);
router.post('/committee-members', adminController.createCommitteeMember);
router.put('/committee-members/:id', adminController.updateCommitteeMember);
router.delete('/committee-members/:id', adminController.deleteCommitteeMember);

// Doctors (OPD Schedule) routes
router.get('/doctors', adminController.getAllDoctors);
router.get('/doctors/:id', adminController.getDoctorById);
router.post('/doctors', adminController.createDoctor);
router.put('/doctors/:id', adminController.updateDoctor);
router.delete('/doctors/:id', adminController.deleteDoctor);

export default router;

