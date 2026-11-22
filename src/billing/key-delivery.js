const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toBase64(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value) {
  return Uint8Array.from(atob(value), character => character.charCodeAt(0));
}

async function encryptionKey(secret) {
  if (!secret || secret.length < 32) throw new Error('Key delivery encryption is not configured');
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(secret));
  return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export function generateApiKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return `sg_${[...bytes].map(value => value.toString(16).padStart(2, '0')).join('')}`;
}

export async function encryptApiKey(rawKey, secret) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await encryptionKey(secret), encoder.encode(rawKey));
  return { encryptedKey: toBase64(new Uint8Array(encrypted)), iv: toBase64(iv) };
}

export async function decryptApiKey(encryptedKey, iv, secret) {
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(iv) },
    await encryptionKey(secret),
    fromBase64(encryptedKey),
  );
  return decoder.decode(plaintext);
}
