import { supabase } from '../../shared/config/supabase.js';
import { createCompatibleNotification } from '../notifications/notificationCompatibilityService.js';

// Helper: Insert in-app notification
const sendInAppNotification = async ({ user_id, title, message, type = 'appointment_update' }) => {
  try {
    if (!user_id) {
      console.log('No user_id provided for notification');
      return { success: false, error: 'No user_id provided' };
    }

    const cleanUserId = String(user_id).trim();
    const notificationData = {
      user_id: cleanUserId,
      title,
      message,
      type,
      is_read: false,
      created_at: new Date().toISOString(),
    };

    const compatibilityResult = await createCompatibleNotification(notificationData);

    if (!compatibilityResult.success) {
      console.error('Notification insert failed:', compatibilityResult.legacyError);
      return { success: false, error: compatibilityResult.legacyError };
    }

    return { success: true, data: compatibilityResult.legacyNotification };
  } catch (err) {
    console.error('Exception in sendInAppNotification:', err.message);
    return { success: false, error: err.message, exception: true };
  }
};

// -------------------------------------------------- Helper: Format date for display --------------------------------------------------
const formatDateDisplay = (dateStr) => {
  try {
    const d = new Date(`${dateStr}T00:00:00`);
    return d.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  } catch {
    return dateStr;
  }
};

const formatDoctorDisplayName = (doctorName) => {
  const cleaned = String(doctorName || '').trim().replace(/^(dr\.?\s*)+/i, '');
  if (!cleaned) return 'Doctor Not Assigned';
  return `Dr. ${cleaned}`;
};

const buildSimpleAppointmentNotification = (status, appointment) => {
  const key = String(status || '').trim().toLowerCase();
  const map = {
    booked: { label: 'Booked' },
    confirmed: { label: 'Confirmed' },
    cancelled: { label: 'Cancelled' },
    rescheduled: { label: 'Rescheduled' },
    completed: { label: 'Completed' },
    pending: { label: 'Pending' },
  };

  const meta = map[key] || { label: status || 'Updated' };
  const doctorDisplayName = formatDoctorDisplayName(appointment.doctor_name);
  const appointmentDate = appointment.appointment_date ? formatDateDisplay(appointment.appointment_date) : 'Not specified';
  const appointmentTime = appointment.appointment_time || 'Not specified';
  const statusText = appointment.status || meta.label || 'Pending';

  const actionLineMap = {
    booked: 'Your appointment has been booked successfully.',
    confirmed: 'Your appointment has been confirmed.',
    cancelled: 'Your appointment has been cancelled.',
    rescheduled: 'Your appointment has been rescheduled.',
    completed: 'Your appointment has been marked as completed.',
    pending: 'Your appointment is pending confirmation.',
  };

  const actionLine = actionLineMap[key] || 'Your appointment details have been updated.';

  return {
    title: `Appointment ${meta.label}`,
    message:
      `Appointment ${meta.label}\n\n` +
      `Hello ${appointment.patient_name || 'Patient'},\n` +
      `${actionLine}\n\n` +
      `Doctor: ${doctorDisplayName}\n` +
      `Department: ${appointment.department || 'General'}\n` +
      `Date: ${appointmentDate}\n` +
      `Time: ${appointmentTime}\n` +
      `Appointment ID: #${appointment.id}\n` +
      `Status: ${statusText}`,
  };
};
const digitsOnly = (value) => String(value || '').replace(/\D/g, '');

const buildBookingNotificationRecipients = ({ patient_phone, user_id, patient_name, booking_for }) => {
  const recipients = new Set();

  const phoneRaw = String(patient_phone || '').trim();
  const userRaw = String(user_id || '').trim();

  if (phoneRaw) recipients.add(phoneRaw);
  if (userRaw) recipients.add(userRaw);

  const phoneDigits = digitsOnly(phoneRaw);
  const userDigits = digitsOnly(userRaw);

  if (phoneDigits) {
    recipients.add(phoneDigits);
    if (phoneDigits.length >= 10) recipients.add(phoneDigits.slice(-10));
  }

  if (userDigits) {
    recipients.add(userDigits);
    if (userDigits.length >= 10) recipients.add(userDigits.slice(-10));
  }

  if ((booking_for === 'family' || booking_for === 'other') && patient_name) {
    recipients.add(String(patient_name).trim());
  }

  return [...recipients].filter(Boolean);
};
/**
 * Book a new appointment
 */
