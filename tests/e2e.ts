import { createServer } from 'node:http';
import { createHmac } from 'node:crypto';
import {
  deriveKeyPairFromMnemonic,
  generateMnemonic15Words,
  exportPrivateKeyBase64,
  exportPublicKeyBase64,
  encryptSubmission,
} from 'lockform';

// 1. A real Lockform keypair.
const mnemonic = generateMnemonic15Words();
const { privateKey, publicKey } = deriveKeyPairFromMnemonic(mnemonic);
const privateKeyB64 = exportPrivateKeyBase64(privateKey);
const publicKeyB64 = exportPublicKeyBase64(publicKey);

process.env.LOCKFORM_PRIVATE_KEYS = privateKeyB64;
process.env.WEBHOOK_SECRET = 'e2e-webhook-secret';
process.env.ADMIN_PASSWORD = 'super-secret-password';
process.env.DB_PATH = ':memory:';

const { loadEnv } = await import('../src/env.js');
const { Store } = await import('../src/store.js');
const { AdminAuth } = await import('../src/auth.js');
const { createApp } = await import('../src/app.js');

const env = loadEnv();
const store = new Store(env.dbPath, env.adminPassword);
const auth = new AdminAuth(env.adminPassword);
const app = createApp({ env, store, auth });

let failures = 0;
const check = (name: string, cond: boolean, extra?: unknown) => {
  console.log(cond ? `  ok   ${name}` : `  FAIL ${name} ${JSON.stringify(extra ?? '')}`);
  if (!cond) failures++;
};

// 2. Capture server standing in for the user's Slack incoming webhook.
let captured: any = null;
const capture = createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    captured = JSON.parse(body);
    res.writeHead(200).end('ok');
  });
});
await new Promise<void>((r) => capture.listen(0, r));
const capturePort = (capture.address() as any).port;
const captureUrl = `http://127.0.0.1:${capturePort}/hook`;

// 3. Configure the slack connector to post to our capture server.
store.setConnector('form-e2e', 'slack', { webhook_url: captureUrl }, true);

// 4. Encrypt a submission exactly as Lockform's client does.
const formId = 'form-e2e';
const timestamp = Date.now();
const rawData = { 'field-1': 'Alice', 'field-2': 'alice@example.com' };
const enc = await encryptSubmission(rawData, publicKeyB64, { formId, timestamp });

// 5. Build the webhook payload the edge function sends (note: auth_tag empty; the
//    GCM tag rides on ciphertext).
const payload = {
  event_type: 'insert',
  submission_id: 'sub-1',
  form_id: formId,
  ciphertext: enc.ciphertext,
  iv: enc.iv,
  salt: enc.salt,
  ephemeral_public_key: enc.ephemeralPublicKey,
  auth_tag: '',
  algorithm: enc.algorithm,
  nonce: enc.nonce,
  encryption_timestamp: enc.timestamp,
  timestamp: new Date(timestamp).toISOString(),
  field_mapping: { 'field-1': 'name', 'field-2': 'email' },
};
const rawBody = JSON.stringify(payload);
const signature = createHmac('sha256', env.webhookSecret).update(rawBody).digest('hex');

// 6. Bad signature rejected.
{
  const r = await app.fetch(
    new Request('http://relay.test/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Signature-SHA256': 'deadbeef' },
      body: rawBody,
    })
  );
  check('bad signature -> 401', r.status === 401);
}

// 7. Valid signature -> decrypt -> slack.
{
  const r = await app.fetch(
    new Request('http://relay.test/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Signature-SHA256': signature },
      body: rawBody,
    })
  );
  const b = await r.json();
  const text = typeof captured?.text === 'string' ? captured.text : '';
  check('valid webhook -> 200 processed 1', r.status === 200 && b.processed === 1, b);
  check('slack received decrypted name', text.includes('Alice'), text);
  check('slack received decrypted email', text.includes('alice@example.com'), text);
  check('form_id propagated', text.includes(formId), text);
}

capture.close();
console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
