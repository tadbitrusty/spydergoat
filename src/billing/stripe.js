const encoder = new TextEncoder();

function parseSignature(header) {
  const values = new Map();
  for (const item of String(header || '').split(',')) {
    const split = item.indexOf('=');
    if (split < 1) continue;
    const key = item.slice(0, split).trim();
    const value = item.slice(split + 1).trim();
    const current = values.get(key) || [];
    current.push(value);
    values.set(key, current);
  }
  return values;
}

function hexToBytes(hex) {
  if (!/^[0-9a-f]{64}$/i.test(hex)) return null;
  return Uint8Array.from(hex.match(/../g), pair => Number.parseInt(pair, 16));
}

function constantTimeEqual(left, right) {
  if (!left || !right || left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index++) difference |= left[index] ^ right[index];
  return difference === 0;
}

export async function verifyStripeSignature(payload, header, secret, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (!secret) return { valid: false, error: 'Webhook verification is not configured' };
  const parts = parseSignature(header);
  const timestampText = parts.get('t')?.[0];
  const timestamp = Number(timestampText);
  const signatures = parts.get('v1') || [];
  if (!Number.isSafeInteger(timestamp) || signatures.length === 0) return { valid: false, error: 'Malformed signature' };
  if (Math.abs(nowSeconds - timestamp) > 300) return { valid: false, error: 'Timestamp outside tolerance' };

  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const expected = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(`${timestamp}.${payload}`)));
  const valid = signatures.some(value => constantTimeEqual(expected, hexToBytes(value)));
  return valid ? { valid: true, timestamp } : { valid: false, error: 'Signature mismatch' };
}
