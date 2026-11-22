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

export async function createCheckoutSession(env, accountId, fetcher = fetch) {
  if (!String(env.STRIPE_SECRET_KEY || '').startsWith('sk_test_')) throw new Error('Stripe test-mode key is required');
  if (!/^price_[A-Za-z0-9_]+$/.test(String(env.STRIPE_PRO_PRICE_ID || ''))) throw new Error('Stripe price is not configured');
  const origin = String(env.PUBLIC_ORIGIN || '').replace(/\/$/, '');
  if (!origin.startsWith('https://') && !origin.startsWith('http://localhost')) throw new Error('Public origin is not configured');
  const body = new URLSearchParams({
    mode: 'subscription',
    'line_items[0][price]': env.STRIPE_PRO_PRICE_ID,
    'line_items[0][quantity]': '1',
    success_url: `${origin}/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/#pricing`,
    'metadata[spydergoat_sku]': 'subscription',
    'metadata[spydergoat_account_id]': accountId,
  });
  const response = await fetcher('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  const session = await response.json();
  if (!response.ok || !session?.url || !session?.id) throw new Error('Stripe checkout creation failed');
  return session;
}

function stripeTestKey(env) {
  if (!String(env.STRIPE_SECRET_KEY || '').startsWith('sk_test_')) throw new Error('Stripe test-mode key is required');
  return env.STRIPE_SECRET_KEY;
}

async function stripeGet(env, path, params, fetcher = fetch) {
  const url = new URL(`https://api.stripe.com/v1${path}`);
  for (const [name, value] of params) url.searchParams.append(name, value);
  const response = await fetcher(url.toString(), {
    headers: { Authorization: `Bearer ${stripeTestKey(env)}` },
  });
  const value = await response.json();
  if (!response.ok) throw new Error('Stripe API request failed');
  return value;
}

export async function retrieveCheckoutSession(env, sessionId, fetcher = fetch) {
  if (!/^cs_[A-Za-z0-9_]+$/.test(String(sessionId || ''))) throw new Error('Invalid Checkout Session ID');
  return stripeGet(env, `/checkout/sessions/${encodeURIComponent(sessionId)}`, [['expand[]', 'line_items']], fetcher);
}

export async function listCompletedCheckoutSessions(env, createdGte, fetcher = fetch) {
  const sessions = [];
  let startingAfter;
  for (let page = 0; page < 10; page++) {
    const params = [
      ['status', 'complete'], ['limit', '100'], ['created[gte]', String(createdGte)], ['expand[]', 'data.line_items'],
    ];
    if (startingAfter) params.push(['starting_after', startingAfter]);
    const result = await stripeGet(env, '/checkout/sessions', params, fetcher);
    if (!Array.isArray(result?.data)) throw new Error('Stripe Checkout list was malformed');
    sessions.push(...result.data);
    if (!result.has_more) return sessions;
    startingAfter = result.data.at(-1)?.id;
    if (!startingAfter) throw new Error('Stripe Checkout pagination was malformed');
  }
  throw new Error('Stripe Checkout reconciliation exceeded the page limit');
}
