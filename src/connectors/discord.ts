import type { Connector } from './types.js';
import { renderText, truncate } from './render.js';

const TIMEOUT_MS = 10_000;
const DISCORD_MAX = 2000;

export const discord: Connector = async (values, submission) => {
  const url = values.webhook_url;
  if (!url) throw new Error('discord: missing webhook_url');

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: truncate(renderText(submission), DISCORD_MAX) }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!res.ok) {
    throw new Error(`discord: webhook returned ${res.status}`);
  }
};
