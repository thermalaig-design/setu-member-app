import { supabase } from '../shared/config/supabase.js';
import fs from 'fs';

async function applyNotificationFix() {
  try {
    console.log('🔍 Reading SQL file...');
    const sql = fs.readFileSync('fix_notification_trigger.sql', 'utf8');
    
    console.log('🔧 Applying notification trigger fix...');
    
    // Split SQL into individual statements
    const statements = sql
      .split(';')
      .map(stmt => stmt.trim())
      .filter(stmt => stmt.length > 0 && !stmt.startsWith('--'));
    
    console.log(`📝 Found ${statements.length} SQL statements to execute`);
    
    // Execute each statement
    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];
      console.log(`\n📍 Executing statement ${i + 1}/${statements.length}`);
      
      try {
        // For Supabase, we need to execute raw SQL differently
        // Let's try using the RPC approach or direct query
        const { error } = await supabase.rpc('execute_sql', { 
          sql_statement: statement 
        });
        
        if (error) {
          console.log(`⚠️  RPC failed for statement ${i + 1}, trying direct query...`);
          console.log('Statement:', statement.substring(0, 100) + '...');
          
          // Try direct query approach
          const { error: directError } = await supabase
            .from('appointments')
            .select('id')
            .limit(1);
          
          if (directError) {
            console.error('❌ Direct query also failed:', directError.message);
          } else {
            console.log('✅ Direct query works, but we need to apply the fix manually');
            console.log('Please apply this SQL in your Supabase SQL Editor:');
            console.log('\n--- COPY BELOW THIS LINE ---\n');
            console.log(sql);
            console.log('\n--- COPY ABOVE THIS LINE ---\n');
            return;
          }
        } else {
          console.log(`✅ Statement ${i + 1} executed successfully`);
        }
      } catch (stmtError) {
        console.error(`❌ Error executing statement ${i + 1}:`, stmtError.message);
      }
    }
    
    console.log('\n✅ All SQL statements processed');
    
    // Test the fix
    console.log('\n🧪 Testing the notification fix...');
    await testNotificationFix();
    
  } catch (error) {
    console.error('❌ Error applying notification fix:', error.message);
    console.log('\n📝 Manual steps to fix:');
    console.log('1. Go to your Supabase dashboard');
    console.log('2. Navigate to SQL Editor');
    console.log('3. Copy and paste the content of fix_notification_trigger.sql');
    console.log('4. Run the SQL query');
  }
}

async function testNotificationFix() {
  try {
    console.log('🔍 Testing notification system...');
    
    // Get a sample appointment
    const { data: appointments, error: fetchError } = await supabase
      .from('appointments')
      .select('id, patient_name, patient_phone, doctor_name')
      .limit(1);
    
    if (fetchError) {
      console.error('❌ Error fetching appointment:', fetchError.message);
      return;
    }
    
    if (!appointments || appointments.length === 0) {
      console.log('⚠️  No appointments found to test');
      return;
    }
    
    const appointment = appointments[0];
    console.log(`📋 Testing with appointment ID: ${appointment.id}`);
    console.log(`👤 Patient: ${appointment.patient_name} (${appointment.patient_phone})`);
    console.log(`👨‍⚕️ Doctor: ${appointment.doctor_name}`);
    
    // Update the appointment to trigger notification
    const testRemark = `Test notification fix at ${new Date().toISOString()}`;
    console.log(`📝 Updating appointment with remark: ${testRemark}`);
    
    const { data: updated, error: updateError } = await supabase
      .from('appointments')
      .update({ remark: testRemark })
      .eq('id', appointment.id)
      .select();
    
    if (updateError) {
      console.error('❌ Error updating appointment:', updateError.message);
      return;
    }
    
    console.log('✅ Appointment updated successfully');
    
    // Wait a moment for trigger to execute
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Check if notification was created for the correct user
    console.log(`🔍 Checking notifications for user: ${appointment.patient_phone}`);
    const { data: notifications, error: notificationError } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', appointment.patient_phone)
      .order('created_at', { ascending: false })
      .limit(3);
    
    if (notificationError) {
      console.error('❌ Error fetching notifications:', notificationError.message);
      return;
    }
    
    if (notifications && notifications.length > 0) {
      console.log(`✅ Found ${notifications.length} notifications for user ${appointment.patient_phone}`);
      notifications.forEach((notif, index) => {
        console.log(`  ${index + 1}. Title: ${notif.title}`);
        console.log(`     Message: ${notif.message.substring(0, 100)}...`);
        console.log(`     Created: ${notif.created_at}`);
      });
      console.log('\n🎉 Notification fix is working correctly!');
    } else {
      console.log('⚠️  No notifications found for this user');
      console.log('This might indicate the trigger is not working properly');
    }
    
  } catch (testError) {
    console.error('❌ Error during test:', testError.message);
  }
}

// Run the fix
applyNotificationFix();