# Lockform Relay

Your own integrations backend for [Lockform](https://lockform.io). Lockform is
zero-knowledge: its servers never hold your decryption key, so they can never
read your submissions. That is also why Lockform can't push your data straight
into Slack, a spreadsheet, or your CRM — it doesn't have the plaintext.

The relay closes that gap **without giving Lockform your key**. You deploy this
small service to your own hosting (Railway in one click). It:

1. Receives the encrypted submission from Lockform (verified by a shared secret).
2. Decrypts it with **your** private key, which lives only in this service's
   environment — never in Lockform.
3. Fans it out to the integrations you configure.

Lockform never sees your key, and never sees your integration credentials.

## Integrations

| Connector | What it does |
|-----------|--------------|
| **Forward (Webhook)** | POSTs the decrypted submission as JSON to any URL — Zapier, Make, n8n, or your own endpoint. This is the escape hatch for connecting anything. |
| **Slack** | Posts a message to a channel via an incoming webhook. |
| **Discord** | Posts a message to a channel via a webhook. |
| **Email** | Emails each submission via Resend or your own SMTP server. |

You configure these from inside Lockform — you never edit code or environment
variables to add an integration. The relay stores that config itself (encrypted
at rest); Lockform only ever sends it, never reads it back.

## Deploy to Railway (recommended)

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/new/template)

1. Click **Deploy on Railway** and let it create the project from this repo.
2. **Add a Volume** to the service and set its mount path to `/data` (Railway →
   your service → *Variables/Settings* → *Volumes*). This is where your config is
   stored so it survives redeploys.
3. Set the environment variables below.
4. Once deployed, copy the service's public URL. In Lockform, go to a form →
   **Integrations** → **Connect a relay**, paste the URL, the webhook secret, and
   the admin password. Lockform will verify the connection and you're ready to
   turn on integrations.

## Environment variables

| Variable | Required | Notes |
|----------|----------|-------|
| `LOCKFORM_PRIVATE_KEYS` | ✅ | Your base64 private key(s), comma-separated. See below. |
| `WEBHOOK_SECRET` | ✅ | Random string. Paste the **same** value into Lockform. Used to verify webhooks are genuine. |
| `ADMIN_PASSWORD` | ✅ | Protects the config API and encrypts your integration secrets at rest. Min 12 chars. |
| `ALLOWED_ORIGINS` | — | Browser origins allowed to configure the relay. Defaults to `https://app.lockform.io`. |
| `DB_PATH` | — | SQLite path. Set to `/data/relay.sqlite` when using a Railway Volume. Defaults to `./data/relay.sqlite`. |
| `PORT` | — | Railway sets this automatically. |

### Getting your private key

**Never put your 15-word passphrase in `LOCKFORM_PRIVATE_KEYS`.** Deriving it at
runtime is slow (600k PBKDF2 iterations) and will time out. Instead, derive the
base64 key once, locally:

```bash
npx lockform-derive-key
```

Paste your 15 words when prompted; it prints the base64 key. If you have rotated
keys, provide all of them comma-separated — the relay tries each until one
decrypts the submission.

## Security model

- **Your key never leaves this service.** It lives in `LOCKFORM_PRIVATE_KEYS` in
  your hosting environment. Lockform stores only your public key.
- **Lockform can't read your integration secrets.** They are write-only from
  Lockform's side: you set them, but the API never returns them. To confirm a
  value works without seeing it, use the **Test** button, which sends a sample
  event through the connector.
- **Secrets are encrypted at rest.** Every stored value is AES-256-GCM encrypted
  with a key derived from `ADMIN_PASSWORD` plus a per-install random salt, so a
  leaked database file alone is not a leak of your credentials.
  *Changing `ADMIN_PASSWORD` makes previously stored secrets unreadable — you'll
  need to re-enter them.*
- **Lockform can't redirect your data.** Because routing/destination config lives
  here (not in Lockform's backend), Lockform cannot point your forwarded plaintext
  at a different endpoint. Config writes require `ADMIN_PASSWORD`, which Lockform
  never stores.
- **Webhooks are authenticated.** Every incoming webhook must carry a valid
  HMAC-SHA256 signature over the shared `WEBHOOK_SECRET`; unsigned or invalid
  requests are rejected.

### A note on the `nodemailer` advisory

`npm audit` reports a high-severity advisory covering all published `nodemailer`
versions (no fix is available yet). The advisories are SMTP/header-injection
issues via options this relay never sets. As defense-in-depth, the email
connector strips CR/LF from all header-valued fields. If you don't use the SMTP
email connector, it has no effect on you.

## Endpoints

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| `POST` | `/webhook` | HMAC signature | Receives submissions from Lockform. This is the URL you give Lockform. |
| `GET` | `/health` | none | Connection check. |
| `POST` | `/admin/auth` | password | Exchanges `ADMIN_PASSWORD` for a short-lived session token. |
| `GET` | `/admin/schema` | token | Connector field definitions. |
| `GET` | `/admin/config[/:formId]` | token | Current config (structure only — no secret values). |
| `PUT` | `/admin/config/:formId/:connector` | token | Set fields / enable a connector. |
| `DELETE` | `/admin/config/:formId[/:connector]` | token | Remove a connector or all config for a form. |
| `POST` | `/admin/test/:formId/:connector` | token | Send a sample event through a connector. |

## Run locally

```bash
cp .env.example .env   # fill in the three required vars
npm install
npm run dev            # http://localhost:8080
```

```bash
npm test               # in-process smoke + end-to-end decryption tests
```

## How it fits together

```
        submission (encrypted)
Browser ──────────────────────▶ Lockform  ──(encrypted webhook, HMAC-signed)──▶  Lockform Relay (you host)
                                    │                                                   │  decrypts with YOUR key
                                    │ stores only ciphertext                            │  fans out
                                    ▼                                                   ▼
                                (never has your key)                    Slack · Discord · Email · any URL
```
