import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const SUPABASE_URL = 'https://gskzafarbzhdcgvrrkdc.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdza3phZmFyYnpoZGNndnJya2RjIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NzA4NDAzMiwiZXhwIjoyMDgyNjYwMDMyfQ.Dou0kR2REzV3CdRpHfBBD-XDrE2opZ7FfXXVOzOM0Vs';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function checkTableExists() {
  console.log('🔍 Checking if notifications table exists...\n');
  
  try {
    const { data, error } = await supabase
      .from('notifications')
      .select('*')
      .limit(1);

    if (error && error.code === 'PGRST116') {
      console.log('❌ Table does not exist!\n');
      return false;
    }

    if (error) {
      console.log('⚠️  Error checking table:', error.message);
      return false;
    }

    console.log('✅ Notifications table exists!\n');
    return true;
  } catch (error) {
    console.log('❌ Error:', error.message);
    return false;
  }
}

async function createTable() {
  console.log('📝 Creating notifications table with SQL...\n');
  
  // Read the SQL file
  const sqlContent = fs.readFileSync('./create_notifications_table.sql', 'utf-8');
  
  console.log('SQL to execute:');
  console.log(sqlContent);
  console.log('\n⚠️  NOTE: You need to run this SQL in your Supabase SQL Editor manually!');
  console.log('Steps:');
  console.log('1. Go to https://app.supabase.com');
  console.log('2. Select your project');
  console.log('3. Go to SQL Editor');
  console.log('4. Create a new query');
  console.log('5. Copy and paste the above SQL');
  console.log('6. Click "Run"');
  console.log('\nAlternatively, open: https://gskzafarbzhdcgvrrkdc.supabase.co/');
}

async function addTestNotifications() {
  console.log('\n✨ Adding test notifications...\n');

  // Test with a sample user ID (using a phone number format)
  const testUserId = '9876543210'; // Replace with actual test user phone number

  const testNotifications = [
    {
      user_id: testUserId,
      title: 'Appointment Confirmed',
      message: 'Your appointment with Dr. Sharma on March 5, 2026 is confirmed.',
      type: 'appointment',
      is_read: false
    },
    {
      user_id: testUserId,
      title: 'Test Report Ready',
      message: 'Your COVID-19 test report is ready. Please download from Reports section.',
      type: 'report',
      is_read: false
    },
    {
      user_id: testUserId,
      title: 'Health Camp Reminder',
      message: 'Free Cardiac Checkup Camp on March 29, 2026. Register now!',
      type: 'general',
      is_read: true
    }
  ];

  try {
    const { data, error } = await supabase
      .from('notifications')
      .insert(testNotifications)
      .select();

    if (error) {
      console.log('❌ Error inserting notifications:', error.message);
      return false;
    }

    console.log('✅ Successfully added', data?.length || 0, 'test notifications!');
    console.log('📌 Test User ID:', testUserId);
    console.log('\nNotifications added:');
    data?.forEach((n, i) => {
      console.log(`  ${i + 1}. ${n.title}`);
    });
    return true;
  } catch (error) {
    console.log('❌ Error:', error.message);
    return false;
  }
}

async function verifyNotifications() {
  console.log('\n🔍 Verifying notifications...\n');

  try {
    const { data, error } = await supabase
      .from('notifications')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(10);

    if (error) {
      console.log('❌ Error fetching notifications:', error.message);
      return;
    }

    console.log('✅ Found', data?.length || 0, 'notifications in database');
    if (data && data.length > 0) {
      console.log('\nRecent notifications:');
      data.forEach((n, i) => {
        console.log(`\n${i + 1}. ${n.title}`);
        console.log(`   Message: ${n.message}`);
        console.log(`   User: ${n.user_id}`);
        console.log(`   Read: ${n.is_read}`);
        console.log(`   Created: ${n.created_at}`);
      });
    }
  } catch (error) {
    console.log('❌ Error:', error.message);
  }
}

// Main execution
async function main() {
  console.log('════════════════════════════════════════════════════════');
  console.log('🚀 Notifications Table Setup & Verification');
  console.log('════════════════════════════════════════════════════════\n');

  const tableExists = await checkTableExists();

  if (!tableExists) {
    console.log('📋 The notifications table needs to be created.\n');
    await createTable();
    process.exit(1);
  }

  // Table exists, now add test data
  await addTestNotifications();
  
  // Verify
  await verifyNotifications();

  console.log('\n════════════════════════════════════════════════════════');
  console.log('✅ Setup Complete!');
  console.log('════════════════════════════════════════════════════════\n');
  console.log('Next Steps:');
  console.log('1. Your app home page should now show notifications in the bell icon');
  console.log('2. If still not showing, try refreshing the page');
  console.log('3. Check browser console for any errors');
}

main().catch(console.error);
