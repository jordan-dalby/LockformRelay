import type { Connector } from './types.js';

const TIMEOUT_MS = 10_000;

export const forward: Connector = async (values, submission) => {
  const url = values.url;
  if (!url) throw new Error('forward: missing url');

  const body = JSON.stringify({
    event_type: submission.eventType,
    submission_id: submission.submissionId,
    form_id: submission.formId,
    submitted_at: submission.submittedAt,
    data: submission.data,
    raw: submission.raw,
  });

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'Lockform-Relay/0.1',
    },
    body,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!res.ok) {
    throw new Error(`forward: destination returned ${res.status}`);
  }
};
