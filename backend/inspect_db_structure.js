import { supabase } from './config/supabase.js';

async function inspectTables() {
  try {
    console.log('\n=======================================');
    console.log('📊 DATABASE STRUCTURE INSPECTION');
    console.log('=======================================\n');
    
    // Check member_trust_links table - just count from actual data
    console.log('🔍 Fetching member_trust_links data...\n');
    const { data: mtl, error: mtlError } = await supabase
      .from('member_trust_links')
      .select('*, Trust:trust_id(id, name)')
      .limit(5);
    
    console.log(`member_trust_links - Sample rows:`);
    if (mtl && mtl.length > 0) {
      console.log(`  Found ${mtl.length} records`);
      mtl.forEach((r, i) => {
        console.log(`  ${i+1}. Member ${r.member_id.substring(0, 8)}... → ${r.Trust?.name} (${r.membership_no})`);
      });
    } else {
      console.log('  ❌ No records found or error:', mtlError?.message);
    }
    console.log('');
    
    // Try reg_members
    console.log('🔍 Fetching reg_members data...\n');
    const { data: reg, error: regError } = await supabase
      .from('reg_members')
      .select('*, trust:trust_id(name)')
      .limit(5);
    
    console.log(`reg_members - Sample rows:`);
    if (reg && reg.length > 0) {
      console.log(`  Found ${reg.length} records`);
      reg.forEach((r, i) => {
        console.log(`  ${i+1}. Trust: ${r.trust?.name}, Membership: ${r['Membership number']}`);
      });
    } else {
      console.log('  ❌ No records found or error:', regError?.message);
    }
    console.log('');
    
    // Check what table has records with KAMDHENU or Mahila Mandal
    console.log('🔍 Searching for your trusts (KAMDHENU, Mahila Mandal)...\n');
    
    const { data: allTrusts } = await supabase
      .from('Trust')
      .select('id, name');
    
    const kamdhenuId = allTrusts?.find(t => t.name?.includes('KAMDHENU'))?.id;
    const mahilaId = allTrusts?.find(t => t.name === 'Mahila Mandal')?.id;
    
    console.log('Trust IDs:');
    console.log(`  KAMDHENU: ${kamdhenuId}`);
    console.log(`  Mahila Mandal: ${mahilaId}`);
    console.log('');
    
    if (kamdhenuId) {
      const { data: kmReg } = await supabase
        .from('reg_members')
        .select('members_id, "Membership number"')
        .eq('trust_id', kamdhenuId)
        .limit(3);
      console.log(`KAMDHENU members in reg_members: ${kmReg?.length || 0}`);
      
      const { data: kmMtl } = await supabase
        .from('member_trust_links')
        .select('member_id, membership_no')
        .eq('trust_id', kamdhenuId)
        .limit(3);
      console.log(`KAMDHENU members in member_trust_links: ${kmMtl?.length || 0}`);
    }
    
    console.log('\n=======================================\n');
    
  } catch (err) {
    console.error('❌ Error:', err.message);
  }
  process.exit(0);
}

inspectTables();
