import { supabase } from '../shared/config/supabase.js';

async function findMemberships() {
  try {
    console.log('\n🔍 Searching for P-879 and MMPB-01...\n');
    
    // Search member_trust_links for these numbers
    const { data: mtl } = await supabase
      .from('member_trust_links')
      .select('*, Trust:trust_id(name), member_relationship:member_id(name, email)')
      .limit(10000);
    
    const found = mtl?.filter(r => 
      r.membership_no?.includes('P-879') || 
      r.membership_no?.includes('MMPB') ||
      r.membership_no?.includes('879') ||
      r.membership_no?.includes('MMPB-01')
    ) || [];
    
    console.log(`Found ${found.length} matching records:\n`);
    found.forEach((r, i) => {
      if (i < 10) {
        console.log(`${i+1}. Member: ${r.member_id.substring(0, 8)}...`);
        console.log(`   Trust: ${r.Trust?.name}`);
        console.log(`   Membership: ${r.membership_no}`);
        console.log('');
      }
    });
    
    // Also check for Trust names containing KAMDHENU or Mahila
    console.log('\n📋 Sample memberships BY TRUST:\n');
    
    const { data: allTrusts } = await supabase
      .from('Trust')
      .select('id, name');
    
    const kamdhenuId = allTrusts?.find(t => t.name?.includes('KAMDHENU'))?.id;
    const mahilaId = allTrusts?.find(t => t.name === 'Mahila Mandal')?.id;
    
    if (kamdhenuId) {
      const { data: km } = await supabase
        .from('member_trust_links')
        .select('membership_no, member_id')
        .eq('trust_id', kamdhenuId)
        .limit('5');
      console.log('KAMDHENU sample memberships:');
      km?.forEach(m => console.log(`  - ${m.membership_no}`));
    }
    
    if (mahilaId) {
      const { data: mm } = await supabase
        .from('member_trust_links')
        .select('membership_no, member_id')
        .eq('trust_id', mahilaId)
        .limit(5);
      console.log('\nMahila Mandal sample memberships:');
      mm?.forEach(m => console.log(`  - ${m.membership_no}`));
    }
    
  } catch (err) {
    console.error('Error:', err.message);
  }
  process.exit(0);
}

findMemberships();