export const bookAppointment = async (req, res, next) => {
  try {
    const {
      patient_name,
      patient_phone,
      patient_email,
      patient_age,
      patient_gender,
      membership_number,
      doctor_id,
      doctor_name,
      department,
      appointment_date,
      appointment_time,
      appointment_type,
      reason,
      medical_history,
      address,
      user_type,
      user_id,
      booking_for,
      patient_relationship
    } = req.body;

    // Validate required fields
    if (!patient_name || !patient_phone || !doctor_id || !doctor_name ||
      !appointment_date || !appointment_time || !reason) {
      console.warn('Validation failed. Received:', {
        patient_name: patient_name ? 'YES' : 'NO',
        patient_phone: patient_phone ? 'YES' : 'NO',
        doctor_id: doctor_id ? 'YES' : 'NO',
        doctor_name: doctor_name ? `YES (${doctor_name})` : 'NO - EMPTY!',
        appointment_date: appointment_date ? 'YES' : 'NO',
        appointment_time: appointment_time ? 'YES' : 'NO',
        reason: reason ? 'YES' : 'NO'
      });
      return res.status(400).json({
        success: false,
        message: 'Please provide all required fields (including appointment time)'
      });
    }

    console.log('ðŸ“ Creating appointment:', {
      patient_name,
      doctor_name,
      appointment_date
    });

    // Insert appointment into database
    const { data: appointment, error } = await supabase
      .from('appointments')
      .insert([
        {
          patient_name,
          patient_phone,
          patient_email: null,
          patient_age: patient_age || null,
          patient_gender: patient_gender || null,
          membership_number: membership_number || null,
          doctor_id,
          doctor_name,
          department: department || null,
          appointment_date,
          appointment_time: appointment_time || null,
          appointment_type: appointment_type || 'General Consultation',
          reason,
          medical_history: medical_history || null,
          address: address || null,
          user_type: user_type || null,
          user_id: user_id || null,
          booking_for: booking_for || 'self',
          patient_relationship: patient_relationship || null,
          status: 'Pending',
          created_at: new Date().toISOString()
        }
      ])
      .select()
      .single();

    if (error) {
      console.error('âŒ Database error:', error);
      throw error;
    }

    console.log('Appointment created with ID:', appointment.id);
    console.log('Notification will use doctor_name:', appointment.doctor_name || doctor_name);

    // Send in-app notification – booking confirmation (compact format)
    const notificationDoctor = String(appointment.doctor_name || doctor_name || 'Unknown').trim();
    const notificationDept = String(appointment.department || department || 'General').trim();
    
    const bookingNotif = buildSimpleAppointmentNotification('booked', {
      id: appointment.id,
      patient_name: appointment.patient_name || patient_name,
      doctor_name: notificationDoctor,
      department: notificationDept,
      appointment_date: appointment.appointment_date || appointment_date,
      appointment_time: appointment.appointment_time || appointment_time || null,
      status: 'Booked',
    });

        const recipientIds = buildBookingNotificationRecipients({
      patient_phone,
      user_id,
      patient_name,
      booking_for,
    });

    let notificationSent = false;

    for (const recipientId of recipientIds) {
      const notificationResult = await sendInAppNotification({
        user_id: recipientId,
        title: bookingNotif.title,
        message: bookingNotif.message,
        type: 'appointment_insert',
      });

      if (notificationResult.success) {
        notificationSent = true;
        console.log(`✅ Booking notification created for ${recipientId}`);
      } else {
        console.error(`❌ Booking notification FAILED for ${recipientId}:`, notificationResult.error);
      }
    }

    res.status(201).json({
      success: true,
      message: 'Appointment booked successfully',
      data: appointment,
      notificationSent,
      notificationRecipients: recipientIds,
    });

  } catch (error) {
    console.error('âŒ Error booking appointment:', error);
    next(error);
  }
};

