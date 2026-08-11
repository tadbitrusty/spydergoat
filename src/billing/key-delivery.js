const encoder = new TextEncoder();
const decoder = new TextDecoder();
const IV_BYTES = 12;

function requireSecret(secret) {
  if (!(secret instanceof Uint8Array) || secret.byteLength !== 32) {
    throw new Error('API key delivery secret must be exactly 32 bytes');
  }
  return secret;
}

function requireBinding(accountId, checkoutSessionId, expiresAt) {
  if (!accountId || !checkoutSessionId) throw new Error('API key delivery binding is required');
  return encoder.encode(JSON.stringify(['spydergoat-key-delivery-v1', accountId, checkoutSessionId, expiresAt]));
}

async function importSecret(secret, usage) {
  return crypto.subtle.importKey('raw', requireSecret(secret), { name: 'AES-GCM' }, false, [usage]);
}

export async function encryptApiKeyDelivery(rawKey, options) {
  const { secret, accountId, checkoutSessionId, expiresAt } = options || {};
  if (!Number.isInteger(expiresAt) || expiresAt <= 0) throw new Error('API key delivery expiry is required');
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const encrypted = await crypto.subtle.encrypt({
    name: 'AES-GCM',
    iv,
    additionalData: requireBinding(accountId, checkoutSessionId, expiresAt),
  }, await importSecret(secret, 'encrypt'), encoder.encode(rawKey));
  return { encryptedKey: new Uint8Array(encrypted), iv, expiresAt };
}

export async function decryptApiKeyDelivery(envelope, options) {
  const { secret, accountId, checkoutSessionId, now } = options || {};
  if (!envelope || !Number.isInteger(envelope.expiresAt)) throw new Error('API key delivery is invalid');
  if (!Number.isInteger(now) || now >= envelope.expiresAt) throw new Error('API key delivery expired');
  const decrypted = await crypto.subtle.decrypt({
    name: 'AES-GCM',
    iv: envelope.iv,
    additionalData: requireBinding(accountId, checkoutSessionId, envelope.expiresAt),
  }, await importSecret(secret, 'decrypt'), envelope.encryptedKey);
  return decoder.decode(decrypted);
}

export async function claimAndDecryptApiKey(repository, options) {
  const { accountId, checkoutSessionId, now } = options || {};
  const envelope = await repository.claimKeyDeliveryOnce(checkoutSessionId, accountId, now);
  if (!envelope) return null;
  return decryptApiKeyDelivery(envelope, options);
}
