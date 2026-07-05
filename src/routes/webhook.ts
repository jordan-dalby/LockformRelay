import type { Context } from 'hono';
import { verifyWebhookSignature } from 'lockform';
import type { WebhookPayload } from 'lockform';
import type { Deps } from '../app.js';
import { tryDecrypt } from '../decrypt.js';
import { dispatch, type DispatchSubmission } from '../connectors/index.js';
import { missingRequiredFields } from '../connectors/schema.js';

export function webhookHandler(deps: Deps) {
  return async (c: Context) => {
    const raw = await c.req.text();
    const signature = c.req.header('x-signature-sha256');

    if (!signature) {
      return c.json({ error: 'Missing X-Signature-SHA256 header' }, 401);
    }
    const valid = await verifyWebhookSignature({
      payload: raw,
      signature,
      secret: deps.env.webhookSecret,
    });
    if (!valid) {
      return c.json({ error: 'Invalid signature' }, 401);
    }

    let payload: WebhookPayload;
    try {
      payload = JSON.parse(raw) as WebhookPayload;
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400);
    }

    const eventType = payload.event_type ?? 'insert';
    if (eventType !== 'insert') {
      return c.json({ skipped: true, reason: `event ${eventType} not processed` }, 200);
    }

    const formId = payload.form_id;
    if (!formId) {
      return c.json({ error: 'Missing form_id' }, 400);
    }

    const enabled = deps.store.enabledConnectors(formId);
    if (enabled.length === 0) {
      return c.json({ processed: 0, reason: 'no enabled connectors for form' }, 200);
    }

    let decrypted;
    try {
      decrypted = await tryDecrypt(payload, deps.env.privateKeys);
    } catch (err) {
      console.error(`[webhook] decryption failed for form ${formId}:`, err);
      return c.json({ error: 'decrypt_failed' }, 502);
    }

    const submission: DispatchSubmission = {
      formId,
      submissionId: payload.submission_id ?? null,
      submittedAt: payload.timestamp ?? null,
      eventType,
      data: decrypted.mappedData,
      raw: decrypted.rawData,
    };

    const results = [];
    for (const connector of enabled) {
      const values = deps.store.getValues(formId, connector);
      const present = new Set(Object.keys(values).filter((k) => values[k] !== ''));
      const missing = missingRequiredFields(connector, present, values);
      if (missing.length > 0) {
        results.push({ connector, ok: false, error: `incomplete: ${missing.join(', ')}` });
        continue;
      }
      results.push(await dispatch(connector, values, submission));
    }

    const failed = results.filter((r) => !r.ok);
    if (failed.length > 0) {
      console.error(
        `[webhook] form ${formId}: ${failed.length}/${results.length} connectors failed`,
        failed
      );
    }

    return c.json({ processed: results.filter((r) => r.ok).length, results }, 200);
  };
}
