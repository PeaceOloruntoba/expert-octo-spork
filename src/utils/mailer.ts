import nodemailer from 'nodemailer';
import { env, isProduction } from '../config/env';

const transporter = nodemailer.createTransport({
  host: env.smtpHost,
  port: env.smtpPort,
  secure: env.smtpSecure,
  auth: env.smtpUser ? { user: env.smtpUser, pass: env.smtpPass } : undefined,
});

interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export async function sendEmail({ to, subject, html, text }: SendEmailInput): Promise<void> {
  if (!env.smtpHost) {
    // No SMTP configured (e.g. local dev without credentials yet) — log instead of throwing,
    // so auth flows remain testable without a mail provider.
    // eslint-disable-next-line no-console
    console.log(`[mailer] SMTP not configured. Would have sent to ${to}: ${subject}`);
    return;
  }

  try {
    await transporter.sendMail({
      from: env.smtpFrom,
      to,
      subject,
      html,
      text: text ?? html.replace(/<[^>]+>/g, ''),
    });
  } catch (err) {
    if (isProduction) throw err;
    // eslint-disable-next-line no-console
    console.error('[mailer] Failed to send email (non-production, continuing):', err);
  }
}

export function verificationEmailTemplate(link: string): string {
  return `<p>Welcome to the Verified Fertility Donor Marketplace.</p>
<p>Please confirm your email address to continue:</p>
<p><a href="${link}">${link}</a></p>
<p>This link expires in 24 hours.</p>`;
}

export function passwordResetEmailTemplate(link: string): string {
  return `<p>We received a request to reset your password.</p>
<p><a href="${link}">${link}</a></p>
<p>If you didn't request this, you can safely ignore this email. This link expires in 1 hour.</p>`;
}
