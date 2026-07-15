import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://gskzafarbzhdcgvrrkdc.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdza3phZmFyYnpoZGNndnJya2RjIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NzA4NDAzMiwiZXhwIjoyMDgyNjYwMDMyfQ.Dou0kR2REzV3CdRpHfBBD-XDrE2opZ7FfXXVOzOM0Vs';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function setupNotificationsTable() {
  console.log('🔧 Setting up notifications table...');

  // Create table SQL
  const createTableSQL = `
    create table if not exists public.notifications (
      id uuid not null default gen_random_uuid (),
      user_id text not null,
      title text not null,
      message text not null,
      is_read boolean null default false,
      type text null default 'general'::text,
      created_at timestamp with time zone null default now(),
      target_audience text null,
      constraint notifications_pkey primary key (id)
    ) TABLESPACE pg_default;

    create index IF not exists notifications_user_id_idx on public.notifications using btree (user_id) TABLESPACE pg_default;

    create index IF not exists notifications_created_at_idx on public.notifications using btree (created_at desc) TABLESPACE pg_default;

    -- Disable RLS for now (same as current implementation)
    alter table public.notifications disable row level security;

    -- Add to realtime publication
    alter publication supabase_realtime add table public.notifications;
  `;

  // We can't run raw SQL from the client, so let's just test if the table exists
  console.log('✅ Table creation SQL is ready - run this in your Supabase SQL Editor:');
  console.log(createTableSQL);
  console.log('\n');
}

async function addTestNotifications() {
  console.log('📝 Adding test notifications...');
  
  // Get the current user from localStorage (simulating app environment)
  const userStr = localStorage?.getItem?.('user');
  if (!userStr) {
    console.error('❌ No user in localStorage. Please login first and run this from browser console.');
    return;
  }

  const user = JSON.parse(userStr);
  const userId = user.Mobile || user.mobile || user.phone || user['Membership number'] || 'test_user';
  
  console.log(`📱 Current User ID: ${userId}`);

  const testNotifications = [
    {
      user_id: userId,
      title: 'Appointment Confirmed',
      message: 'Your appointment with Dr. Sharma on March 5, 2026 is confirmed.',
      type: 'appointment',
      is_read: false
    },
    {
      user_id: userId,
      title: 'Test Report Ready',
      message: 'Your COVID-19 test report is ready. Please download from Reports section.',
      type: 'report',
      is_read: false
    },
    {
      user_id: userId,
      title: 'Health Camp Reminder',
      message: 'Free Cardiac Checkup Camp on March 29, 2026. Register now!',
      type: 'general',
      is_read: true
    }
  ];

  try {
    const { data, error } = await supabase
      .from('notifications')
      .insert(testNotifications);

    if (error) {
      console.error('❌ Error inserting test notifications:', error);
      return;
    }

    console.log('✅ Test notifications added successfully!');
    console.log('📊 Added:', data?.length || testNotifications.length, 'notifications');
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

async function verifyNotifications() {
  console.log('🔍 Verifying notifications table...');

  try {
    const { data, error, status } = await supabase
      .from('notifications')
      .select('*')
      .limit(5);

    if (error) {
      console.error('❌ Table Error:', error.message);
      console.error('   Status:', status);
      return false;
    }

    console.log('✅ Notifications table exists!');
    console.log('📊 Total notifications in table:', data?.length || 0);
    if (data && data.length > 0) {
      console.log('📋 Sample notification:', data[0]);
    }
    return true;
  } catch (error) {
    console.error('❌ Connection Error:', error.message);
    return false;
  }
}

// Main execution
console.log('🚀 Notifications Setup Script\n');
console.log('Step 1: Setup Table');
await setupNotificationsTable();

console.log('\nStep 2: Verify Table');
const tableExists = await verifyNotifications();

if (tableExists) {
  console.log('\n✅ Table exists! You can now:');
  console.log('   1. Refresh your app home page');
  console.log('   2. The bell icon should now show notifications if any exist');
  console.log('\nTo add test notifications, run in browser console after login:');
  console.log('   await import("./setup-notifications.js").then(m => m.addTestNotifications())');
} else {
  console.log('\n⚠️  Table does not exist yet!');
  console.log('Please run this SQL in your Supabase SQL Editor:');
  console.log('   CREATE TABLE IF NOT EXISTS public.notifications ...');
}
