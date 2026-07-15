/* global process */
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';


dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const supabaseKey = supabaseServiceRoleKey || supabaseAnonKey;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing Supabase environment variables in .env file');
}

export const supabase = createClient(supabaseUrl, supabaseKey);

if (!supabaseServiceRoleKey) {
  console.warn('⚠️ Using SUPABASE_ANON_KEY on backend. Set SUPABASE_SERVICE_ROLE_KEY for reliable storage uploads.');
}
console.log('✅ Supabase connected successfully');
