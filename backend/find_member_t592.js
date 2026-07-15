import { supabase } from './config/supabase.js';

async function findMember() {
  try {
    console.log('🔍 Finding Member T-592...\n');
    
    // First check what columns Members table has
    const { data: sample, error: sampleError } = await supabase
      .from('Members')
      .select('*')
      .limit(1);
    
    if (!sampleError && sample && sample.length > 0) {
      console.log('📋 Members table columns:', Object.keys(sample[0]));
      console.log('');
    }
    
    // Now search for member
    const { data: members, error } = await supabase
      .from('Members')
      .select('*')
      .textSearch('fts', 'T-592', { type: 'plain', config: 'english' }) // try text search
      .limit(10);
    
    let member = null;
    if (error || !members || members.length === 0) {
      // Try filter approach
      const { data: allMembers } = await supabase
        .from('Members')
        .select('*')
        .limit(1000);
      
      // Find member client-side
      if (allMembers) {
        member = allMembers.find(m => {
          return Object.values(m).some(v => String(v).includes('T-592'));
        });
      }
    } else {
      member = members[0];
    }
    
    if (!member) {
      console.error('⚠️ Member T-592 not found in Members table!');
      return;
    }
    
    if (!member) {
      console.log('⚠️ No member found with S.No. = T-592');
      return;
    }
    
    console.log('✅ MEMBER FOUND:\n');
    console.log('Members ID (UUID):', member.members_id);
    console.log('Display ID:', member['S.No.']);
    console.log('Name:', member.Name || member.name);
    console.log('Email:', member.Email || member.email);
    console.log('Membership number:', member['Membership number'] || member.membership_number);
    
    // Now check if this member has records in member_trust_links
    console.log('\n📋 MEMBER_TRUST_LINKS records:\n');
    const { data: trustLinks, error: tlError } = await supabase
      .from('member_trust_links')
      .select('*, Trust:trust_id(name)')
      .eq('member_id', member.members_id);
    
    if (tlError) {
      console.error('Error fetching trust links:', tlError);
    } else {
      if (trustLinks.length === 0) {
        console.log('⚠️ NO RECORDS in member_trust_links!');
      } else {
        trustLinks.forEach(link => {
          console.log(`  ✓ ${link.Trust?.name} (${link.membership_no})`);
        });
      }
    }
    
    // Check reg_members for this member
    console.log('\n📋 REG_MEMBERS records:\n');
    const { data: regMembers, error: rmError } = await supabase
      .from('reg_members')
      .select('*, trust:trust_id(name)')
      .ilike('member_id_ref', `%${member.members_id}%`)
      .or(`member_id_text.ilike.%${member['S.No.']}%`);
    
    if (!rmError && regMembers && regMembers.length > 0) {
      regMembers.forEach(rm => {
        console.log(`  ✓ ${rm.trust?.name || 'Unknown'} - Position: ${rm.position || 'N/A'}`);
      });
    } else {
      console.log('Checking reg_members with different query...');
    }
    
  } catch (err) {
    console.error('❌ Error:', err.message);
  }
  process.exit(0);
}

findMember();
