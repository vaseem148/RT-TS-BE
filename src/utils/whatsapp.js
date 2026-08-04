import { env } from '../config/env.js';

/** Normalises an Indian mobile number to WhatsApp's E.164-without-plus format. */
function normalisePhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 12 && digits.startsWith('91')) return digits;
  if (digits.length === 11 && digits.startsWith('0')) return `91${digits.slice(1)}`;
  return digits;
}

/**
 * Sends a WhatsApp text message via the Meta Cloud API.
 * Falls back to logging when WHATSAPP_TOKEN is not configured, and never
 * throws — a failed notification must not fail the caller's request.
 */
export async function sendWhatsApp({ to, message }) {
  const phone = normalisePhone(to);
  if (!phone) return { delivered: false, mode: 'skipped', reason: 'no phone number' };

  if (!env.whatsapp.token || !env.whatsapp.phoneNumberId) {
    console.log(`\n💬 [whatsapp:console-mode] → +${phone}\n   ${message}\n`);
    return { delivered: false, mode: 'console' };
  }

  const url = `https://graph.facebook.com/${env.whatsapp.apiVersion}/${env.whatsapp.phoneNumberId}/messages`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.whatsapp.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: phone,
        type: 'text',
        text: { preview_url: false, body: message },
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      console.error(`💬 WhatsApp to +${phone} failed (${res.status}):`, body.slice(0, 300));
      return { delivered: false, mode: 'error' };
    }
    return { delivered: true, mode: 'cloud-api' };
  } catch (error) {
    console.error(`💬 WhatsApp to +${phone} failed:`, error.message);
    return { delivered: false, mode: 'error', error: error.message };
  }
}
