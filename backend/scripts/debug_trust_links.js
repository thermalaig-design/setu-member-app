import { supabase } from '../shared/config/supabase.js';

async function debugTrustLinks() {
  try {
    console.log('\n=======================================');
    console.log('🔍 MEMBER TRUST LINKS DEBUG');
    console.log('=======================================\n');
    
    // Get ALL records to see what's in the table
    const { data: allLinks, error: allError } = await supabase
      .from('member_trust_links')
      .select(`
        id, 
        member_id, 
        trust_id, 
        membership_no, 
        is_active,
        location,
        created_at,
        Trust:trust_id(id, name)
      `);
    
    if (allError) {
      console.error('❌ Error fetching all records:', allError);
      return;
    }
    
    console.log(`📊 TOTAL RECORDS: ${allLinks.length}\n`);
    
    // Get all trusts info
    const { data: trusts, error: trustError } = await supabase
      .from('Trust')
      .select('id, name');
    
    if (!trustError) {
      console.log('🏥 AVAILABLE TRUSTS:');
      trusts.forEach(trust => {
        console.log(`  - ${trust.name} (${trust.id})`);
      });
      console.log('');
    }
    
    // Count trusts
    const trustCounts = {};
    allLinks.forEach(link => {
      const trustName = link.Trust?.name || 'Unknown';
      if (!trustCounts[trustName]) {
        trustCounts[trustName] = 0;
      }
      trustCounts[trustName]++;
    });
    
    console.log('📈 TRUST STATISTICS:');
    Object.entries(trustCounts)
      .sort((a, b) => b[1] - a[1])
      .forEach(([name, count]) => {
        console.log(`  ${name}: ${count} members`);
      });
    console.log('');
    
    // Group by member and show sample
    const groupedByMember = {};
    allLinks.forEach(link => {
      if (!groupedByMember[link.member_id]) {
        groupedByMember[link.member_id] = [];
      }
      groupedByMember[link.member_id].push(link);
    });
    
    const memberIds = Object.keys(groupedByMember).sort();
    console.log(`📌 SAMPLE MEMBERS (showing first 5):\n`);
    memberIds.slice(0, 5).forEach(memberId => {
      const links = groupedByMember[memberId];
      console.log(`Member ID: ${memberId}`);
      links.forEach(link => {
        console.log(`  ✓ ${link.Trust?.name || 'Unknown'} (${link.membership_no})`);
      });
      console.log('');
    });
    
    console.log('=======================================\n');
    
  } catch (err) {
    console.error('❌ Error:', err.message);
  }
  process.exit(0);
}

debugTrustLinks();
