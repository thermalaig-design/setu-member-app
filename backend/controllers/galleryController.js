import { supabase } from '../config/supabase.js';

const TABLE = 'gallery_photos';
const BUCKET = 'gallery';
const UNASSIGNED_FOLDER_NAME = 'General';

const getPublicUrl = (storagePath) => {
  if (!storagePath) return null;
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(storagePath);
  return data?.publicUrl || null;
};

const mapPhotoRow = (row) => ({
  id: row.id,
  storage_path: row.storage_path,
  public_url: row.public_url || getPublicUrl(row.storage_path),
  folder_id: row.folder_id,
  folder_name: row.gallery_folders?.name || UNASSIGNED_FOLDER_NAME,
  created_at: row.created_at,
  uploaded_by: row.uploaded_by,
  trust_id: row.trust_id
});

/**
 * Get all gallery photos
 */
export const getAllGalleryPhotos = async (req, res) => {
  try {
    const { limit = 50, offset = 0 } = req.query;
    const trustId = req.query.trust_id || req.query.trustId || null;

    let query = supabase
      .from(TABLE)
      .select('id, storage_path, public_url, created_at, uploaded_by, folder_id, trust_id, gallery_folders ( id, name )', { count: 'exact' })
      .order('created_at', { ascending: false });

    if (trustId) {
      query = query.eq('trust_id', trustId);
    }

    const { data, error, count } = await query.range(offset, offset + limit - 1);

    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Failed to fetch gallery photos',
        error: error.message
      });
    }

    res.json({
      success: true,
      data: (data || []).map(mapPhotoRow),
      count,
      limit: parseInt(limit),
      offset: parseInt(offset)
    });
  } catch (error) {
    console.error('Error in getAllGalleryPhotos:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
};

/**
 * Get latest gallery photos
 */
export const getLatestGalleryPhotos = async (req, res) => {
  try {
    const { limit = 6 } = req.query;
    const trustId = req.query.trust_id || req.query.trustId || null;

    let query = supabase
      .from(TABLE)
      .select('id, storage_path, public_url, created_at, folder_id, trust_id, gallery_folders ( id, name )')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (trustId) {
      query = query.eq('trust_id', trustId);
    }

    const { data, error } = await query;

    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Failed to fetch latest gallery photos',
        error: error.message
      });
    }

    res.json({
      success: true,
      data: (data || []).map(mapPhotoRow)
    });
  } catch (error) {
    console.error('Error in getLatestGalleryPhotos:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
};

/**
 * Get single gallery photo by ID
 */
export const getGalleryPhotoById = async (req, res) => {
  try {
    const { id } = req.params;

    const { data, error } = await supabase
      .from(TABLE)
      .select('id, storage_path, public_url, created_at, uploaded_by, folder_id, trust_id, gallery_folders ( id, name )')
      .eq('id', id)
      .single();

    if (error) {
      return res.status(404).json({
        success: false,
        message: 'Gallery photo not found',
        error: error.message
      });
    }

    res.json({
      success: true,
      data: mapPhotoRow(data)
    });
  } catch (error) {
    console.error('Error in getGalleryPhotoById:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
};

/**
 * Delete gallery photo (and storage file)
 */
export const deleteGalleryPhoto = async (req, res) => {
  try {
    const { id } = req.params;

    // Get photo details first
    const { data: photo, error: fetchError } = await supabase
      .from(TABLE)
      .select('storage_path')
      .eq('id', id)
      .single();

    if (fetchError) {
      return res.status(404).json({
        success: false,
        message: 'Gallery photo not found',
        error: fetchError.message
      });
    }

    // Delete from storage
    if (photo?.storage_path) {
      const { error: storageError } = await supabase.storage
        .from(BUCKET)
        .remove([photo.storage_path]);

      if (storageError) {
        console.warn('Error deleting file from storage:', storageError);
        // Continue with DB deletion even if file deletion fails
      }
    }

    // Delete from database
    const { error: deleteError } = await supabase
      .from(TABLE)
      .delete()
      .eq('id', id);

    if (deleteError) {
      return res.status(400).json({
        success: false,
        message: 'Failed to delete gallery photo',
        error: deleteError.message
      });
    }

    res.json({
      success: true,
      message: 'Gallery photo deleted successfully'
    });
  } catch (error) {
    console.error('Error in deleteGalleryPhoto:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
};

/**
 * Get gallery stats
 */
export const getGalleryStats = async (req, res) => {
  try {
    const trustId = req.query.trust_id || req.query.trustId || null;
    let query = supabase
      .from(TABLE)
      .select('*', { count: 'exact', head: true });

    if (trustId) {
      query = query.eq('trust_id', trustId);
    }

    const { count, error } = await query;

    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Failed to fetch gallery stats',
        error: error.message
      });
    }

    res.json({
      success: true,
      totalPhotos: count || 0
    });
  } catch (error) {
    console.error('Error in getGalleryStats:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
};
