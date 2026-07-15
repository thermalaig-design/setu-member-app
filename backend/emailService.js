import nodemailer from 'nodemailer';
import process from 'process';

// Create reusable transporter
let transporter;

try {
  // Check if email credentials are available
  const emailUser = process.env.EMAIL_USER;
  const emailPass = process.env.EMAIL_PASSWORD;
  
  if (!emailUser || !emailPass) {
    console.warn('⚠️ Email credentials not found in environment variables');
    console.warn('⚠️ Email notifications will be disabled');
    transporter = null;
  } else {
    transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 587,
      secure: false, // true for 465, false for other ports
      auth: {
        user: emailUser,
        pass: emailPass
      }
    });

    // Test transporter configuration asynchronously
    transporter.verify()
      .then(() => {
        console.log('✅ Email transporter is ready to send messages');
      })
      .catch((error) => {
        console.warn('⚠️ Email transporter configuration error:', error.message);
        console.warn('⚠️ Email notifications will be disabled');
        transporter = null;
      });
  }
} catch (error) {
  console.warn('⚠️ Failed to initialize email transporter:', error.message);
  console.warn('⚠️ Email notifications will be disabled');
  // Create a dummy transporter that logs instead of sending emails
  transporter = {
    sendMail: async (mailOptions) => {
      console.log('📧 Email would have been sent to:', mailOptions.to);
      console.log('📧 Subject:', mailOptions.subject);
      console.log('📧 Body preview:', mailOptions.text?.substring(0, 100) + '...');
      return { messageId: 'dummy-message-id', response: 'Mock response' };
    }
  };
}

/**
 * Send appointment confirmation email
 */