/**
 * Get appointments by user phone
 */
export const getUserAppointments = async (req, res, next) => {
  try {
    const { phone } = req.params;

    if (!phone) {
      return res.status(400).json({
        success: false,
        message: 'Phone number is required'
      });
    }

    const { data: appointments, error } = await supabase
      .from('appointments')
      .select('*')
      .eq('patient_phone', phone)
      .order('appointment_date', { ascending: false });

    if (error) throw error;

    res.status(200).json({
      success: true,
      count: appointments.length,
      data: appointments
    });

  } catch (error) {
    console.error('âŒ Error fetching user appointments:', error);
    next(error);
  }
};

/**
 * Get all appointments (admin)
 */
export const getAllAppointments = async (req, res, next) => {
  try {
    const { status, date } = req.query;

    let query = supabase
      .from('appointments')
      .select('*')
      .order('appointment_date', { ascending: false });

    if (status) {
      query = query.eq('status', status);
    }

    if (date) {
      query = query.eq('appointment_date', date);
    }

    const { data: appointments, error } = await query;

    if (error) throw error;

    res.status(200).json({
      success: true,
      count: appointments.length,
      data: appointments
    });

  } catch (error) {
    console.error('âŒ Error fetching appointments:', error);
    next(error);
  }
};

/**
 * Get appointment by ID
 */
export const getAppointmentById = async (req, res, next) => {
  try {
    const { id } = req.params;

    const { data: appointment, error } = await supabase
      .from('appointments')
      .select('*')
      .eq('id', id)
      .single();

    if (error) throw error;

    if (!appointment) {
      return res.status(404).json({
        success: false,
        message: 'Appointment not found'
      });
    }

    res.status(200).json({
      success: true,
      data: appointment
    });

  } catch (error) {
    console.error('âŒ Error fetching appointment:', error);
    next(error);
  }
};

/**
 * Update appointment status
 */
export const updateAppointmentStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const validStatuses = ['Pending', 'Confirmed', 'Cancelled', 'Completed'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid status'
      });
    }

    const { data: appointment, error } = await supabase
      .from('appointments')
      .update({
        status,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    // In-app notification for status change (compact format)
    const statusNotif = buildSimpleAppointmentNotification(status, appointment);

    const statusNotifResult = await sendInAppNotification({
      user_id: appointment.patient_phone,
      title: statusNotif.title,
      message: statusNotif.message,
      type: 'appointment_update',
    });

    if (statusNotifResult.success) {
      console.log(`âœ… Status notification created for ${appointment.patient_phone} - Status: ${status}`);
    } else {
      console.error(`âŒ Status notification FAILED for ${appointment.patient_phone}:`, statusNotifResult.error);
    }

    res.status(200).json({
      success: true,
      message: 'Appointment status updated successfully',
      data: appointment,
      notification: statusNotifResult
    });

  } catch (error) {
    console.error('âŒ Error updating appointment:', error);
    next(error);
  }
};

/**
 * Cancel appointment
 */
