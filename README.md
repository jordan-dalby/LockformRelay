# Lockform Relay

A small service you host yourself to forward [Lockform](https://app.lockform.io) submissions to various integrations.

Lockform is end-to-end encrypted, so it can't decrypt your submissions to send them anywhere. This relay does: it holds your private key, decrypts submissions, and forwards them to the integrations you configure. Your key and integration credentials never go to Lockform.

## Get your private key

Don't use your 15-word passphrase directly. Derive a base64 key once, locally:

```bash
npm install -g lockform
npx lockform-derive-key
```

Paste your 15 words when prompted; it prints the key. If you've rotated keys, keep all of them (comma-separated) for the next step.

## Deploy to Railway

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/deploy/lockform-relay)

1. Click **Deploy on Railway**.
2. Fill in the required variables:
   - `LOCKFORM_PRIVATE_KEYS` - your base64 key(s) from above, comma-separated.
   - `WEBHOOK_SECRET` - any random string.
   - `ADMIN_PASSWORD` - min 12 characters.
3. When it finishes, copy the service's public URL.
4. In Lockform, open a form → **Integrations** → **Connect a relay**, and paste the URL, the webhook secret, and the admin password.

Then add your integrations from inside Lockform - no code or config files to edit.

## Run locally

```bash
cp .env.example .env   # fill in the three required vars
npm install
npm run dev            # http://localhost:8080
npm test               # optional
```

## Environment variables

| Variable | Required | Notes |
|----------|----------|-------|
| `LOCKFORM_PRIVATE_KEYS` | ✅ | Your base64 private key(s), comma-separated. |
| `WEBHOOK_SECRET` | ✅ | Random string. Paste the same value into Lockform. |
| `ADMIN_PASSWORD` | ✅ | Protects the config API. Min 12 chars. |
| `ALLOWED_ORIGINS` | - | Origins allowed to configure the relay. Defaults to `https://app.lockform.io`. |
| `DB_PATH` | - | SQLite path. Use `/data/relay.sqlite` with a Railway Volume. Defaults to `./data/relay.sqlite`. |
| `PORT` | - | Railway sets this automatically. |

## Docker

```bash
docker run -p 8080:8080 \
  -e LOCKFORM_PRIVATE_KEYS=... -e WEBHOOK_SECRET=... -e ADMIN_PASSWORD=... \
  -e DB_PATH=/data/relay.sqlite -v lockform-relay-data:/data \
  ghcr.io/jordan-dalby/lockformrelay:latest
```

Images are published to `ghcr.io/jordan-dalby/lockformrelay` on every push to `main` and on release tags.
