import type { DispatchSubmission } from './types.js';

function stringifyValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function renderLines(submission: DispatchSubmission): string[] {
  return Object.entries(submission.data).map(
    ([key, value]) => `${key}: ${stringifyValue(value)}`
  );
}

export function renderText(submission: DispatchSubmission): string {
  const header = `New submission on form ${submission.formId}`;
  const meta = submission.submittedAt ? `Submitted: ${submission.submittedAt}` : '';
  return [header, meta, '', ...renderLines(submission)].filter(Boolean).join('\n');
}

/** Discord caps message content at 2000 characters. */
export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}
