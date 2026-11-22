const encoder = new TextEncoder();

function bytesToBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function base64UrlToBytes(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid base64url value');
  const padded = value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - value.length % 4) % 4);
  return Uint8Array.from(atob(padded), character => character.charCodeAt(0));
}

export function canonicalReceipt(receipt) {
  return JSON.stringify({
    hash: receipt.hash,
    key_id: receipt.key_id,
    mjd: receipt.mjd,
    unix_ms: receipt.unix_ms,
    utc: receipt.utc,
  });
}

export function parseKeyring(env) {
  let parsed;
  try {
    parsed = JSON.parse(env.RECEIPT_KEYRING || '[]');
  } catch {
    throw new Error('Receipt keyring is malformed');
  }
  if (!Array.isArray(parsed)) throw new Error('Receipt keyring must be an array');
  return parsed;
}

function dateMs(value) {
  const result = Date.parse(value);
  return Number.isFinite(result) ? result : null;
}

function activeSigningKey(env, now) {
  const keys = parseKeyring(env);
  const preferred = env.RECEIPT_KEY_ID;
  return keys.find(key => (!preferred || key.key_id === preferred)
    && key.revoked !== true
    && dateMs(key.valid_from) !== null
    && dateMs(key.valid_to) !== null
    && now >= dateMs(key.valid_from)
    && now < dateMs(key.valid_to));
}

export async function createSignedReceipt(hash, env, now = Date.now()) {
  if (!/^[0-9a-f]{64}$/.test(hash)) throw new Error('sha256 must be exactly 64 hexadecimal characters');
  const key = activeSigningKey(env, now);
  if (!key || !env.RECEIPT_PRIVATE_KEY_PKCS8) throw new Error('Receipt signing is not configured');
  const receipt = {
    hash,
    utc: new Date(now).toISOString(),
    mjd: Number((now / 86_400_000 + 40_587).toFixed(8)),
    unix_ms: now,
    key_id: key.key_id,
  };
  const privateKey = await crypto.subtle.importKey(
    'pkcs8',
    base64UrlToBytes(env.RECEIPT_PRIVATE_KEY_PKCS8),
    { name: 'Ed25519' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('Ed25519', privateKey, encoder.encode(canonicalReceipt(receipt)));
  return { ...receipt, sig: bytesToBase64Url(new Uint8Array(signature)) };
}

export async function verifyReceipt(receipt, env) {
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) return { valid: false, error: 'invalid_receipt' };
  const fields = Object.keys(receipt).sort();
  if (fields.join(',') !== 'hash,key_id,mjd,sig,unix_ms,utc') return { valid: false, error: 'invalid_receipt' };
  if (!/^[0-9a-f]{64}$/.test(receipt.hash)
    || typeof receipt.key_id !== 'string'
    || typeof receipt.sig !== 'string'
    || !Number.isSafeInteger(receipt.unix_ms)
    || typeof receipt.mjd !== 'number'
    || receipt.utc !== new Date(receipt.unix_ms).toISOString()
    || receipt.mjd !== Number((receipt.unix_ms / 86_400_000 + 40_587).toFixed(8))) {
    return { valid: false, error: 'invalid_receipt' };
  }
  const key = parseKeyring(env).find(candidate => candidate.key_id === receipt.key_id);
  if (!key) return { valid: false, error: 'unknown_key' };
  if (key.revoked === true) return { valid: false, error: 'revoked_key' };
  const signedAt = receipt.unix_ms;
  const validFrom = dateMs(key.valid_from);
  const validTo = dateMs(key.valid_to);
  if (validFrom === null || validTo === null || signedAt < validFrom || signedAt >= validTo) {
    return { valid: false, error: 'key_outside_validity' };
  }
  try {
    const publicKey = await crypto.subtle.importKey('raw', base64UrlToBytes(key.public_key), { name: 'Ed25519' }, false, ['verify']);
    const valid = await crypto.subtle.verify('Ed25519', publicKey, base64UrlToBytes(receipt.sig), encoder.encode(canonicalReceipt(receipt)));
    return valid ? { valid: true } : { valid: false, error: 'bad_signature' };
  } catch {
    return { valid: false, error: 'bad_signature' };
  }
}

export function publicKeys(env) {
  return parseKeyring(env).map(({ key_id, public_key, valid_from, valid_to, revoked = false }) => ({
    key_id, public_key, valid_from, valid_to, revoked: Boolean(revoked),
  }));
}

export async function storeReceiptHash(db, receipt, retentionDays = 90) {
  if (!db) return;
  const days = Number.isInteger(Number(retentionDays)) && Number(retentionDays) > 0 ? Number(retentionDays) : 90;
  await db.prepare(`INSERT INTO receipt_hashes (hash, key_id, issued_at, purge_after)
    VALUES (?1, ?2, ?3, ?4)`).bind(receipt.hash, receipt.key_id, Math.floor(receipt.unix_ms / 1000), Math.floor(receipt.unix_ms / 1000) + days * 86_400).run();
}

export async function purgeExpiredReceiptHashes(db, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (!db) return 0;
  const result = await db.prepare('DELETE FROM receipt_hashes WHERE purge_after <= ?1').bind(nowSeconds).run();
  return Number(result?.meta?.changes || 0);
}
