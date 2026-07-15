import { supabase } from '../config/supabase.js';

// Helper to resolve trust_id from trust_name if needed
const resolveTrustId = async (trustId, trustName) => {
  if (trustId) return trustId;
  
  if (trustName) {
    try {
      const { data: trustData } = await supabase
        .from('Trust')
        .select('id')
        .ilike('name', String(trustName).trim())
        .limit(1);
      return trustData?.[0]?.id || null;
    } catch (err) {
      console.error('Error resolving trust_id from trust_name:', err);
      return null;
    }
  }
  
  return null;
};

// Get all active marquee updates for a specific trust
export const getMarqueeUpdates = async (req, res) => {
  try {
    const { trust_id: trustId, trust_name: trustName } = req.query;
    
    const resolvedTrustId = await resolveTrustId(trustId, trustName);

    console.log('Fetching marquee updates...', { trustId, trustName, resolvedTrustId });

    if (!resolvedTrustId) {
      // No trust provided — return empty (trust_id is NOT NULL in schema)
      console.log('No trust_id resolved, returning empty marquee list');
      return res.json({ success: true, data: [], count: 0 });
    }

    // Filter strictly by trust_id (trust_id is NOT NULL in new schema)
    const { data, error } = await supabase
      .from('marquee_updates')
      .select('id, trust_id, message, is_active, priority, created_at, updated_at')
      .eq('is_active', true)
      .eq('trust_id', resolvedTrustId)
      .order('priority', { ascending: true })
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching marquee updates:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch marquee updates',
        error: error.message
      });
    }

    console.log(`✅ Fetched ${data?.length || 0} marquee updates for trust: ${resolvedTrustId}`);

    res.json({
      success: true,
      data: data || [],
      count: data?.length || 0
    });
  } catch (error) {
    console.error('Error in getMarqueeUpdates:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
};

// Add new marquee update (Admin only)
export const addMarqueeUpdate = async (req, res) => {
  try {
    const { message, priority = 0, trust_id, created_by } = req.body;

    if (!message || message.trim() === '') {
      return res.status(400).json({
        success: false,
        message: 'Message is required'
      });
    }

    if (!trust_id) {
      return res.status(400).json({
        success: false,
        message: 'trust_id is required'
      });
    }

    // Only set created_by/updated_by if it is a valid UUID (FK to Members Table)
    const isValidUUID = (val) =>
      val && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val);

    const insertData = {
      message: message.trim(),
      priority: parseInt(priority) || 0,
      is_active: true,
      trust_id: trust_id,
    };

    if (isValidUUID(created_by)) {
      insertData.created_by = created_by;
      insertData.updated_by = created_by;
    }

    const { data, error } = await supabase
      .from('marquee_updates')
      .insert([insertData])
      .select()
      .single();

    if (error) {
      console.error('Error adding marquee update:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to add marquee update',
        error: error.message
      });
    }

    res.status(201).json({
      success: true,
      message: 'Marquee update added successfully',
      data: data
    });
  } catch (error) {
    console.error('Error in addMarqueeUpdate:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
};

// Update marquee update (Admin only)
export const updateMarqueeUpdate = async (req, res) => {
  try {
    const { id } = req.params;
    const { message, priority, is_active, updated_by } = req.body;

    const updateData = {};
    if (message !== undefined) updateData.message = message.trim();
    if (priority !== undefined) updateData.priority = parseInt(priority);
    if (is_active !== undefined) updateData.is_active = Boolean(is_active);
    updateData.updated_at = new Date().toISOString();

    const isValidUUID = (val) =>
      val && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val);
    if (isValidUUID(updated_by)) {
      updateData.updated_by = updated_by;
    }

    const { data, error } = await supabase
      .from('marquee_updates')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('Error updating marquee update:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to update marquee update',
        error: error.message
      });
    }

    if (!data) {
      return res.status(404).json({
        success: false,
        message: 'Marquee update not found'
      });
    }

    res.json({
      success: true,
      message: 'Marquee update updated successfully',
      data: data
    });
  } catch (error) {
    console.error('Error in updateMarqueeUpdate:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
};

// Delete marquee update (Admin only)
export const deleteMarqueeUpdate = async (req, res) => {
  try {
    const { id } = req.params;

    const { error } = await supabase
      .from('marquee_updates')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('Error deleting marquee update:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to delete marquee update',
        error: error.message
      });
    }

    res.json({
      success: true,
      message: 'Marquee update deleted successfully'
    });
  } catch (error) {
    console.error('Error in deleteMarqueeUpdate:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
};

// Get all marquee updates (including inactive) - Admin only
export const getAllMarqueeUpdates = async (req, res) => {
  try {
    const { trust_id } = req.query;

    let query = supabase
      .from('marquee_updates')
      .select('*')
      .order('created_at', { ascending: false });

    if (trust_id) {
      query = query.eq('trust_id', trust_id);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Error fetching all marquee updates:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch marquee updates',
        error: error.message
      });
    }

    res.json({
      success: true,
      data: data || [],
      count: data?.length || 0
    });
  } catch (error) {
    console.error('Error in getAllMarqueeUpdates:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
};
