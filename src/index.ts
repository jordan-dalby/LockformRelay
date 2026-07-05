import { serve } from '@hono/node-server';
import { loadEnv } from './env.js';
import { Store } from './store.js';
import { AdminAuth } from './auth.js';
import { createApp } from './app.js';

const env = loadEnv();
const store = new Store(env.dbPath, env.adminPassword);

if (store.passwordChanged) {
  console.warn(
    '[lockform-relay] WARNING: ADMIN_PASSWORD has changed since integration secrets ' +
      'were saved. Those secrets can no longer be decrypted and must be re-entered ' +
      'through the Lockform integrations UI.'
  );
}

const auth = new AdminAuth(env.adminPassword);
const app = createApp({ env, store, auth });

serve({ fetch: app.fetch, port: env.port, hostname: '0.0.0.0' }, (info) => {
  console.log(
    `[lockform-relay] listening on :${info.port} ` +
      `(keys: ${env.privateKeys.length}, origins: ${env.allowedOrigins.join(', ')})`
  );
});
