import type { Connector } from './types.js';

const TIMEOUT_MS = 10_000;

export const n8n: Connector = async (values, submission) => {
  const url = values.webhook_url;
  if (!url) throw new Error('n8n: missing webhook_url');

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      formId: submission.formId,
      submissionId: submission.submissionId,
      submittedAt: submission.submittedAt,
      eventType: submission.eventType,
      data: submission.data,
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!res.ok) {
    throw new Error(`n8n: webhook returned ${res.status}`);
  }
};
