import { supabase } from '../config/supabase.js';

/**
 * Create a new referral
 */
export const createReferralService = async (referralData) => {
  try {
    const { data, error } = await supabase
      .from('referrals')
      .insert({
        user_id: String(referralData.userId),
        user_name: referralData.userName,
        user_email: referralData.userEmail,
        user_phone: referralData.userPhone,
        patient_name: referralData.patientName,
        patient_age: referralData.patientAge,
        patient_gender: referralData.patientGender,
        patient_phone: referralData.patientPhone,
        category: referralData.category,
        referred_to_doctor: referralData.referredToDoctor,
        doctor_id: referralData.doctorId,
        department: referralData.department,
        medical_condition: referralData.medicalCondition,
        notes: referralData.notes,
        status: 'Pending'
      })
      .select()
      .single();

    if (error) {
      console.error('Supabase error creating referral:', error);
      throw error;
    }

    return data;
  } catch (error) {
    console.error('Error creating referral:', error);
    throw error;
  }
};

/**
 * Get user's referrals
 */
export const getUserReferralsService = async (userId) => {
  try {
    const { data, error } = await supabase
      .from('referrals')
      .select('*')
      .eq('user_id', String(userId))
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Supabase error fetching referrals:', error);
      throw error;
    }

    return data || [];
  } catch (error) {
    console.error('Error fetching referrals:', error);
    throw error;
  }
};

/**
 * Get user's referral counts by category
 */
export const getReferralCountsService = async (userId) => {
  try {
    const { data, error } = await supabase
      .from('referrals')
      .select('category')
      .eq('user_id', String(userId));

    if (error) {
      console.error('Supabase error fetching referral counts:', error);
      throw error;
    }

    const generalCount = (data || []).filter(r => r.category === 'General').length;
    const ewsCount = (data || []).filter(r => r.category === 'EWS').length;
    const total = (data || []).length;

    return {
      generalCount,
      ewsCount,
      total
    };
  } catch (error) {
    console.error('Error fetching referral counts:', error);
    throw error;
  }
};

/**
 * Get all referrals (admin)
 */
export const getAllReferralsService = async () => {
  try {
    const { data, error } = await supabase
      .from('referrals')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Supabase error fetching all referrals:', error);
      throw error;
    }

    return data || [];
  } catch (error) {
    console.error('Error fetching all referrals:', error);
    throw error;
  }
};

/**
 * Update referral status
 */
export const updateReferralStatusService = async (referralId, status) => {
  try {
    const { data, error } = await supabase
      .from('referrals')
      .update({ status })
      .eq('id', referralId)
      .select()
      .single();

    if (error) {
      console.error('Supabase error updating referral status:', error);
      throw error;
    }

    return data;
  } catch (error) {
    console.error('Error updating referral status:', error);
    throw error;
  }
};

/**
 * Update referral
 */
export const updateReferralService = async (referralId, updateData) => {
  try {
    const updateFields = {};
    
    if (updateData.patientName) updateFields.patient_name = updateData.patientName;
    if (updateData.patientAge !== undefined) updateFields.patient_age = updateData.patientAge;
    if (updateData.patientGender) updateFields.patient_gender = updateData.patientGender;
    if (updateData.patientPhone) updateFields.patient_phone = updateData.patientPhone;
    if (updateData.category) updateFields.category = updateData.category;
    if (updateData.referredToDoctor) updateFields.referred_to_doctor = updateData.referredToDoctor;
    if (updateData.doctorId !== undefined) updateFields.doctor_id = updateData.doctorId;
    if (updateData.department) updateFields.department = updateData.department;
    if (updateData.medicalCondition) updateFields.medical_condition = updateData.medicalCondition;
    if (updateData.notes !== undefined) updateFields.notes = updateData.notes;

    const { data, error } = await supabase
      .from('referrals')
      .update(updateFields)
      .eq('id', referralId)
      .select()
      .single();

    if (error) {
      console.error('Supabase error updating referral:', error);
      throw error;
    }

    return data;
  } catch (error) {
    console.error('Error updating referral:', error);
    throw error;
  }
};

/**
 * Delete referral
 */
export const deleteReferralService = async (referralId) => {
  try {
    const { error } = await supabase
      .from('referrals')
      .delete()
      .eq('id', referralId);

    if (error) {
      console.error('Supabase error deleting referral:', error);
      throw error;
    }

    return true;
  } catch (error) {
    console.error('Error deleting referral:', error);
    throw error;
  }
};

