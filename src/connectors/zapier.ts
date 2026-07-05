import type { Connector } from './types.js';

const TIMEOUT_MS = 10_000;

export const zapier: Connector = async (values, submission) => {
  const url = values.hook_url;
  if (!url) throw new Error('zapier: missing hook_url');

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
    throw new Error(`zapier: hook returned ${res.status}`);
  }
};
