const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT || '587', 10),
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

const sender = `"${process.env.EMAIL_SENDER_NAME || 'SafeLoans'}" <${process.env.SMTP_USER || 'no-reply@example.com'}>`;

function getAdminEmail() {
  return process.env.ADMIN_EMAIL || 'info@arabofwloan.org';
}

function isConfigured() {
  return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

async function sendStatusUpdate(loan, newStatus) {
  if (!isConfigured()) {
    console.warn('[email] SMTP not configured. Skipping status email.');
    return;
  }

  const statusLabels = {
    pending: 'Pending Review',
    approved: 'Approved',
    collected: 'Collected',
    rejected: 'Rejected',
  };

  const subject = `Your loan application is now ${statusLabels[newStatus]}`;
  const body = `
Hi ${loan.full_name},

Your loan application (Reference: ${loan.reference_number}) has been updated.

New status: ${statusLabels[newStatus]}
Loan amount: ${Number(loan.amount).toLocaleString('en-US', { style: 'currency', currency: 'USD' })}

You can track the status on our public waitlist at any time.

Best regards,
${process.env.APP_NAME || 'SafeLoans'} Team
  `.trim();

  try {
    await transporter.sendMail({
      from: sender,
      to: loan.email,
      subject,
      text: body,
    });
    console.log(`[email] Status update sent to ${loan.email}`);
  } catch (err) {
    console.error('[email] Failed to send status update:', err);
  }
}

async function sendAdminNewVisit({ path, ip, userAgent, referer }) {
  if (!isConfigured()) return;
  const adminEmail = getAdminEmail();

  const appUrl = process.env.APP_URL || 'http://localhost:3000';
  const subject = `New visitor on website`;
  const body = `
A new visitor opened the website.

Path      : ${path || '/'}
IP        : ${ip || '(unknown)'}
User-Agent: ${userAgent || '(unknown)'}
Referer   : ${referer || '(none)'}

Open site: ${appUrl}${path || '/'}

— ${process.env.APP_NAME || 'Arab OFW Loans & Partners'} System
  `.trim();

  try {
    await transporter.sendMail({ from: sender, to: adminEmail, subject, text: body });
    console.log('[email] Admin alerted about new visitor');
  } catch (err) {
    console.error('[email] Failed to send admin new-visit alert:', err);
  }
}

async function sendApplicationConfirmation(loan) {
  if (!isConfigured()) {
    console.warn('[email] SMTP not configured. Skipping confirmation email.');
    return;
  }

  const subject = `Loan application received - ${loan.reference_number}`;
  const body = `
Hi ${loan.full_name},

Thank you for applying for a loan with ${process.env.APP_NAME || 'SafeLoans'}.

Your application reference number is: ${loan.reference_number}
Loan amount: ${Number(loan.amount).toLocaleString('en-US', { style: 'currency', currency: 'USD' })}

You can track the status of your application on our public waitlist.

Best regards,
${process.env.APP_NAME || 'SafeLoans'} Team
  `.trim();

  try {
    await transporter.sendMail({
      from: sender,
      to: loan.email,
      subject,
      text: body,
    });
    console.log(`[email] Confirmation sent to ${loan.email}`);
  } catch (err) {
    console.error('[email] Failed to send confirmation:', err);
  }
}

async function sendAdminNewApplication(loan) {
  if (!isConfigured()) return;
  const adminEmail = getAdminEmail();

  const appUrl = process.env.APP_URL || 'http://localhost:3000';
  const subject = `New loan application — ${loan.reference_number}`;
  const body = `
A new loan application has been submitted.

Applicant : ${loan.full_name}
Email     : ${loan.email}
Phone     : ${loan.phone}
Amount    : ${Number(loan.amount).toLocaleString()} ${loan.currency || ''}
Country   : ${loan.country || '—'}
Reference : ${loan.reference_number}

View in admin: ${appUrl}/admin/loans/${loan.id}

— ${process.env.APP_NAME || 'Arab OFW Loans & Partners'} System
  `.trim();

  try {
    await transporter.sendMail({ from: sender, to: adminEmail, subject, text: body });
    console.log(`[email] Admin alerted about new application ${loan.reference_number}`);
  } catch (err) {
    console.error('[email] Failed to send admin new-application alert:', err);
  }
}

async function sendAdminNewChat(sessionId, firstMessage, userName, userEmail) {
  if (!isConfigured()) return;
  const adminEmail = getAdminEmail();

  const appUrl = process.env.APP_URL || 'http://localhost:3000';
  const subject = `New chat session started`;
  const body = `
A visitor has started a new chat conversation.

Name    : ${userName || '(not given)'}
Email   : ${userEmail || '(not given)'}
Message : ${firstMessage}

View chat logs: ${appUrl}/admin/chat-logs

— ${process.env.APP_NAME || 'Arab OFW Loans & Partners'} System
  `.trim();

  try {
    await transporter.sendMail({ from: sender, to: adminEmail, subject, text: body });
    console.log(`[email] Admin alerted about new chat session ${sessionId}`);
  } catch (err) {
    console.error('[email] Failed to send admin new-chat alert:', err);
  }
}

module.exports = {
  isConfigured,
  sendStatusUpdate,
  sendApplicationConfirmation,
  sendAdminNewApplication,
  sendAdminNewChat,
  sendAdminNewVisit,
};
