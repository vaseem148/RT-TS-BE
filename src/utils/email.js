import nodemailer from 'nodemailer';
import { env } from '../config/env.js';

let transporter = null;

/**
 * Returns a nodemailer transport, or null when SMTP is not configured.
 * With no SMTP host the app runs in "console mode" so development never
 * depends on a mail server.
 */
function getTransporter() {
  if (!env.smtp.host) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.smtp.host,
      port: env.smtp.port,
      secure: env.smtp.secure,
      auth: env.smtp.user ? { user: env.smtp.user, pass: env.smtp.pass } : undefined,
    });
  }
  return transporter;
}

const BRAND = '#0ea5e9';

function wrapHtml({ title, intro, rows = [], ctaText, ctaUrl, outro }) {
  const rowsHtml = rows
    .filter((r) => r.value)
    .map(
      (r) => `
        <tr>
          <td style="padding:8px 0;color:#64748b;font-size:13px;width:150px;">${r.label}</td>
          <td style="padding:8px 0;color:#0f172a;font-size:14px;font-weight:600;">${r.value}</td>
        </tr>`
    )
    .join('');

  return `<!doctype html>
<html><body style="margin:0;padding:24px;background:#f1f5f9;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e2e8f0;">
    <tr><td style="background:linear-gradient(135deg,#0284c7,#0ea5e9);padding:24px;">
      <div style="color:#ffffff;font-size:20px;font-weight:800;letter-spacing:-0.4px;">Renderways Technology</div>
      <div style="color:#e0f2fe;font-size:12px;margin-top:4px;">Chennai's trusted IT &amp; security partner</div>
    </td></tr>
    <tr><td style="padding:28px 24px;">
      <h1 style="margin:0 0 12px;font-size:19px;color:#0f172a;">${title}</h1>
      <p style="margin:0 0 18px;font-size:14px;line-height:22px;color:#475569;">${intro}</p>
      ${rowsHtml ? `<table role="presentation" width="100%" style="border-top:1px solid #e2e8f0;border-bottom:1px solid #e2e8f0;margin:0 0 20px;">${rowsHtml}</table>` : ''}
      ${
        ctaUrl
          ? `<a href="${ctaUrl}" style="display:inline-block;background:${BRAND};color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:10px;font-size:14px;font-weight:600;">${ctaText}</a>`
          : ''
      }
      ${outro ? `<p style="margin:20px 0 0;font-size:13px;line-height:20px;color:#64748b;">${outro}</p>` : ''}
    </td></tr>
    <tr><td style="padding:18px 24px;background:#f8fafc;border-top:1px solid #e2e8f0;color:#94a3b8;font-size:12px;line-height:18px;">
      Renderways Technology · Maduravoyal, Chennai · Branch: Katpadi, Vellore<br/>
      ${env.company.phone} · ${env.company.email}
    </td></tr>
  </table>
</body></html>`;
}

/**
 * Sends an email. Never throws — notification failures must not break the
 * request that triggered them.
 */
export async function sendEmail({ to, subject, text, ...content }) {
  const html = wrapHtml(content);
  const tx = getTransporter();

  if (!tx) {
    console.log(`\n📧 [email:console-mode] → ${to}\n   Subject: ${subject}\n   ${text || content.intro}\n`);
    return { delivered: false, mode: 'console' };
  }

  try {
    await tx.sendMail({ from: env.smtp.from, to, subject, text: text || content.intro, html });
    return { delivered: true, mode: 'smtp' };
  } catch (error) {
    console.error(`📧 Email to ${to} failed:`, error.message);
    return { delivered: false, mode: 'error', error: error.message };
  }
}
