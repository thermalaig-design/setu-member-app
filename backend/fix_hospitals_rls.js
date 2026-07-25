import { supabase } from './config/supabase.js';

console.log('Fixing RLS policy for hospitals table...');

async function fixHospitalsRLS() {
  try {
    console.log('🔍 Checking current RLS policies on hospitals table...');
    
    // First, let's try to run the RLS policy creation using Supabase's RPC
    // We'll create a policy that allows public read access (similar to the Members Table)
    
    // Enable RLS if not already enabled
    console.log('Checking if RLS is enabled for hospitals table...');
    
    // We need to execute this via the SQL Editor in Supabase, but let's try to see what policies exist
    const { data: policies, error: policyError } = await supabase
      .from('information_schema.table_privileges')
      .select('*')
      .eq('table_name', 'hospitals');

    if (policyError) {
      console.log('Note: Could not fetch table privileges:', policyError.message);
    } else {
      console.log('Found table privileges info for hospitals');
    }

    // Since we can't modify RLS policies via the client, let's try to insert with service_role
    // But first, let's see if we can run a raw SQL query to check the current policies
    console.log('Attempting to add RLS policy for hospitals table...');
    
    // Let's try to run the SQL commands that would normally be run in the Supabase SQL Editor
    // Since we can't run raw SQL through the client, we'll provide the instructions
    console.log('\n💡 RLS Policy Fix Required:');
    console.log('Please run the following commands in the Supabase SQL Editor:');
    console.log('');
    console.log('-- Enable RLS on hospitals table (if not already enabled)');
    console.log('ALTER TABLE "hospitals" ENABLE ROW LEVEL SECURITY;');
    console.log('');
    console.log('-- Create policy to allow public read access');
    console.log('CREATE POLICY "Allow public read access on hospitals"');
    console.log('ON "hospitals"');
    console.log('FOR SELECT');
    console.log('TO public');
    console.log('USING (true);');
    console.log('');
    console.log('-- If you need to insert data, also add insert policy:');
    console.log('CREATE POLICY "Allow public insert access on hospitals"');
    console.log('ON "hospitals"');
    console.log('FOR INSERT');
    console.log('TO public');
    console.log('WITH CHECK (true);');
    console.log('');
    console.log('Then try running the setup_hospitals.js script again.');
    
    // Let's try to insert data using upsert to see if that works
    console.log('\n🔄 Trying to insert data using upsert...');
    
    const sampleHospital = {
      hospital_name: 'AIIMS New Delhi',
      trust_name: 'Indian Council of Medical Research',
      hospital_type: 'Government Medical College & Hospital',
      address: 'Sarai, Akbarpur, New Delhi',
      city: 'New Delhi',
      state: 'Delhi',
      pincode: '110029',
      established_year: 1956,
      bed_strength: 2500,
      accreditation: 'NABH, JCI',
      facilities: 'Emergency, ICU, Operation Theater, Diagnostic Center',
      departments: 'Cardiology, Neurology, Orthopedics, Oncology, Pediatrics',
      contact_phone: '+91-11-26588500',
      contact_email: 'director@aiims.edu',
      is_active: true
    };

    const { error: upsertError } = await supabase
      .from('hospitals')
      .upsert([sampleHospital], { onConflict: ['hospital_name'] });

    if (upsertError) {
      console.log('❌ Upsert also failed:', upsertError.message);
      console.log('The RLS policy definitely needs to be fixed in Supabase SQL Editor.');
    } else {
      console.log('✅ Upsert succeeded! Data may have been inserted.');
    }

  } catch (error) {
    console.log('❌ Error in RLS fix attempt:', error.message);
  }
}

fixHospitalsRLS();