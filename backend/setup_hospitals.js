import { supabase } from './config/supabase.js';

console.log('Setting up hospitals table with sample data...');

async function setupHospitals() {
  try {
    console.log('🔍 Checking if is_active column exists...');
    
    // First, let's try to add the is_active column if it doesn't exist
    // We'll run a query to see the current table structure
    const { data: sampleData, error: sampleError } = await supabase
      .from('hospitals')
      .select('*, is_active')
      .limit(1);

    if (sampleError && sampleError.message.includes('does not exist')) {
      console.log('❌ is_active column does not exist. This needs to be added manually in Supabase SQL Editor.');
      console.log('💡 Please run the ALTER TABLE command in Supabase SQL Editor:');
      console.log('ALTER TABLE public.hospitals ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT true;');
      return;
    } else if (sampleError) {
      console.log('❌ Error checking table structure:', sampleError.message);
      return;
    }

    console.log('✅ is_active column exists.');

    // Check if hospitals table is empty
    const { count, error: countError } = await supabase
      .from('hospitals')
      .select('*', { count: 'exact', head: true });

    if (countError) {
      console.log('❌ Error counting hospitals:', countError.message);
      return;
    }

    if (count > 0) {
      console.log(`📊 Hospitals table already has ${count} records. Skipping sample data insertion.`);
      
      // Show a few sample records
      const { data: sampleRecords, error: sampleRecError } = await supabase
        .from('hospitals')
        .select('*')
        .limit(3);

      if (!sampleRecError) {
        console.log('📝 Sample hospital records:');
        sampleRecords.forEach((hospital, index) => {
          console.log(`${index + 1}. ${hospital.hospital_name} - ${hospital.city}, ${hospital.state}`);
        });
      }
      return;
    }

    console.log('🏥 Hospitals table is empty. Adding sample data...');

    // Insert sample hospital data
    const sampleHospitals = [
      {
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
      },
      {
        hospital_name: 'Fortis Memorial Research Institute',
        trust_name: 'Fortis Healthcare Limited',
        hospital_type: 'Multi-Specialty Hospital',
        address: 'Sector 15, Gurugram',
        city: 'Gurugram',
        state: 'Haryana',
        pincode: '122001',
        established_year: 2008,
        bed_strength: 380,
        accreditation: 'NABH, JCI',
        facilities: 'Advanced Cardiac Care, Cancer Treatment, Organ Transplant',
        departments: 'Cardiology, Oncology, Nephrology, Orthopedics, Neurology',
        contact_phone: '+91-124-4141414',
        contact_email: 'enquiry@fortishealthcare.com',
        is_active: true
      },
      {
        hospital_name: 'Medanta - The Medicity',
        trust_name: 'Medanta Foundation',
        hospital_type: 'Multi-Specialty Hospital',
        address: 'Sector 38, Gurugram',
        city: 'Gurugram',
        state: 'Haryana',
        pincode: '122001',
        established_year: 2009,
        bed_strength: 1250,
        accreditation: 'JCI, NABH',
        facilities: 'Heart Institute, Cancer Institute, Institute of Robotic Surgery',
        departments: 'Cardiology, Oncology, Orthopedics, Neurosciences, Organ Transplant',
        contact_phone: '+91-124-4141414',
        contact_email: 'info@medanta.org',
        is_active: true
      },
      {
        hospital_name: 'Apollo Hospitals',
        trust_name: 'Apollo Hospitals Enterprise Limited',
        hospital_type: 'Multi-Specialty Hospital',
        address: 'Block A, Sector 4, Panchshil Park, Nehru Place',
        city: 'New Delhi',
        state: 'Delhi',
        pincode: '110019',
        established_year: 1983,
        bed_strength: 550,
        accreditation: 'JCI, NABH',
        facilities: 'Advanced Cardiac Care, Cancer Treatment, Emergency Services',
        departments: 'Cardiology, Oncology, Orthopedics, Gastroenterology, Pulmonology',
        contact_phone: '+91-11-26124455',
        contact_email: 'info@apollohospitals.com',
        is_active: true
      },
      {
        hospital_name: 'Max Super Speciality Hospital',
        trust_name: 'Max Healthcare Institute Limited',
        hospital_type: 'Super Speciality Hospital',
        address: '1, Block A, Saket, New Delhi',
        city: 'New Delhi',
        state: 'Delhi',
        pincode: '110017',
        established_year: 2007,
        bed_strength: 320,
        accreditation: 'NABH',
        facilities: 'Cardiac Sciences, Oncology, Orthopedics, Critical Care',
        departments: 'Cardiology, Oncology, Orthopedics, Neurology, Nephrology',
        contact_phone: '+91-11-26515000',
        contact_email: 'enquiry@maxhealthcare.in',
        is_active: true
      }
    ];

    // Insert the sample hospitals
    for (const hospital of sampleHospitals) {
      const { error } = await supabase
        .from('hospitals')
        .insert([hospital]);

      if (error) {
        console.log(`❌ Error inserting ${hospital.hospital_name}:`, error.message);
        return;
      }
    }

    console.log(`✅ Successfully added ${sampleHospitals.length} sample hospitals to the database!`);

    // Verify the data was inserted
    const { data: verifyData, error: verifyError } = await supabase
      .from('hospitals')
      .select('*')
      .limit(5);

    if (verifyError) {
      console.log('❌ Error verifying data:', verifyError.message);
      return;
    }

    console.log('📝 Verification - Sample hospitals in database:');
    verifyData.forEach((hospital, index) => {
      console.log(`${index + 1}. ${hospital.hospital_name} - ${hospital.city}, ${hospital.state}`);
    });

  } catch (error) {
    console.log('❌ Unexpected error:', error.message);
    console.error(error);
  }
}

setupHospitals();