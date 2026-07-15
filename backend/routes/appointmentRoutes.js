import express from 'express';
import * as appointmentController from '../controllers/appointmentController.js';

const router = express.Router();

console.log('📅 Setting up appointment routes...');

// Get available time slots for a doctor on a specific date and OPD type
router.get('/available-slots/:doctorId/:date/:opdType', appointmentController.getAvailableSlots);

// Book a new appointment
router.post('/book', appointmentController.bookAppointment);
console.log('✅ Book appointment route registered: POST /book');

// Get all appointments (admin)
router.get('/', appointmentController.getAllAppointments);

// Get appointments by user phone
router.get('/user/:phone', appointmentController.getUserAppointments);

// Get appointment by ID
router.get('/:id', appointmentController.getAppointmentById);

// Update appointment status
router.put('/:id/status', appointmentController.updateAppointmentStatus);

// Cancel appointment
router.put('/:id/cancel', appointmentController.cancelAppointment);

// Delete appointment
router.delete('/:id', appointmentController.deleteAppointment);

// Update appointment details
router.put('/:id', appointmentController.updateAppointment);

// Approve and reject routes removed as per requirement

console.log('✅ All appointment routes registered');

export default router;