import express from 'express';
import multer from 'multer';
import { supabase } from '../config/supabase.js';
import { getUserUUID } from '../services/userService.js';

const router = express.Router();

// Configure multer for memory storage
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only PDF, JPG, PNG allowed.'));
    }
  }
});

// Upload report
router.post('/upload', upload.single('reportFile'), async (req, res) => {
  try {
    const { reportName, reportType, testDate } = req.body;
    const file = req.file;

    if (!file) {
      return res.status(400).json({ success: false, message: 'No file uploaded' });
    }

    // Get user from header (can be membership number or phone)
    const userIdHeader = req.headers['user-id'];
    if (!userIdHeader) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    // Get UUID for user (creates if doesn't exist)
    // For now, we'll use the header value as identifier for storage path
    // and get/create UUID for database
    const userUUID = await getUserUUID(userIdHeader, userIdHeader);
    
    // Use UUID for storage path if available, otherwise use header value
    const storageUserId = userUUID || userIdHeader;
    const fileName = `${storageUserId}/${Date.now()}_${file.originalname}`;
    const { error: uploadError } = await supabase.storage
      .from('reports')
      .upload(fileName, file.buffer, {
        contentType: file.mimetype,
        upsert: false
      });

    if (uploadError) {
      console.error('Upload error:', uploadError);
      return res.status(500).json({ success: false, message: 'Failed to upload file' });
    }

    // Get public URL
    const { data: urlData } = supabase.storage
      .from('reports')
      .getPublicUrl(fileName);

    const fileUrl = urlData.publicUrl;

    // Save metadata to database
    // Use UUID if available, otherwise use header value (will need migration later)
    const dbUserId = userUUID || userIdHeader;
    
    const { data: reportData, error: dbError } = await supabase
      .from('reports')
      .insert({
        user_id: dbUserId,
        report_name: reportName,
        report_type: reportType,
        test_date: testDate,
        file_url: fileUrl
      })
      .select()
      .single();

    if (dbError) {
      console.error('DB error:', dbError);
      // Check if it's specifically an RLS violation
      if (dbError.code === '42501' || dbError.message.toLowerCase().includes('security')) {
        return res.status(403).json({ 
          success: false, 
          message: 'Access denied: Row Level Security policy violation'
        });
      }
      return res.status(500).json({ success: false, message: 'Failed to save report' });
    }

    res.json({
      success: true,
      message: 'Report uploaded successfully',
      report: reportData
    });

  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// Get user's reports
router.get('/', async (req, res) => {
  try {
    const userIdHeader = req.headers['user-id'];
    if (!userIdHeader) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    // Get UUID for user
    const userUUID = await getUserUUID(userIdHeader, userIdHeader);
    const dbUserId = userUUID || userIdHeader;

    const { data: reports, error } = await supabase
      .from('reports')
      .select('*')
      .eq('user_id', dbUserId)
      .order('uploaded_at', { ascending: false });

    if (error) {
      console.error('Fetch error:', error);
      return res.status(500).json({ success: false, message: 'Failed to fetch reports' });
    }

    res.json({
      success: true,
      reports: reports
    });

  } catch (error) {
    console.error('Fetch error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

export default router;