import { createReferralService, getUserReferralsService, getReferralCountsService, getAllReferralsService, updateReferralStatusService, updateReferralService, deleteReferralService } from '../services/referralService.js';
import { sendReferralEmail } from '../services/emailService.js';
import { createCompatibleNotification } from '../services/notificationCompatibilityService.js';

/**
 * Create a new referral
 */
export const createReferral = async (req, res, next) => {
  try {
    const userId = req.headers['user-id'];
    const user = req.headers['user'] ? JSON.parse(req.headers['user']) : null;

    if (!userId) {
      return res.status(401).json({ 
        success: false, 
        message: 'Unauthorized. User ID required.' 
      });
    }

    const {
      patientName,
      patientAge,
      patientGender,
      patientPhone,
      category,
      referredToDoctor,
      doctorId,
      department,
      medicalCondition,
      notes
    } = req.body;

    // Validate required fields
    if (!patientName || !patientPhone || !category || !referredToDoctor || !medicalCondition) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: patientName, patientPhone, category, referredToDoctor, medicalCondition'
      });
    }

    // Validate category
    if (!['General', 'EWS'].includes(category)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid category. Must be General or EWS'
      });
    }

    // Check referral limits before creating
    const counts = await getReferralCountsService(userId);
    if (counts.total >= 4) {
      return res.status(400).json({
        success: false,
        message: 'You have reached the maximum limit of 4 referrals (2 General + 2 EWS)'
      });
    }

    if (category === 'General' && counts.generalCount >= 2) {
      return res.status(400).json({
        success: false,
        message: 'You have reached the limit of 2 General category referrals'
      });
    }

    if (category === 'EWS' && counts.ewsCount >= 2) {
      return res.status(400).json({
        success: false,
        message: 'You have reached the limit of 2 EWS category referrals'
      });
    }

    // Create referral
    const referral = await createReferralService({
      userId,
      userName: user?.Name || user?.name || 'Unknown',
      userEmail: user?.Email || user?.email || null,
      userPhone: user?.Mobile || user?.mobile || null,
      patientName,
      patientAge: patientAge ? parseInt(patientAge) : null,
      patientGender,
      patientPhone,
      category,
      referredToDoctor,
      doctorId,
      department,
      medicalCondition,
      notes
    });

    // Create in-app notification for referral
    try {
      const { supabase } = await import('../config/supabase.js').then(m => ({ supabase: m.supabase }));
      
      const referralMsg = 
        `✅ आपका Referral Successfully Create हुआ है!

👤 Patient: ${patientName}
👨‍⚕️ Referred to: ${referredToDoctor}
🏥 Department: ${department || 'General'}
📋 Category: ${category}
🏷️ Condition: ${medicalCondition}

🆔 Referral ID: #${referral.id}
Status: Pending ⏳

${notes ? `📝 Additional Notes: ${notes}\n\n` : ''}Hospital पहुंचने से पहले कृपया अपना referral ID note कर लें।

धन्यवाद! आपके स्वास्थ्य की देखभाल हमारी प्राथमिकता है।`;

      await createCompatibleNotification({
        user_id: String(patientPhone),
        title: '✅ Referral Successfully Created!',
        message: referralMsg,
        type: 'referral',
        is_read: false,
        created_at: new Date().toISOString(),
      });

      console.log(`✅ Referral notification created for ${patientPhone}`);
    } catch (notifError) {
      console.error('⚠️ Error creating referral notification:', notifError.message);
      // Don't fail the request if notification creation fails
    }

    // Send email notification
    try {
      await sendReferralEmail({
        referralId: referral.id,
        userName: user?.Name || user?.name || 'Unknown',
        userPhone: user?.Mobile || user?.mobile || 'N/A',
        patientName,
        patientAge,
        patientGender,
        patientPhone,
        category,
        referredToDoctor,
        department,
        medicalCondition,
        notes
      });
    } catch (emailError) {
      console.error('Error sending referral email:', emailError);
      // Don't fail the request if email fails
    }

    res.status(201).json({
      success: true,
      message: 'Referral created successfully',
      referral
    });

  } catch (error) {
    console.error('Error creating referral:', error);
    next(error);
  }
};

/**
 * Get user's referrals
 */
export const getUserReferrals = async (req, res, next) => {
  try {
    const userId = req.headers['user-id'];
    
    if (!userId) {
      return res.status(401).json({ 
        success: false, 
        message: 'Unauthorized. User ID required.' 
      });
    }

    const referrals = await getUserReferralsService(userId);

    res.json({
      success: true,
      count: referrals.length,
      referrals
    });

  } catch (error) {
    console.error('Error fetching referrals:', error);
    next(error);
  }
};

