import nodemailer from 'nodemailer';
import type { Connector } from './types.js';
import { renderText } from './render.js';

const TIMEOUT_MS = 15_000;

/** Strip CR/LF so header-valued fields can't be used for header injection. */
function headerSafe(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim();
}

export const email: Connector = async (values, submission) => {
  const provider = values.provider;
  const from = headerSafe(values.from ?? '');
  const to = headerSafe(values.to ?? '');
  if (!from || !to) throw new Error('email: missing from/to');

  const subject = headerSafe(`New submission on form ${submission.formId}`);
  const text = renderText(submission);

  if (provider === 'resend') {
    const apiKey = values.resend_api_key;
    if (!apiKey) throw new Error('email: missing resend_api_key');
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from, to, subject, text }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      throw new Error(`email: Resend returned ${res.status}`);
    }
    return;
  }

  if (provider === 'smtp') {
    const smtpUrl = values.smtp_url;
    if (!smtpUrl) throw new Error('email: missing smtp_url');
    const transport = nodemailer.createTransport(smtpUrl);
    try {
      await transport.sendMail({ from, to, subject, text });
    } finally {
      transport.close();
    }
    return;
  }

  throw new Error(`email: unknown provider "${provider}"`);
};
