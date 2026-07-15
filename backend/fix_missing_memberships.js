import { supabase } from './config/supabase.js';

async function fixMemberRecords() {
  try {
    console.log('\n=======================================');
    console.log('🔧 INSERTING MISSING RECORDS FOR T-592');
    console.log('=======================================\n');
    
    // Find all members with Membership numbers P-879 or MMPB-01  
    console.log('🔍 Finding member with P-879 or MMPB-01...\n');
    
    const { data: allReg } = await supabase
      .from('reg_members')
      .select('*, trust:trust_id(id, name)')
      .limit(10000);
    
    // Find KAMDHENU member
    const kamdhenuReg = allReg?.find(r => r['Membership number'] === 'P-879');
    const mahilaReg = allReg?.find(r => r['Membership number'] === 'MMPB-01');
    
    console.log('Found in reg_members:');
    if (kamdhenuReg) {
      console.log(`✓ KAMDHENU: Member ID ${kamdhenuReg.members_id}, Trust ${kamdhenuReg.trust?.name}`);
    } else {
      console.log('✗ P-879 not found');
    }
    
    if (mahilaReg) {
      console.log(`✓ Mahila Mandal: Member ID ${mahilaReg.members_id}, Trust ${mahilaReg.trust?.name}`);
    } else {
      console.log('✗ MMPB-01 not found');
    }
    console.log('');
    
    if (!kamdhenuReg || !mahilaReg) {
      console.log('❌ Could not find required records');
      return;
    }
    
    const memberId = kamdhenuReg.members_id; // Should be same for both
    
    // Check if records already exist in member_trust_links
    console.log(`📋 Checking member_trust_links for member ${memberId.substring(0, 8)}...\n`);
    
    const { data: existing } = await supabase
      .from('member_trust_links')
      .select('*, Trust:trust_id(name)')
      .eq('member_id', memberId);
    
    console.log(`Existing records: ${existing?.length || 0}`);
    if (existing && existing.length > 0) {
      existing.forEach(r => {
        console.log(`  ✓ ${r.Trust?.name} (${r.membership_no})`);
      });
    }
    console.log('');
    
    // Insert missing records
    const kamdhenuTrustId = kamdhenuReg.trust_id;
    const mahilaTrustId = mahilaReg.trust_id;
    
    console.log('📝 Inserting missing records...\n');
    
    const recordsToInsert = [
      {
        member_id: memberId,
        trust_id: kamdhenuTrustId,
        membership_no: 'P-879',
        location: kamdhenuReg['Membership number'] ? 'Primary' : '',
        is_active: true,
      },
      {
        member_id: memberId,
        trust_id: mahilaTrustId,
        membership_no: 'MMPB-01',
        location: mahilaReg['Membership number'] ? 'Primary' : '',
        is_active: true,
      }
    ];
    
    const { data: inserted, error: insertError } = await supabase
      .from('member_trust_links')
      .insert(recordsToInsert)
      .select('*, Trust:trust_id(name)');
    
    if (insertError) {
      console.error('❌ Insert error:', insertError.message);
      return;
    }
    
    console.log('✅ Successfully inserted:');
    inserted?.forEach(r => {
      console.log(`  ✓ ${r.Trust?.name} (${r.membership_no})`);
    });
    
    console.log('\n✨ Now refresh your app and the memberships should appear!');
    console.log('=======================================\n');
    
  } catch (err) {
    console.error('❌ Error:', err.message);
  }
  process.exit(0);
}

fixMemberRecords();
