import { supabase } from '../config/supabase.js';
import dotenv from 'dotenv';
dotenv.config();

/**
 * Admin authentication middleware
 * Checks if the user is an admin by verifying their session and role
 */
export const authenticateAdmin = async (req, res, next) => {
  try {
    // Get the authorization header
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'Authorization token required'
      });
    }
    
    const token = authHeader.substring(7); // Remove 'Bearer ' prefix
    
    // Verify the token with Supabase Auth
    const { data: { user }, error } = await supabase.auth.getUser(token);
    
    if (error || !user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid or expired token'
      });
    }
    
    // Check if user has admin privileges
    // For now, we'll check if the user email is in a predefined admin list
    // In a real application, you might want to check user roles in a database
    
    const adminEmails = [
      'admin@hospital.com',  // Add your admin emails here
      'superadmin@hospital.com',
      process.env.ADMIN_EMAIL  // From environment variables
    ].filter(email => email); // Remove undefined/null values
    
    if (!adminEmails.includes(user.email)) {
      return res.status(403).json({
        success: false,
        message: 'Insufficient permissions. Admin access required.'
      });
    }
    
    // Attach user info to request object
    req.adminUser = user;
    next();
  } catch (error) {
    console.error('Admin authentication error:', error);
    res.status(500).json({
      success: false,
      message: 'Authentication server error'
    });
  }
};

/**
 * Alternative admin authentication method using a shared secret/key
 * This can be used when Supabase auth isn't suitable for admin access
 */
export const authenticateAdminByKey = (req, res, next) => {
  try {
    const adminKey = req.headers['x-admin-key'];
    const envAdminKey = process.env.ADMIN_API_KEY;
    
    if (!adminKey || adminKey !== envAdminKey) {
      return res.status(401).json({
        success: false,
        message: 'Invalid admin key'
      });
    }
    
    next();
  } catch (error) {
    console.error('Admin key authentication error:', error);
    res.status(500).json({
      success: false,
      message: 'Authentication server error'
    });
  }
};