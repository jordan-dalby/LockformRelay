export interface RelayEnv {
  privateKeys: string[];
  webhookSecret: string;
  adminPassword: string;
  allowedOrigins: string[];
  dbPath: string;
  port: number;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    console.error(
      `\n[lockform-relay] Missing required environment variable: ${name}\n` +
        `See .env.example for what each variable does.\n`
    );
    process.exit(1);
  }
  return value.trim();
}

function parseList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function loadEnv(): RelayEnv {
  const privateKeys = parseList(required('LOCKFORM_PRIVATE_KEYS'));
  if (privateKeys.length === 0) {
    console.error('[lockform-relay] LOCKFORM_PRIVATE_KEYS contained no keys.');
    process.exit(1);
  }
  for (const key of privateKeys) {
    if (key.includes(' ')) {
      console.error(
        '[lockform-relay] LOCKFORM_PRIVATE_KEYS looks like a passphrase (contains spaces). ' +
          'Paste the base64 key from `npx lockform-derive-key`, not the 15 words.'
      );
      process.exit(1);
    }
  }

  const adminPassword = required('ADMIN_PASSWORD');
  if (adminPassword.length < 12) {
    console.error('[lockform-relay] ADMIN_PASSWORD must be at least 12 characters.');
    process.exit(1);
  }

  const allowedOrigins = parseList(process.env.ALLOWED_ORIGINS);

  return {
    privateKeys,
    webhookSecret: required('WEBHOOK_SECRET'),
    adminPassword,
    allowedOrigins:
      allowedOrigins.length > 0 ? allowedOrigins : ['https://app.lockform.io'],
    dbPath: process.env.DB_PATH?.trim() || './data/relay.sqlite',
    port: Number(process.env.PORT) || 8080,
  };
}