export const cancelAppointment = async (req, res, next) => {
  try {
    const { id } = req.params;

    const { data: appointment, error } = await supabase
      .from('appointments')
      .update({
        status: 'Cancelled',
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    // In-app notification for cancellation (compact format)
    const cancelNotif = buildSimpleAppointmentNotification('cancelled', appointment);
    await sendInAppNotification({
      user_id: appointment.patient_phone,
      title: cancelNotif.title,
      message: cancelNotif.message,
      type: 'appointment_update',
    });

    res.status(200).json({
      success: true,
      message: 'Appointment cancelled successfully',
      data: appointment
    });

  } catch (error) {
    console.error('âŒ Error cancelling appointment:', error);
    next(error);
  }
};

/**
 * Delete appointment
 */
export const deleteAppointment = async (req, res, next) => {
  try {
    const { id } = req.params;

    const { error } = await supabase
      .from('appointments')
      .delete()
      .eq('id', id);

    if (error) throw error;

    res.status(200).json({
      success: true,
      message: 'Appointment deleted successfully'
    });

  } catch (error) {
    console.error('âŒ Error deleting appointment:', error);
    next(error);
  }
}

/**
 * Update appointment details
 */
export const updateAppointment = async (req, res, next) => {
  try {
    const { id } = req.params;
    const {
      patient_name,
      patient_phone,
      patient_email,
      patient_age,
      patient_gender,
      membership_number,
      doctor_id,
      doctor_name,
      department,
      appointment_date,
      appointment_time,  // Add appointment_time
      appointment_type,
      reason,
      medical_history,
      address,
      status,
      booking_for,
      patient_relationship,
      remark
    } = req.body;

    const updateData = {};

    // Only add fields that are provided in the request
    if (patient_name !== undefined) updateData.patient_name = patient_name;
    if (patient_phone !== undefined) updateData.patient_phone = patient_phone;
    if (patient_email !== undefined) updateData.patient_email = patient_email;
    if (patient_age !== undefined) updateData.patient_age = patient_age;
    if (patient_gender !== undefined) updateData.patient_gender = patient_gender;
    if (membership_number !== undefined) updateData.membership_number = membership_number;
    if (doctor_id !== undefined) updateData.doctor_id = doctor_id;
    if (doctor_name !== undefined) updateData.doctor_name = doctor_name;
    if (department !== undefined) updateData.department = department;
    if (appointment_date !== undefined) updateData.appointment_date = appointment_date;
    if (appointment_time !== undefined) updateData.appointment_time = appointment_time;
    if (appointment_type !== undefined) updateData.appointment_type = appointment_type;
    if (reason !== undefined) updateData.reason = reason;
    if (medical_history !== undefined) updateData.medical_history = medical_history;
    if (address !== undefined) updateData.address = address;
    if (status !== undefined) updateData.status = status;
    if (booking_for !== undefined) updateData.booking_for = booking_for;
    if (patient_relationship !== undefined) updateData.patient_relationship = patient_relationship;
    if (remark !== undefined) updateData.remark = remark;

    // Always update the updated_at timestamp
    updateData.updated_at = new Date().toISOString();

    // Fetch old appointment before updating to detect changes
    const { data: oldAppointment } = await supabase
      .from('appointments')
      .select('appointment_date, appointment_time, remark, patient_name, patient_phone, doctor_name, department, status')
      .eq('id', id)
      .single();

    const { data: appointment, error } = await supabase
      .from('appointments')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    // Detect what changed and send targeted notification
    if (oldAppointment) {
      const dateChanged = appointment_date && appointment_date !== oldAppointment.appointment_date;
      const timeChanged = appointment_time && appointment_time !== oldAppointment.appointment_time;
      const remarkChanged = remark !== null && remark !== undefined && remark !== oldAppointment.remark;

      if (remarkChanged) {
        console.log(`Remark changed detected - old: "${oldAppointment.remark}" new: "${remark}"`);
        const doctorDisplayName = formatDoctorDisplayName(appointment.doctor_name);

        const remarkNotifResult = await sendInAppNotification({
          user_id: appointment.patient_phone,
          title: 'Appointment Booked',
          message:
            `Appointment Booked

Hello ${appointment.patient_name || 'Patient'},
Your appointment is successfully booked and updated by admin.

Doctor: ${doctorDisplayName}
Department: ${appointment.department || 'General'}
Date: ${formatDateDisplay(appointment.appointment_date)}
Time: ${appointment.appointment_time || 'Not specified'}
Appointment ID: #${appointment.id}
Status: ${appointment.status || 'Pending'}

Doctor Note:
"${remark}"
Please arrive at the hospital on time.`,
          type: 'appointment_update',
        });

        if (remarkNotifResult.success) {
          console.log('Remark notification created successfully');
        } else {
          console.error('Remark notification FAILED:', remarkNotifResult.error);
        }
      }

      if (dateChanged || timeChanged) {
        console.log(`ðŸ“… Date/Time change detected - dateChanged: ${dateChanged}, timeChanged: ${timeChanged}`);
        const rescheduledNotif = buildSimpleAppointmentNotification('rescheduled', appointment);
        const dateTimeNotifResult = await sendInAppNotification({
          user_id: appointment.patient_phone,
          title: rescheduledNotif.title,
          message: rescheduledNotif.message,
          type: 'appointment_update',
        });
        
        if (dateTimeNotifResult.success) {
          console.log(`âœ… Date/Time notification created successfully`);
        } else {
          console.error(`âŒ Date/Time notification FAILED:`, dateTimeNotifResult.error);
        }
      }

      // If status changed via update
      if (status && status !== oldAppointment?.status) {
        console.log(`ðŸ”„ Status change detected - old: "${oldAppointment?.status}" new: "${status}"`);
        
        const statusNotif = buildSimpleAppointmentNotification(status, appointment);
        const statusNotifResult = await sendInAppNotification({
          user_id: appointment.patient_phone,
          title: statusNotif.title,
          message: statusNotif.message,
          type: 'appointment_update',
        });
        
        if (statusNotifResult.success) {
          console.log(`âœ… Status notification created for status: ${status}`);
        } else {
          console.error(`âŒ Status notification FAILED:`, statusNotifResult.error);
        }
      }
    }

    res.status(200).json({
      success: true,
      message: 'Appointment updated successfully',
      data: appointment
    });

  } catch (error) {
    console.error('âŒ Error updating appointment:', error);
    next(error);
  }
};

// Approve and reject functions removed as per requirement;

/**
 * Generate time slots from time range string for a specific day
 */
const generateTimeSlots = (timeRange, dayShort) => {
  if (!timeRange) {
    console.log('No time range provided');
    return [];
  }

  console.log('Processing time range:', timeRange, 'for day:', dayShort);

  const slots = [];
  const parts = timeRange.split(',').map(p => p.trim());

  console.log('Split parts:', parts);

  let currentDays = [];
  for (const part of parts) {
    const match = part.match(/^([\w,\s]*)\s*(.+)?$/);
    if (match) {
      const dayPart = match[1].trim();
      const timePart = match[2] ? match[2].trim() : '';

      console.log('Part:', part, 'Day part:', dayPart, 'Time part:', timePart);

      if (dayPart) {
        currentDays.push(...dayPart.split(',').map(d => d.trim().toLowerCase()));
      }

      if (timePart) {
        console.log('Processing time part:', timePart, 'for days:', currentDays);

        // Apply time to currentDays
        for (const day of currentDays) {
          const dayLower = day.toLowerCase();
          const dayShortLower = dayShort.toLowerCase();

          // Check various matching conditions
          const dayMatches = dayLower.includes(dayShortLower) ||
            dayLower === 'daily' ||
            dayLower === 'all' ||
            (dayLower === 'mon' && dayShortLower === 'mon') ||
            (dayLower === 'tue' && dayShortLower === 'tue') ||
            (dayLower === 'wed' && dayShortLower === 'wed') ||
            (dayLower === 'thu' && dayShortLower === 'thu') ||
            (dayLower === 'fri' && dayShortLower === 'fri') ||
            (dayLower === 'sat' && dayShortLower === 'sat') ||
            (dayLower === 'sun' && dayShortLower === 'sun') ||
            (dayLower.includes('monday') && dayShortLower === 'mon') ||
            (dayLower.includes('tuesday') && dayShortLower === 'tue') ||
            (dayLower.includes('wednesday') && dayShortLower === 'wed') ||
            (dayLower.includes('thursday') && dayShortLower === 'thu') ||
            (dayLower.includes('friday') && dayShortLower === 'fri') ||
            (dayLower.includes('saturday') && dayShortLower === 'sat') ||
            (dayLower.includes('sunday') && dayShortLower === 'sun');

          if (dayMatches) {
            console.log('Day matches:', day, 'Processing time:', timePart);

            const subparts = timePart.split('&').map(p => p.trim());
            for (const sub of subparts) {
              console.log('Processing subpart:', sub);

              const timeMatch = sub.match(/(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)/);
              if (timeMatch) {
                const start = parseFloat(timeMatch[1]);
                const end = parseFloat(timeMatch[2]);

                console.log('Time range:', start, 'to', end);

                const startHour = Math.floor(start);
                const startMin = (start % 1) * 60;
                const endHour = Math.floor(end);
                const endMin = (end % 1) * 60;

                for (let h = startHour; h <= endHour; h++) {
                  const minStart = (h === startHour) ? startMin : 0;
                  const minEnd = (h === endHour) ? endMin : 60;

                  for (let m = minStart; m < minEnd; m += 30) {
                    const hour12 = h > 12 ? h - 12 : (h === 0 ? 12 : h);
                    const ampm = h >= 12 ? 'PM' : 'AM';
                    const time = `${hour12.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')} ${ampm}`;
                    if (!slots.includes(time)) {
                      slots.push(time);
                      console.log('Added slot:', time);
                    }
                  }
                }
              } else {
                console.log('No time match for subpart:', sub);
              }
            }
          } else {
            console.log('Day does not match:', day, 'vs', dayShort);
          }
        }
        currentDays = []; // Reset for next group
      }
    }
  }

  console.log('Final slots generated:', slots);
  return slots.sort();
};

/**
 * Get available time slots for a doctor on a specific date and OPD type
 */
export const getAvailableSlots = async (req, res, next) => {
  try {
    const { doctorId, date, opdType } = req.params;

    console.log('ðŸ” Getting slots for:', { doctorId, date, opdType });

    // Get doctor details
    const { data: doctor, error: doctorError } = await supabase
      .from('opd_schedule')
      .select('*')
      .eq('id', parseInt(doctorId))
      .single();

    if (doctorError || !doctor) {
      console.log('âŒ Doctor not found:', doctorError);
      return res.status(404).json({
        success: false,
        message: 'Doctor not found'
      });
    }

    console.log('ðŸ‘¨â€âš•ï¸ Doctor found:', doctor);

    // Get time range for the OPD type
    const timeRange = opdType === 'General OPD' ? doctor.general_opd_days : doctor.private_opd_days;
    console.log('â° Time range for', opdType, ':', timeRange);

    // If no time range, provide default slots
    if (!timeRange) {
      console.log('No time range found, using default slots');
      const defaultSlots = [
        '09:00 AM', '09:30 AM', '10:00 AM', '10:30 AM', '11:00 AM', '11:30 AM',
        '02:00 PM', '02:30 PM', '03:00 PM', '03:30 PM', '04:00 PM', '04:30 PM'
      ];

      // Since we no longer track appointment times, we can't filter based on booked times
      const availableSlots = defaultSlots;

      return res.status(200).json({
        success: true,
        data: availableSlots
      });
    }

    // Get day short
    const selectedDate = new Date(date);
    const dayName = selectedDate.toLocaleDateString('en-US', { weekday: 'long' });
    const dayShort = dayName.substring(0, 3).toLowerCase();
    console.log('ðŸ“… Selected date:', date, 'Day:', dayName, 'Short:', dayShort);

    // Generate time slots from the time range for the selected day
    const slots = generateTimeSlots(timeRange, dayShort);
    console.log('ðŸŽ¯ Generated slots:', slots);

    if (slots.length === 0) {
      console.log('âš ï¸ No slots generated. Time range may be invalid or day not matching.');
      return res.status(200).json({
        success: true,
        data: [],
        message: 'No available time slots for the selected date and OPD type'
      });
    }

    // Since we no longer track appointment times, we can't filter based on booked times
    const availableSlots = slots;
    console.log('âœ… Available slots after filtering:', availableSlots);

    res.status(200).json({
      success: true,
      data: availableSlots
    });

  } catch (error) {
    console.error('âŒ Error getting available slots:', error);
    next(error);
  }
}; // End of getAvailableSlots function

// Approve and reject functions removed as per requirement