export const sendAppointmentEmail = async ({
  to,
  patientName,
  patientPhone,
  patientEmail,
  doctorName,
  department,
  appointmentDate,
  appointmentTime,
  appointmentType,
  reason,
  appointmentId
}) => {
  try {
    // Hard disabled by requirement: do not send appointment booking emails.
    console.log('📧 Appointment booking email is disabled - skipping send');
    return { messageId: 'appointment-email-disabled', response: 'Appointment booking email disabled' };

    // Check if email is disabled
    if (!transporter) {
      console.log('📧 Email notifications are disabled - skipping appointment email');
      return { messageId: 'email-disabled', response: 'Email notifications disabled' };
    }
    // Format date nicely
    const formattedDate = new Date(appointmentDate).toLocaleDateString('en-IN', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });

    const mailOptions = {
      from: {
        name: 'Maharaja Agrasen Hospital',
        address: process.env.EMAIL_USER || 'no-reply@mahsetu.local'
      },
      to: to,
      subject: `🏥 New Appointment Request - ${patientName}`,
      html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body {
      font-family: Arial, sans-serif;
      line-height: 1.6;
      color: #333;
      margin: 0;
      padding: 0;
      background-color: #f4f4f4;
    }
    .container {
      max-width: 600px;
      margin: 20px auto;
      background: white;
      border-radius: 10px;
      overflow: hidden;
      box-shadow: 0 2px 10px rgba(0,0,0,0.1);
    }
    .header {
      background: linear-gradient(135deg, #4F46E5 0%, #6366F1 100%);
      color: white;
      padding: 30px 20px;
      text-align: center;
    }
    .header h1 {
      margin: 0;
      font-size: 28px;
      font-weight: bold;
    }
    .header p {
      margin: 10px 0 0 0;
      opacity: 0.9;
    }
    .content {
      padding: 30px 20px;
    }
    .appointment-details {
      background: #F9FAFB;
      border-left: 4px solid #4F46E5;
      padding: 20px;
      margin: 20px 0;
      border-radius: 5px;
    }
    .detail-row {
      display: flex;
      padding: 10px 0;
      border-bottom: 1px solid #E5E7EB;
    }
    .detail-row:last-child {
      border-bottom: none;
    }
    .detail-label {
      font-weight: bold;
      color: #4F46E5;
      min-width: 150px;
    }
    .detail-value {
      color: #374151;
    }
    .reason-section {
      background: #FEF3C7;
      border-left: 4px solid #F59E0B;
      padding: 15px;
      margin: 20px 0;
      border-radius: 5px;
    }
    .reason-section h3 {
      margin: 0 0 10px 0;
      color: #92400E;
    }
    .footer {
      background: #F9FAFB;
      padding: 20px;
      text-align: center;
      font-size: 14px;
      color: #6B7280;
    }
    .badge {
      display: inline-block;
      background: #DBEAFE;
      color: #1E40AF;
      padding: 4px 12px;
      border-radius: 20px;
      font-size: 12px;
      font-weight: bold;
      margin-top: 5px;
    }
    .status-pending {
      background: #FEF3C7;
      color: #92400E;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🏥 New Appointment Request</h1>
      <p>Maharaja Agrasen Hospital</p>
    </div>
    
    <div class="content">
      <p>Dear Admin,</p>
      <p>A new appointment has been booked through the Trustee & Patron Portal. Please review the details below:</p>
      
      <div class="appointment-details">
        <h2 style="margin-top: 0; color: #1F2937;">📋 Appointment Details</h2>
        
        <div class="detail-row">
          <div class="detail-label">Appointment ID:</div>
          <div class="detail-value"><strong>#${appointmentId}</strong></div>
        </div>
        
        <div class="detail-row">
          <div class="detail-label">Status:</div>
          <div class="detail-value">
            <span class="badge status-pending">Pending Confirmation</span>
          </div>
        </div>
        
        <div class="detail-row">
          <div class="detail-label">Patient Name:</div>
          <div class="detail-value">${patientName}</div>
        </div>
        
        <div class="detail-row">
          <div class="detail-label">Phone Number:</div>
          <div class="detail-value">${patientPhone}</div>
        </div>
        
        ${patientEmail !== 'Not provided' ? `
        <div class="detail-row">
          <div class="detail-label">Email:</div>
          <div class="detail-value">${patientEmail}</div>
        </div>
        ` : ''}
        
        <div class="detail-row">
          <div class="detail-label">Doctor:</div>
          <div class="detail-value">${doctorName}</div>
        </div>
        
        <div class="detail-row">
          <div class="detail-label">Department:</div>
          <div class="detail-value">${department}</div>
        </div>
        
        <div class="detail-row">
          <div class="detail-label">Appointment Type:</div>
          <div class="detail-value"><span class="badge">${appointmentType}</span></div>
        </div>
        
        <div class="detail-row">
          <div class="detail-label">Date:</div>
          <div class="detail-value">${formattedDate}</div>
        </div>
        
        <div class="detail-row">
          <div class="detail-label">Time:</div>
          <div class="detail-value"><strong>${appointmentTime}</strong></div>
        </div>
      </div>
      
      <div class="reason-section">
        <h3>📝 Reason for Visit</h3>
        <p style="margin: 0; color: #374151;">${reason}</p>
      </div>
      
      <p style="margin-top: 30px;">
        <strong>⚡ Action Required:</strong><br>
        Please contact the patient directly:<br>
        Phone: <strong>${patientPhone}</strong><br>
        ${patientEmail !== 'Not provided' ? `Email: <strong>${patientEmail}</strong>` : ''}
      </p>
    </div>
    
    <div class="footer">
      <p style="margin: 0 0 10px 0;">
        <strong>Maharaja Agrasen Hospital</strong><br>
        Trustee & Patron Portal
      </p>
      <p style="margin: 0; font-size: 12px;">
        This is an automated notification. Please do not reply to this email.
      </p>
    </div>
  </div>
</body>
</html>
      `,
      text: `
New Appointment Request - Maharaja Agrasen Hospital

Appointment ID: #${appointmentId}
Status: Pending Confirmation

Patient Details:
- Name: ${patientName}
- Phone: ${patientPhone}
${patientEmail !== 'Not provided' ? `- Email: ${patientEmail}` : ''}

Appointment Details:
- Doctor: ${doctorName}
- Department: ${department}
- Type: ${appointmentType}
- Date: ${formattedDate}
- Time: ${appointmentTime}

Reason for Visit:
${reason}

Action Required:
Please confirm or reschedule this appointment by contacting the patient at ${patientPhone}${patientEmail !== 'Not provided' ? ` or ${patientEmail}` : ''}.

---
Maharaja Agrasen Hospital
Trustee & Patron Portal
      `
    };

    const info = await transporter.sendMail(mailOptions);
    console.log('✅ Email sent successfully:', info.messageId);
    return info;

  } catch (error) {
    console.error('❌ Error sending email:', error);
    throw error;
  }
};

/**
 * Send appointment confirmation to patient (optional)
 */
export const sendPatientConfirmationEmail = async ({
  to,
  patientName,
  doctorName,
  department,
  appointmentDate,
  appointmentTime,
  appointmentId
}) => {
  try {
    if (!to || to === 'Not provided') {
      console.log('⚠️ No patient email provided, skipping patient confirmation');
      return;
    }

    const formattedDate = new Date(appointmentDate).toLocaleDateString('en-IN', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });

    const mailOptions = {
      from: {
        name: 'Maharaja Agrasen Hospital',
        address: process.env.EMAIL_USER || 'no-reply@mahsetu.local'
      },
      to: to,
      subject: `✅ Appointment Confirmation - Maharaja Agrasen Hospital`,
      html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 20px auto; background: white; border-radius: 10px; overflow: hidden; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
    .header { background: linear-gradient(135deg, #10B981 0%, #059669 100%); color: white; padding: 30px 20px; text-align: center; }
    .content { padding: 30px 20px; }
    .appointment-box { background: #F0FDF4; border-left: 4px solid #10B981; padding: 20px; margin: 20px 0; border-radius: 5px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>✅ Appointment Confirmed</h1>
      <p>Maharaja Agrasen Hospital</p>
    </div>
    <div class="content">
      <p>Dear ${patientName},</p>
      <p>Your appointment has been successfully booked!</p>
      <div class="appointment-box">
        <h3>📋 Appointment Details</h3>
        <p><strong>Appointment ID:</strong> #${appointmentId}</p>
        <p><strong>Doctor:</strong> ${doctorName}</p>
        <p><strong>Department:</strong> ${department}</p>
        <p><strong>Date:</strong> ${formattedDate}</p>
        <p><strong>Time:</strong> ${appointmentTime}</p>
      </div>
      <p>Please arrive 15 minutes before your scheduled appointment time.</p>
      <p>If you need to cancel or reschedule, please contact us as soon as possible.</p>
    </div>
  </div>
</body>
</html>
      `
    };

    const info = await transporter.sendMail(mailOptions);
    console.log('✅ Patient confirmation email sent:', info.messageId);
    return info;

  } catch (error) {
    console.error('❌ Error sending patient confirmation:', error);
    // Don't throw error for patient email failures
  }
}

/**
 * Send appointment rejection notification to patient
 */
export const sendPatientRejectionEmail = async ({
  to,
  patientName,
  doctorName,
  department,
  appointmentDate,
  appointmentId
}) => {
  try {
    if (!to || to === 'Not provided') {
      console.log('⚠️ No patient email provided, skipping rejection notification');
      return;
    }

    const formattedDate = new Date(appointmentDate).toLocaleDateString('en-IN', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });

    const mailOptions = {
      from: {
        name: 'Maharaja Agrasen Hospital',
        address: process.env.EMAIL_USER || 'no-reply@mahsetu.local'
      },
      to: to,
      subject: `❌ Appointment Request Rejected - Maharaja Agrasen Hospital`,
      html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 20px auto; background: white; border-radius: 10px; overflow: hidden; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
    .header { background: linear-gradient(135deg, #EF4444 0%, #DC2626 100%); color: white; padding: 30px 20px; text-align: center; }
    .content { padding: 30px 20px; }
    .rejection-box { background: #FEF2F2; border-left: 4px solid #EF4444; padding: 20px; margin: 20px 0; border-radius: 5px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>❌ Appointment Request Rejected</h1>
      <p>Maharaja Agrasen Hospital</p>
    </div>
    <div class="content">
      <p>Dear ${patientName},</p>
      <p>We regret to inform you that your appointment request has been rejected.</p>
      <div class="rejection-box">
        <h3>📋 Appointment Details</h3>
        <p><strong>Appointment ID:</strong> #${appointmentId}</p>
        <p><strong>Doctor:</strong> ${doctorName}</p>
        <p><strong>Department:</strong> ${department}</p>
        <p><strong>Date:</strong> ${formattedDate}</p>
      </div>
      <p>Please contact us to reschedule or for any further assistance.</p>
      <p>We apologize for any inconvenience caused.</p>
    </div>
  </div>
</body>
</html>
      `
    };

    const info = await transporter.sendMail(mailOptions);
    console.log('✅ Patient rejection email sent:', info.messageId);
    return info;

  } catch (error) {
    console.error('❌ Error sending patient rejection:', error);
    // Don't throw error for patient email failures
  }
};

/**
 * Send referral notification email
 */
export const sendReferralEmail = async ({
  referralId,
  userName,
  userPhone,
  patientName,
  patientAge,
  patientGender,
  patientPhone,
  category,
  referredToDoctor,
  department,
  medicalCondition,
  notes
}) => {
  try {
    // Check if email is disabled
    if (!transporter) {
      console.log('📧 Email notifications are disabled - skipping referral email');
      return { messageId: 'email-disabled', response: 'Email notifications disabled' };
    }

    // Email sending to no-reply@mahsetu.local has been disabled
    console.log('📧 Referral notification would be sent for:', patientName);
    return { messageId: 'referral-email-disabled', response: 'Referral email notifications disabled' };

    /* Commented out - email to no-reply@mahsetu.local disabled
    const formattedDate = new Date().toLocaleDateString('en-IN', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });

    const mailOptions = {
      from: {
        name: 'Maharaja Agrasen Hospital',
        address: process.env.EMAIL_USER || 'no-reply@mahsetu.local'
      },
      to: 'no-reply@mahsetu.local', // Disabled - no longer send to this email
      subject: `🩺 New Patient Referral - ${patientName}`,
      html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body {
      font-family: Arial, sans-serif;
      line-height: 1.6;
      color: #333;
      margin: 0;
      padding: 0;
      background-color: #f4f4f4;
    }
    .container {
      max-width: 600px;
      margin: 20px auto;
      background: white;
      border-radius: 10px;
      overflow: hidden;
      box-shadow: 0 2px 10px rgba(0,0,0,0.1);
    }
    .header {
      background: linear-gradient(135deg, #4F46E5 0%, #6366F1 100%);
      color: white;
      padding: 30px 20px;
      text-align: center;
    }
    .header h1 {
      margin: 0;
      font-size: 28px;
      font-weight: bold;
    }
    .header p {
      margin: 10px 0 0 0;
      opacity: 0.9;
    }
    .content {
      padding: 30px 20px;
    }
    .referral-details {
      background: #F9FAFB;
      border-left: 4px solid #4F46E5;
      padding: 20px;
      margin: 20px 0;
      border-radius: 5px;
    }
    .detail-row {
      display: flex;
      padding: 10px 0;
      border-bottom: 1px solid #E5E7EB;
    }
    .detail-row:last-child {
      border-bottom: none;
    }
    .detail-label {
      font-weight: bold;
      color: #4F46E5;
      min-width: 150px;
    }
    .detail-value {
      color: #374151;
    }
    .condition-section {
      background: #FEF3C7;
      border-left: 4px solid #F59E0B;
      padding: 15px;
      margin: 20px 0;
      border-radius: 5px;
    }
    .condition-section h3 {
      margin: 0 0 10px 0;
      color: #92400E;
    }
    .footer {
      background: #F9FAFB;
      padding: 20px;
      text-align: center;
      font-size: 14px;
      color: #6B7280;
    }
    .badge {
      display: inline-block;
      background: #DBEAFE;
      color: #1E40AF;
      padding: 4px 12px;
      border-radius: 20px;
      font-size: 12px;
      font-weight: bold;
      margin-top: 5px;
    }
    .badge-general {
      background: #E5E7EB;
      color: #374151;
    }
    .badge-ews {
      background: #DBEAFE;
      color: #1E40AF;
    }
    .status-pending {
      background: #FEF3C7;
      color: #92400E;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🩺 New Patient Referral</h1>
      <p>Maharaja Agrasen Hospital</p>
    </div>
    
    <div class="content">
      <p>Dear Admin,</p>
      <p>A new patient referral has been submitted through the Trustee & Patron Portal. Please review the details below:</p>
      
      <div class="referral-details">
        <h2 style="margin-top: 0; color: #1F2937;">📋 Referral Details</h2>
        
        <div class="detail-row">
          <div class="detail-label">Referral ID:</div>
          <div class="detail-value"><strong>#${referralId}</strong></div>
        </div>
        
        <div class="detail-row">
          <div class="detail-label">Status:</div>
          <div class="detail-value">
            <span class="badge status-pending">Pending Review</span>
          </div>
        </div>
        
        <div class="detail-row">
          <div class="detail-label">Category:</div>
          <div class="detail-value">
            <span class="badge ${category === 'EWS' ? 'badge-ews' : 'badge-general'}">${category}</span>
          </div>
        </div>
        
        <div class="detail-row">
          <div class="detail-label">Referred By:</div>
          <div class="detail-value">${userName}</div>
        </div>
        
        <div class="detail-row">
          <div class="detail-label">Referrer Phone:</div>
          <div class="detail-value">${userPhone || 'N/A'}</div>
        </div>
        
        <div class="detail-row">
          <div class="detail-label">Date:</div>
          <div class="detail-value">${formattedDate}</div>
        </div>
      </div>

      <div class="referral-details">
        <h2 style="margin-top: 0; color: #1F2937;">👤 Patient Details</h2>
        
        <div class="detail-row">
          <div class="detail-label">Patient Name:</div>
          <div class="detail-value"><strong>${patientName}</strong></div>
        </div>
        
        ${patientAge ? `
        <div class="detail-row">
          <div class="detail-label">Age:</div>
          <div class="detail-value">${patientAge} years</div>
        </div>
        ` : ''}
        
        ${patientGender ? `
        <div class="detail-row">
          <div class="detail-label">Gender:</div>
          <div class="detail-value">${patientGender}</div>
        </div>
        ` : ''}
        
        <div class="detail-row">
          <div class="detail-label">Phone Number:</div>
          <div class="detail-value"><strong>${patientPhone}</strong></div>
        </div>
      </div>

      <div class="referral-details">
        <h2 style="margin-top: 0; color: #1F2937;">👨‍⚕️ Doctor Details</h2>
        
        <div class="detail-row">
          <div class="detail-label">Referred To:</div>
          <div class="detail-value"><strong>${referredToDoctor}</strong></div>
        </div>
        
        ${department ? `
        <div class="detail-row">
          <div class="detail-label">Department:</div>
          <div class="detail-value">${department}</div>
        </div>
        ` : ''}
      </div>
      
      <div class="condition-section">
        <h3>📝 Medical Condition</h3>
        <p style="margin: 0; color: #374151;">${medicalCondition}</p>
      </div>
      
      ${notes ? `
      <div class="condition-section">
        <h3>📄 Additional Notes</h3>
        <p style="margin: 0; color: #374151;">${notes}</p>
      </div>
      ` : ''}
      
      <p style="margin-top: 30px;">
        <strong>⚡ Action Required:</strong><br>
        Please contact the patient directly:<br>
        Phone: <strong>${patientPhone}</strong><br>
        ${userPhone ? `Referrer Contact: <strong>${userPhone}</strong>` : ''}
      </p>
    </div>
    
    <div class="footer">
      <p style="margin: 0 0 10px 0;">
        <strong>Maharaja Agrasen Hospital</strong><br>
        Trustee & Patron Portal
      </p>
      <p style="margin: 0; font-size: 12px;">
        This is an automated notification. Please do not reply to this email.
      </p>
    </div>
  </div>
</body>
</html>
      `,
      text: `
New Patient Referral - Maharaja Agrasen Hospital

Referral ID: #${referralId}
Status: Pending Review
Category: ${category}
Date: ${formattedDate}

Referrer Details:
- Name: ${userName}
- Phone: ${userPhone || 'N/A'}

Patient Details:
- Name: ${patientName}
${patientAge ? `- Age: ${patientAge} years` : ''}
${patientGender ? `- Gender: ${patientGender}` : ''}
- Phone: ${patientPhone}

Doctor Details:
- Referred To: ${referredToDoctor}
${department ? `- Department: ${department}` : ''}

Medical Condition:
${medicalCondition}

${notes ? `Additional Notes:\n${notes}` : ''}

Action Required:
Please contact the patient directly at ${patientPhone}${userPhone ? ` or the referrer at ${userPhone}` : ''}.

---
Maharaja Agrasen Hospital
Trustee & Patron Portal
      `
    };

    const info = await transporter.sendMail(mailOptions);
    console.log('✅ Referral email sent successfully:', info.messageId);
    return info;
    */

  } catch (error) {
    console.error('❌ Error sending referral email:', error);
    throw error;
  }
};

