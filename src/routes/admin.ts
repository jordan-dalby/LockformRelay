import { Hono } from 'hono';
import type { Deps } from '../app.js';
import { bearerToken } from '../auth.js';
import { constantTimeEquals } from '../secretbox.js';
import { dispatch, type DispatchSubmission } from '../connectors/index.js';
import {
  CONNECTORS,
  getConnector,
  isKnownConnector,
  isKnownField,
} from '../connectors/schema.js';

function clientIp(header: string | undefined): string {
  return header?.split(',')[0]?.trim() || 'unknown';
}

function validFormId(id: string): boolean {
  return id.length > 0 && id.length <= 128 && /^[A-Za-z0-9._:-]+$/.test(id);
}

export function adminRouter(deps: Deps): Hono {
  const app = new Hono();

  // Login: exchange the relay password for a short-lived session token.
  app.post('/auth', async (c) => {
    const ip = clientIp(c.req.header('x-forwarded-for'));
    const lockedFor = deps.auth.isLockedOut(ip);
    if (lockedFor > 0) {
      return c.json({ error: `Too many attempts. Try again in ${lockedFor}s.` }, 429);
    }

    let body: { password?: unknown };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400);
    }
    if (typeof body.password !== 'string') {
      return c.json({ error: 'Missing password' }, 400);
    }

    if (!deps.auth.checkPassword(ip, body.password)) {
      return c.json({ error: 'Incorrect password' }, 401);
    }
    return c.json({ token: deps.auth.issueToken() });
  });

  // Everything below requires a valid session token.
  app.use('*', async (c, next) => {
    if (c.req.path.endsWith('/auth')) return next();
    if (!deps.auth.verifyToken(bearerToken(c.req.header('authorization')))) {
      return c.json({ error: 'Unauthorized' }, 401);
    }
    return next();
  });

  // Lets the connect flow confirm the webhook secret matches this relay's, so a
  // mismatch is caught up front instead of silently dropping every submission.
  // Safe to expose: the caller already holds a valid admin session.
  app.post('/verify-webhook-secret', async (c) => {
    let body: { secret?: unknown };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400);
    }
    if (typeof body.secret !== 'string') {
      return c.json({ error: 'Missing secret' }, 400);
    }
    return c.json({ matches: constantTimeEquals(body.secret, deps.env.webhookSecret) });
  });

  // Connector field definitions so the UI renders the same fields the relay knows.
  app.get('/schema', (c) => c.json({ connectors: CONNECTORS }));

  app.get('/config', (c) => c.json({ forms: deps.store.getStructure() }));

  app.get('/config/:formId', (c) => {
    const formId = c.req.param('formId');
    if (!validFormId(formId)) return c.json({ error: 'Invalid form id' }, 400);
    return c.json({ connectors: deps.store.getStructure(formId)[formId] ?? {} });
  });

  // Write-only config. Secret field values are accepted but never returned.
  app.put('/config/:formId/:connector', async (c) => {
    const formId = c.req.param('formId');
    const connector = c.req.param('connector');
    if (!validFormId(formId)) return c.json({ error: 'Invalid form id' }, 400);
    if (!isKnownConnector(connector)) return c.json({ error: 'Unknown connector' }, 400);

    let body: { fields?: Record<string, unknown>; enabled?: unknown };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400);
    }

    const fields: Record<string, string | null> = {};
    if (body.fields && typeof body.fields === 'object') {
      const def = getConnector(connector)!;
      for (const [key, value] of Object.entries(body.fields)) {
        if (!isKnownField(connector, key)) {
          return c.json({ error: `Unknown field "${key}"` }, 400);
        }
        if (value === null || value === '') {
          fields[key] = null;
          continue;
        }
        if (typeof value !== 'string') {
          return c.json({ error: `Field "${key}" must be a string` }, 400);
        }
        const fieldDef = def.fields.find((f) => f.key === key)!;
        if (fieldDef.type === 'select' && !fieldDef.options?.includes(value)) {
          return c.json({ error: `Invalid value for "${key}"` }, 400);
        }
        fields[key] = value;
      }
    }

    // Apply field changes first, without touching enabled state.
    deps.store.setConnector(formId, connector, fields);

    // Only flip enabled after we can confirm completeness.
    if (body.enabled !== undefined) {
      const wantEnabled = body.enabled === true;
      if (wantEnabled) {
        const view = deps.store.getStructure(formId)[formId]?.[connector];
        if (!view?.complete) {
          return c.json(
            { error: 'Cannot enable: connector is incomplete', missing: view?.missing ?? [] },
            400
          );
        }
      }
      deps.store.setConnector(formId, connector, {}, wantEnabled);
    }

    return c.json({ connector: deps.store.getStructure(formId)[formId]?.[connector] ?? null });
  });

  app.delete('/config/:formId/:connector', (c) => {
    const formId = c.req.param('formId');
    const connector = c.req.param('connector');
    if (!validFormId(formId)) return c.json({ error: 'Invalid form id' }, 400);
    if (!isKnownConnector(connector)) return c.json({ error: 'Unknown connector' }, 400);
    deps.store.deleteConnector(formId, connector);
    return c.json({ ok: true });
  });

  app.delete('/config/:formId', (c) => {
    const formId = c.req.param('formId');
    if (!validFormId(formId)) return c.json({ error: 'Invalid form id' }, 400);
    deps.store.deleteForm(formId);
    return c.json({ ok: true });
  });

  // Send a sample event through a connector so the user can verify a secret they
  // can no longer read back.
  app.post('/test/:formId/:connector', async (c) => {
    const formId = c.req.param('formId');
    const connector = c.req.param('connector');
    if (!validFormId(formId)) return c.json({ error: 'Invalid form id' }, 400);
    if (!isKnownConnector(connector)) return c.json({ error: 'Unknown connector' }, 400);

    const view = deps.store.getStructure(formId)[formId]?.[connector];
    if (!view || Object.keys(view.fields).length === 0) {
      return c.json({ ok: false, error: 'Connector is not configured' }, 400);
    }
    if (!view.complete) {
      return c.json({ ok: false, error: `Incomplete: ${view.missing.join(', ')}` }, 400);
    }

    const sample: DispatchSubmission = {
      formId,
      submissionId: `test-${Date.now()}`,
      submittedAt: new Date().toISOString(),
      eventType: 'test',
      data: {
        'Example Field': 'Test value',
        Note: 'This is a test event from your Lockform relay.',
      },
      raw: { example: 'Test value' },
    };

    const values = deps.store.getValues(formId, connector);
    const result = await dispatch(connector, values, sample);
    return c.json(result, result.ok ? 200 : 502);
  });

  return app;
}
