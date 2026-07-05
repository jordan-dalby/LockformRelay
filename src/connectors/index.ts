import type { Connector, DispatchSubmission } from './types.js';
import { slack } from './slack.js';
import { discord } from './discord.js';
import { email } from './email.js';
import { zapier } from './zapier.js';
import { n8n } from './n8n.js';

export const REGISTRY: Record<string, Connector> = {
  slack,
  discord,
  email,
  zapier,
  n8n,
};

export interface DispatchResult {
  connector: string;
  ok: boolean;
  error?: string;
}

export async function dispatch(
  connector: string,
  values: Record<string, string>,
  submission: DispatchSubmission
): Promise<DispatchResult> {
  const fn = REGISTRY[connector];
  if (!fn) {
    return { connector, ok: false, error: `unknown connector "${connector}"` };
  }
  try {
    await fn(values, submission);
    return { connector, ok: true };
  } catch (err) {
    return {
      connector,
      ok: false,
      error: err instanceof Error ? err.message : 'dispatch failed',
    };
  }
}

export type { DispatchSubmission } from './types.js';
export { CONNECTORS } from './schema.js';
