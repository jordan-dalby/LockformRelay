import { decryptWebhookData } from 'lockform';
import type { WebhookPayload, DecryptedSubmission } from 'lockform';

/**
 * Decrypts a webhook payload by trying each configured private key until one
 * succeeds. Supports key rotation: an org may have more than one active key
 * across its forms, and the payload does not say which one was used.
 *
 * Decryption is AES-GCM authenticated, so a wrong key fails cleanly rather than
 * returning garbage. Note the `auth_tag` field on the payload is unused: the GCM
 * tag is appended to `ciphertext`, which the SDK handles.
 */
export async function tryDecrypt(
  payload: WebhookPayload,
  privateKeys: string[]
): Promise<DecryptedSubmission> {
  let lastError: unknown;
  for (const key of privateKeys) {
    try {
      return await decryptWebhookData({ payload, passphrase: key });
    } catch (err) {
      lastError = err;
    }
  }
  throw new Error(
    `Could not decrypt submission with any configured key (${privateKeys.length} tried).`,
    { cause: lastError }
  );
}