/**
 * Get user's referral counts
 */
export const getReferralCounts = async (req, res, next) => {
  try {
    const userId = req.headers['user-id'];
    
    if (!userId) {
      return res.status(401).json({ 
        success: false, 
        message: 'Unauthorized. User ID required.' 
      });
    }

    const counts = await getReferralCountsService(userId);

    res.json({
      success: true,
      counts
    });

  } catch (error) {
    console.error('Error fetching referral counts:', error);
    next(error);
  }
};

/**
 * Get all referrals (admin)
 */
export const getAllReferrals = async (req, res, next) => {
  try {
    const referrals = await getAllReferralsService();

    res.json({
      success: true,
      count: referrals.length,
      referrals
    });

  } catch (error) {
    console.error('Error fetching all referrals:', error);
    next(error);
  }
};

/**
 * Update referral status (admin)
 */
export const updateReferralStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!['Pending', 'Approved', 'Rejected', 'Completed'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid status. Must be Pending, Approved, Rejected, or Completed'
      });
    }

    const referral = await updateReferralStatusService(id, status);

    // Create in-app notification for status update
    try {
      const { supabase } = await import('../config/supabase.js').then(m => ({ supabase: m.supabase }));
      
      const statusEmoji = { Approved: '✅', Rejected: '❌', Completed: '🎉', Pending: '⏳' };
      const statusMsg = {
        Approved: `आपका Referral Approved हो गया है! Hospital पहुंचने के लिए appointment book करें।`,
        Rejected: `आपका Referral Reject किया गया है। विस्तृत जानकारी के लिए hospital से संपर्क करें।`,
        Completed: `आपका Referral Successfully Complete हो गया है। Swasth rahein! 💪`,
        Pending: `आपका Referral अभी Pending है। Hospital से जल्द ही confirmation मिलेगी।`,
      };

      const notificationMessage = 
        `${statusEmoji[status] || '📋'} Referral Status Update

👤 Patient: ${referral.patient_name}
👨‍⚕️ Referred to: ${referral.referred_to_doctor}
📋 Category: ${referral.category}
🏷️ Status: ${status} ${statusEmoji[status] || ''}

${statusMsg[status] || ''}

🆔 Referral ID: #${referral.id}`;

      await createCompatibleNotification({
        user_id: String(referral.patient_phone),
        title: `${statusEmoji[status] || '📋'} Referral ${status}`,
        message: notificationMessage,
        type: 'referral',
        is_read: false,
        created_at: new Date().toISOString(),
      });

      console.log(`✅ Referral status notification created for ${referral.patient_phone} - Status: ${status}`);
    } catch (notifError) {
      console.error('⚠️ Error creating referral status notification:', notifError.message);
      // Don't fail the request if notification creation fails
    }

    res.json({
      success: true,
      message: 'Referral status updated successfully',
      referral
    });

  } catch (error) {
    console.error('Error updating referral status:', error);
    next(error);
  }
};

/**
 * Update referral (user can update their own)
 */
export const updateReferral = async (req, res, next) => {
  try {
    const userId = req.headers['user-id'];
    const { id } = req.params;
    const updateData = req.body;

    if (!userId) {
      return res.status(401).json({ 
        success: false, 
        message: 'Unauthorized. User ID required.' 
      });
    }

    // Verify user owns this referral
    const existingReferral = await getUserReferralsService(userId);
    const referral = existingReferral.find(r => r.id === parseInt(id));

    if (!referral) {
      return res.status(404).json({
        success: false,
        message: 'Referral not found or you do not have permission to update it'
      });
    }

    // Update referral
    const updated = await updateReferralService(id, updateData);

    res.json({
      success: true,
      message: 'Referral updated successfully',
      referral: updated
    });

  } catch (error) {
    console.error('Error updating referral:', error);
    next(error);
  }
};

/**
 * Delete referral (user can delete their own)
 */
export const deleteReferral = async (req, res, next) => {
  try {
    const userId = req.headers['user-id'];
    const { id } = req.params;

    if (!userId) {
      return res.status(401).json({ 
        success: false, 
        message: 'Unauthorized. User ID required.' 
      });
    }

    // Verify user owns this referral
    const existingReferrals = await getUserReferralsService(userId);
    const referral = existingReferrals.find(r => r.id === parseInt(id));

    if (!referral) {
      return res.status(404).json({
        success: false,
        message: 'Referral not found or you do not have permission to delete it'
      });
    }

    // Delete referral
    await deleteReferralService(id);

    res.json({
      success: true,
      message: 'Referral deleted successfully'
    });

  } catch (error) {
    console.error('Error deleting referral:', error);
    next(error);
  }
};

