import type { Connector } from './types.js';
import { renderText } from './render.js';

const TIMEOUT_MS = 10_000;

export const slack: Connector = async (values, submission) => {
  const url = values.webhook_url;
  if (!url) throw new Error('slack: missing webhook_url');

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: renderText(submission) }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!res.ok) {
    throw new Error(`slack: webhook returned ${res.status}`);
  }
};
