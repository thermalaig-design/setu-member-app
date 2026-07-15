import { supabase } from './config/supabase.js';

const TRUST_RECORDS = [
  {
    id: '7dfd3e03-7ff9-4543-9485-e169a4586738',
    name: 'TEI',
    icon_url: 'https://i.postimg.cc/TwTHRtkp/Flame-gear-and-insulation-logo.png',
    remark: 'Thermal Engineers and Insulators',
    terms_content: null,
    privacy_content: null
  },
  {
    id: '91d2cd2f-c2c2-437e-a58b-ef505272002d',
    name: 'KAMDHENU HOSPITAL',
    icon_url: 'https://kamdhenumangalparivar.org/resource/Image/logo.png',
    remark: 'Trustee and Patron Portal',
    terms_content: null,
    privacy_content: null
  },
  {
    id: 'a0e3922f-a5e6-4b1e-87d0-59f80adb5af9',
    name: 'MAHARAJA AGRASEN HOSPITAL',
    icon_url: 'https://www.mahdelhi.org/images/mahRound100.png',
    remark: 'Welcome to our portal',
    terms_content: `<h1>Terms & Conditions</h1>

<h2>1. Acceptance of Terms</h2>
<p>By accessing and using this application, you agree to be bound by these Terms and Conditions. If you do not agree, please do not use the application.</p>

<h2>2. Description of Service</h2>
<p>This application provides services for hospital management, including appointment booking, member directory access, and medical reports tracking for Maharaja Agarsen Hospital.</p>

<h2>3. User Obligations</h2>
<p>Users must provide accurate information when registering and using the services. You are responsible for maintaining the confidentiality of your account credentials.</p>

<h2>4. Privacy</h2>
<p>Your use of the application is also governed by our Privacy Policy. Please review it to understand how we collect and use your data.</p>

<h2>5. Limitation of Liability</h2>
<p>The hospital and application developers are not liable for any indirect, incidental, or consequential damages arising from your use of the service.</p>

<h2>6. Modifications</h2>
<p>We reserve the right to modify these terms at any time. Continued use of the application after changes implies acceptance of the new terms.</p>

<p><i>Last updated: January 2026</i></p>`,
    privacy_content: `<h1>Privacy Policy</h1>

<h2>1. Data Collection</h2>
<p>We collect personal information such as name, mobile number, and medical related data to provide hospital services efficiently.</p>

<h2>2. How We Use Data</h2>
<p>Your data is used to manage appointments, provide medical reports, and maintain the trustee directory. We do not sell your personal data to third parties.</p>

<h2>3. Data Security</h2>
<p>We implement security measures to protect your information from unauthorized access, alteration, or disclosure. However, no electronic transmission is 100% secure.</p>

<h2>4. Third-Party Services</h2>
<p>We may use third-party services for SMS notifications and database management (like Supabase and Msg91) which have their own privacy policies.</p>

<h2>5. User Rights</h2>
<p>You have the right to access, update, or request deletion of your personal information through the profile section or by contacting administration.</p>

<h2>6. Contact Us</h2>
<p>If you have questions about this Privacy Policy, please contact Maharaja Agarsen Hospital administration.</p>

<p><i>Last updated: January 2026</i></p>`
  },
  {
    id: 'b353d2ff-ec3b-4b90-a896-69f40662084e',
    name: 'Mahila Mandal',
    icon_url: null,
    remark: null,
    terms_content: null,
    privacy_content: null
  }
];

async function setupTrustTable() {
  try {
    console.log('🚀 Starting Trust table seeding (MAHILA MANDAL base)...');

    for (const trust of TRUST_RECORDS) {
      const { data: existing, error: fetchError } = await supabase
        .from('Trust')
        .select('id')
        .eq('id', trust.id)
        .limit(1);

      if (fetchError) {
        console.error('❌ Error checking Trust row existence:', fetchError.message || fetchError);
        return;
      }

      if (Array.isArray(existing) && existing.length > 0) {
        console.log(`ℹ️ Trust already exists: ${trust.name} (${trust.id}), skipping insert.`);
        continue;
      }

      const { error: insertError } = await supabase.from('Trust').insert([trust]);
      if (insertError) {
        console.error(`❌ Failed to insert Trust ${trust.name}:`, insertError.message || insertError);
        return;
      }
      console.log(`✅ Inserted Trust ${trust.name} (${trust.id})`);
    }

    console.log('🎉 Trust seeding completed!');
    console.log('👉 Now set the app defaults to Mahila Mandal by setting: VITE_DEFAULT_TRUST_NAME=Mahila Mandal and VITE_DEFAULT_TRUST_ID=b353d2ff-ec3b-4b90-a896-69f40662084e');
  } catch (error) {
    console.error('❌ Unexpected error during Trust setup:', error);
  }
}

setupTrustTable();
