import { supabase } from './config/supabase.js';
const run = async () => {
  const { data, error } = await supabase.from('Members').select('*').limit(1);
  if (error) return console.log(error.message);
  const row = (data || [])[0] || {};
  console.log(Object.keys(row));
};
run();
