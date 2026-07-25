// Save this file and open in browser console to debug notifications
// Paste into browser console while logged into the app

(async () => {
  console.log('════════════════════════════════════════════════════════');
  console.log('🔧 Notification Debug Helper');
  console.log('════════════════════════════════════════════════════════\n');

  // Step 1: Check logged-in user
  console.log('📱 Step 1: Checking logged-in user...');
  const userStr = localStorage.getItem('user');
  if (!userStr) {
    console.error('❌ No user found in localStorage - Not logged in!');
    return;
  }

  const user = JSON.parse(userStr);
  console.log('✅ User found:', user);

  // Extract user IDs
  const userId = user.Mobile || user.mobile || user.phone || user['Membership number'] || user.id;
  console.log('\n📌 Current User IDs:');
  console.log('  Mobile:', user.Mobile || user.mobile || user.phone);
  console.log('  Membership:', user['Membership number']);
  console.log('  Primary ID:', userId);

  // Step 2: Test Supabase connection
  console.log('\n📱 Step 2: Testing Supabase connection...');
  try {
    const supabase = (await import('./supabaseClient.js')).supabase;
    console.log('✅ Supabase client imported');

    // Test table access
    const { data, error } = await supabase
      .from('notifications')
      .select('*')
      .limit(1);

    if (error) {
      console.error('❌ Error accessing notifications table:', error);
      return;
    }
    console.log('✅ Notifications table accessible');
  } catch (error) {
    console.error('❌ Error importing Supabase:', error.message);
    return;
  }

  // Step 3: Try fetching notifications using the app's method
  console.log('\n📱 Step 3: Fetching notifications using app method...');
  try {
    const { getUserNotifications } = await import('./services/api.js');
    const response = await getUserNotifications();
    console.log('✅ API Response:', response);

    if (response.success && response.data) {
      console.log(`✅ Found ${response.data.length} notifications!`);
      response.data.slice(0, 3).forEach((n, i) => {
        console.log(`  ${i + 1}. ${n.title} (${n.is_read ? 'read' : 'unread'})`);
      });
    } else {
      console.warn('⚠️  No notifications returned or error:', response.message);
    }
  } catch (error) {
    console.error('❌ Error fetching notifications:', error.message);
    console.error(error.stack);
  }

  // Step 4: Manual query with user ID
  console.log('\n📱 Step 4: Manual query for user notifications...');
  try {
    const supabase = (await import('./supabaseClient.js')).supabase;
    
    const { data, error } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', String(userId))
      .order('created_at', { ascending: false });

    if (error) {
      console.error('❌ Query error:', error);
    } else {
      console.log(`✅ Found ${data?.length || 0} notifications for user: ${userId}`);
      if (data && data.length > 0) {
        data.slice(0, 3).forEach((n, i) => {
          console.log(`  ${i + 1}. ${n.title}`);
        });
      }
    }
  } catch (error) {
    console.error('❌ Error:', error.message);
  }

  // Step 5: Check browser storage
  console.log('\n📱 Step 5: Checking app state...');
  console.log('  localStorage user:', userStr.substring(0, 50) + '...');
  console.log('  sessionStorage:', sessionStorage.length, 'items');

  console.log('\n════════════════════════════════════════════════════════');
  console.log('✅ Debug complete!');
  console.log('════════════════════════════════════════════════════════');
  console.log('\n📋 Recommendations:');
  console.log('1. If no notifications found for your user, run in console:');
  console.log('   window.addNotificationsForCurrentUser()');
  console.log('2. Then refresh the page (Ctrl+R)');
  console.log('3. The bell icon should show notifications');
})().catch(console.error);
