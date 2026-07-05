process.env.LOCKFORM_PRIVATE_KEYS = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
process.env.WEBHOOK_SECRET = 'test-webhook-secret';
process.env.ADMIN_PASSWORD = 'super-secret-password';
process.env.DB_PATH = ':memory:';
process.env.ALLOWED_ORIGINS = 'https://app.lockform.io';

const { loadEnv } = await import('../src/env.js');
const { Store } = await import('../src/store.js');
const { AdminAuth } = await import('../src/auth.js');
const { createApp } = await import('../src/app.js');

const env = loadEnv();
const store = new Store(env.dbPath, env.adminPassword);
const auth = new AdminAuth(env.adminPassword);
const app = createApp({ env, store, auth });

let failures = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) {
    console.log(`  ok   ${name}`);
  } else {
    failures++;
    console.log(`  FAIL ${name}`, extra ?? '');
  }
}

const base = 'http://relay.test';
const req = (path: string, init?: RequestInit) => app.fetch(new Request(base + path, init));
const json = (token: string, body: unknown, method = 'PUT'): RequestInit => ({
  method,
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

// health
{
  const r = await req('/health');
  const b = await r.json();
  check('GET /health -> ok', r.status === 200 && b.status === 'ok', b);
}

// CORS: only configured origins allowed; everything else (incl. localhost) denied
{
  const conf = await app.fetch(new Request(base + '/health', { headers: { Origin: 'https://app.lockform.io' } }));
  check('CORS allows configured origin', conf.headers.get('access-control-allow-origin') === 'https://app.lockform.io');
  const local = await app.fetch(new Request(base + '/health', { headers: { Origin: 'http://localhost:5173' } }));
  check('CORS denies unconfigured localhost origin', !local.headers.get('access-control-allow-origin'), local.headers.get('access-control-allow-origin'));
  const evil = await app.fetch(new Request(base + '/health', { headers: { Origin: 'https://evil.example.com' } }));
  check('CORS denies random origin', !evil.headers.get('access-control-allow-origin'), evil.headers.get('access-control-allow-origin'));
}

// auth wrong
{
  const r = await req('/admin/auth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'wrong' }),
  });
  check('auth wrong password -> 401', r.status === 401);
}

// auth correct
let token = '';
{
  const r = await req('/admin/auth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'super-secret-password' }),
  });
  const b = await r.json();
  token = b.token;
  check('auth correct -> token', r.status === 200 && typeof b.token === 'string', b);
}

// unauthorized without token
{
  const r = await req('/admin/config');
  check('config without token -> 401', r.status === 401);
}

// schema
{
  const r = await req('/admin/schema', { headers: { Authorization: `Bearer ${token}` } });
  const b = await r.json();
  check('schema -> 4 connectors', r.status === 200 && b.connectors.length === 4, b);
}

// verify webhook secret
{
  const good = await req('/admin/verify-webhook-secret', json(token, { secret: 'test-webhook-secret' }, 'POST'));
  const bg = await good.json();
  check('verify correct webhook secret -> matches true', good.status === 200 && bg.matches === true, bg);
  const bad = await req('/admin/verify-webhook-secret', json(token, { secret: 'nope' }, 'POST'));
  const bb = await bad.json();
  check('verify wrong webhook secret -> matches false', bad.status === 200 && bb.matches === false, bb);
  const noauth = await req('/admin/verify-webhook-secret', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ secret: 'x' }) });
  check('verify without token -> 401', noauth.status === 401);
}

// two-step: save a secret field, then enable later with empty fields (server retains it)
{
  const r1 = await req('/admin/config/form2/slack', json(token, { fields: { webhook_url: 'https://hooks.slack.com/services/AAA' } }));
  check('save slack url (no enable) -> 200', r1.status === 200);
  const r2 = await req('/admin/config/form2', { headers: { Authorization: `Bearer ${token}` } });
  const b2 = await r2.json();
  check('slack url isSet after save', b2.connectors.slack?.fields?.webhook_url?.isSet === true, b2.connectors.slack);
  check('slack complete after save', b2.connectors.slack?.complete === true, b2.connectors.slack);
  const r3 = await req('/admin/config/form2/slack', json(token, { fields: {}, enabled: true }));
  const b3 = await r3.json();
  check('enable slack with empty fields (server retains url) -> 200 enabled', r3.status === 200 && b3.connector.enabled === true, b3);
}

// set slack (complete) + enable
{
  const r = await req(
    '/admin/config/form1/slack',
    json(token, { fields: { webhook_url: 'https://hooks.slack.com/services/XXX' }, enabled: true })
  );
  const b = await r.json();
  check('put slack enable -> 200 enabled+complete', r.status === 200 && b.connector.enabled && b.connector.complete, b);
}

// read back: secret value must NOT be present, but isSet must be true
{
  const r = await req('/admin/config/form1', { headers: { Authorization: `Bearer ${token}` } });
  const b = await r.json();
  const field = b.connectors.slack.fields.webhook_url;
  check('slack webhook_url isSet true', field.isSet === true, field);
  check('slack webhook_url value NOT returned (write-only)', !('value' in field), field);
}

// try enabling discord with no url -> 400 incomplete
{
  const r = await req('/admin/config/form1/discord', json(token, { enabled: true }));
  const b = await r.json();
  check('enable discord without url -> 400 incomplete', r.status === 400 && Array.isArray(b.missing), b);
}

// email: non-secret fields ARE returned, secret provider-conditional enforced
{
  await req('/admin/config/form1/email', json(token, { fields: { provider: 'resend', from: 'a@b.com', to: 'c@d.com' } }));
  const r0 = await req('/admin/config/form1/email', json(token, { enabled: true }));
  const b0 = await r0.json();
  check('enable email resend w/o api key -> 400', r0.status === 400, b0);

  await req('/admin/config/form1/email', json(token, { fields: { resend_api_key: 're_test' } }));
  const r1 = await req('/admin/config/form1/email', json(token, { enabled: true }));
  const b1 = await r1.json();
  check('enable email after api key -> 200', r1.status === 200 && b1.connector.enabled, b1);

  const r2 = await req('/admin/config/form1', { headers: { Authorization: `Bearer ${token}` } });
  const b2 = await r2.json();
  check('email non-secret from returned', b2.connectors.email.fields.from.value === 'a@b.com', b2.connectors.email.fields.from);
  check('email secret api_key value hidden', !('value' in b2.connectors.email.fields.resend_api_key), b2.connectors.email.fields.resend_api_key);
}

// enabledConnectors reflects state
{
  check('store.enabledConnectors form1 = [slack,email]', JSON.stringify(store.enabledConnectors('form1').sort()) === JSON.stringify(['email', 'slack']));
}

// delete connector
{
  const r = await req('/admin/config/form1/slack', { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
  check('delete slack -> ok', r.status === 200);
  check('slack no longer enabled', !store.isEnabled('form1', 'slack'));
}

// unknown field rejected
{
  const r = await req('/admin/config/form1/slack', json(token, { fields: { bogus: 'x' } }));
  check('unknown field -> 400', r.status === 400);
}

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
