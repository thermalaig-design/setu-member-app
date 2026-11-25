import { supabase } from '../shared/config/supabase.js';

async function findMemberWithMmpb() {
  try {
    console.log('\n🔍 Finding member with MMPB-01...\n');
    
    // Find the MMPB-01 record
    const { data: mmpbRec } = await supabase
      .from('member_trust_links')
      .select('*, Trust:trust_id(name)')
      .eq('membership_no', 'MMPB-01')
      .single();
    
    if (!mmpbRec) {
      console.log('MMPB-01 not found');
      return;
    }
    
    console.log('✓ Found MMPB-01 record:');
    console.log(`  Member ID: ${mmpbRec.member_id}`);
    console.log(`  Trust: ${mmpbRec.Trust?.name}`);
    console.log('');
    
    // Now get ALL records for this member
    console.log('📋 All memberships for this member:\n');
    const { data: allMemberships } = await supabase
      .from('member_trust_links')
      .select('*, Trust:trust_id(name)')
      .eq('member_id', mmpbRec.member_id)
      .order('created_at', { ascending: false });
    
    console.log(`Total memberships: ${allMemberships?.length || 0}\n`);
    
    allMemberships?.forEach((m, i) => {
      console.log(`${i+1}. ${m.Trust?.name} - ${m.membership_no} (Active: ${m.is_active})`);
    });
    
    // Check reg_members for this same member  
    console.log('\n📋 reg_members records for same member:\n');
    const { data: regRecs } = await supabase
      .from('reg_members')
      .select('*, trust:trust_id(name)')
      .eq('members_id', mmpbRec.member_id);
    
    console.log(`Total reg_members records: ${regRecs?.length || 0}\n`);
    regRecs?.forEach((r, i) => {
      console.log(`${i+1}. ${r.trust?.name} - ${r['Membership number']}`);
    });
    
  } catch (err) {
    console.error('Error:', err.message);
  }
  process.exit(0);
}

findMemberWithMmpb();
