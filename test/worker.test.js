import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/api/worker.js';
import { encryptApiKeyDelivery } from '../src/billing/key-delivery.js';

function env() {
  const values = new Map();
  return { SPYDERGOAT_KV: { async get(key) { return values.get(key) ?? null; }, async put(key, value) { values.set(key, value); } } };
}

async function request(path, init = {}, bindings = env()) {
  return worker.fetch(new Request(`https://spydergoat.test${path}`, init), bindings, {});
}

const encoder = new TextEncoder();
async function signedWebhook(body, secret, timestamp = Math.floor(Date.now() / 1000)) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(`${timestamp}.${body}`)));
  const signature = [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
  return `t=${timestamp},v1=${signature}`;
}

function webhookBindings(overrides = {}) {
  return {
    ...env(), PAID_ACCESS_ENABLED: 'true', DB: {}, STRIPE_WEBHOOK_SECRET: 'whsec_test', STRIPE_SECRET_KEY: 'stripe_test_key',
    API_KEY_DELIVERY_SECRET_BASE64: Buffer.alloc(32, 9).toString('base64'), STRIPE_LIVEMODE: 'false',
    STRIPE_PRO_PRICE_ID: 'price_pro', STRIPE_PRO_PRODUCT_ID: 'prod_pro', STRIPE_PRO_AMOUNT: '489', ...overrides,
  };
}

test('static website requests delegate to the Cloudflare assets binding', async () => {
  const seen = [];
  const bindings = {
    ...env(),
    ASSETS: {
      async fetch(assetRequest) {
        seen.push(assetRequest.url);
        if (assetRequest.headers.has('if-none-match')) {
          return new Response(null, { status: 304, headers: { ETag: '"stale-asset-tag"' } });
        }
        return new Response('<!doctype html><script type="application/json" id="spydergoat-bootstrap">__SPYDERGOAT_BOOTSTRAP__</script><main>React v1.1</main>', {
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'Content-Length': '999',
            ETag: '"stale-asset-tag"',
          },
        });
      },
    },
  };
  const response = await request('/', { headers: { 'If-None-Match': '"stale-asset-tag"' } }, bindings);
  assert.equal(response.status, 200);
  assert.deepEqual(seen, ['https://spydergoat.test/']);
  const html = await response.text();
  assert.match(html, /React v1\.1/);
  assert.doesNotMatch(html, /__SPYDERGOAT_BOOTSTRAP__/);
  assert.match(html, /"source":"server"/);
  const csp = response.headers.get('content-security-policy') || '';
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /script-src 'self'/);
  assert.match(csp, /style-src 'self'/);
  assert.doesNotMatch(csp, /unsafe-inline/);
  assert.equal(response.headers.get('content-length'), null);
  assert.equal(response.headers.get('etag'), null);
});

test('static shell fails closed when the server bootstrap marker is missing', async () => {
  const bindings = {
    ...env(),
    ASSETS: {
      async fetch() {
        return new Response('<!doctype html><main>Broken shell</main>', {
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        });
      },
    },
  };
  const response = await request('/', {}, bindings);
  assert.equal(response.status, 503);
  assert.match(await response.text(), /temporarily unavailable/i);
});

test('homepage offers one intentional API calibration and interpolates locally without polling', async () => {
  const html = await (await request('/')).text();
  assert.match(html, /fetch\('\/mjd'/);
  assert.match(html, /id="calibrate"/);
  assert.match(html, /addEventListener\('click'/);
  assert.match(html, /performance\.now/);
  assert.doesNotMatch(html, /setInterval\([^)]*fetch|setInterval\(tick,\s*100\)/);
  assert.match(html, /calibration unavailable/i);
});

test('client IP ignores spoofable forwarded header when Cloudflare identity is absent', async () => {
  const bindings = env();
  const first = await request('/mjd', { headers: { 'X-Forwarded-For': '1.1.1.1' } }, bindings);
  const second = await request('/mjd', { headers: { 'X-Forwarded-For': '2.2.2.2' } }, bindings);
  assert.equal(first.status, 200);
  assert.equal(second.status, 429);
});

test('homepage has canonical metadata and strict security headers', async () => {
  const response = await request('/');
  const html = await response.text();
  assert.match(html, /rel="canonical" href="https:\/\/spydergoat\.com\/"/);
  assert.match(html, /rel="icon" href="data:image\/svg\+xml/);
  assert.match(html, /application\/ld\+json/);
  assert.match(response.headers.get('content-security-policy') || '', /frame-ancestors 'none'/);
  assert.match(response.headers.get('content-security-policy') || '', /img-src[^;]*data:/);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(response.headers.get('access-control-allow-origin'), null);
});

test('success route never calls Stripe or reveals a key while paid flow is gated', async () => {
  let calls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { calls++; throw new Error('network forbidden in test'); };
  try {
    const response = await request('/success?session_id=cs_mock');
    const text = await response.text();
    assert.equal(response.status, 503);
    assert.equal(calls, 0);
    assert.doesNotMatch(text, /sg_[0-9a-f]{48}/i);
    assert.match(response.headers.get('cache-control') || '', /no-store/);
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  } finally { globalThis.fetch = originalFetch; }
});

test('enabled success validates Stripe authority and reveals one encrypted delivery with no-store isolation', async () => {
  const rawKey = `sg_${'ab'.repeat(24)}`;
  const secret = new Uint8Array(32).fill(9);
  const expiresAt = Math.floor(Date.now() / 1000) + 600;
  const envelope = await encryptApiKeyDelivery(rawKey, {
    accountId: 'acct_1', checkoutSessionId: 'cs_test_123456', expiresAt, secret,
  });
  const sql = [];
  const db = {
    prepare(text) {
      sql.push(text);
      return { bind() { return { async first() {
        if (/SELECT encrypted_key/i.test(text)) return { encrypted_key: envelope.encryptedKey, iv: envelope.iv, expires_at: expiresAt };
        if (/UPDATE key_deliveries/i.test(text)) return { consumed_at: Math.floor(Date.now() / 1000) };
        return null;
      } }; } };
    },
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({
    id: 'cs_test_123456', status: 'complete', payment_status: 'paid', livemode: false, mode: 'subscription',
    customer: 'cus_1', client_reference_id: 'acct_1', amount_total: 489, currency: 'usd',
    metadata: { spydergoat_sku: 'subscription', spydergoat_account_id: 'acct_1' },
    line_items: { data: [{ quantity: 1, price: { id: 'price_pro', product: { id: 'prod_pro' }, unit_amount: 489, currency: 'usd' } }] },
    subscription: { id: 'sub_1', status: 'active', current_period_start: 1_000, current_period_end: 2_000, metadata: { spydergoat_sku: 'subscription', spydergoat_account_id: 'acct_1' } },
  });
  try {
    const response = await request('/success?session_id=cs_test_123456', {}, webhookBindings({ DB: db }));
    const body = await response.text();
    assert.equal(response.status, 200);
    assert.match(body, new RegExp(rawKey));
    assert.match(response.headers.get('cache-control'), /no-store/);
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
    assert.equal(sql.some(text => /UPDATE key_deliveries/i.test(text)), true);
  } finally { globalThis.fetch = originalFetch; }
});

test('paid bearer request authenticates by digest and atomically consumes one in-period call', async () => {
  const rawKey = `sg_${'cd'.repeat(24)}`;
  const statements = [];
  const db = {
    prepare(sql) {
      return { bind(...args) {
        statements.push({ sql, args });
        return { async first() {
          if (/SELECT accounts\.id/i.test(sql)) return { id: 'acct_1', active: 1 };
          if (/UPDATE accounts/i.test(sql)) return { current_period_calls: 1, wallet_balance: 7 };
          return null;
        } };
      } };
    },
  };
  const response = await request('/mjd', { headers: { Authorization: `Bearer ${rawKey}` } }, {
    ...env(), PAID_ACCESS_ENABLED: 'true', DB: db,
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-ratelimit-limit'), '5000');
  assert.equal(response.headers.get('x-ratelimit-remaining'), '4999');
  assert.equal(statements.some(value => /key_digest = \?1/i.test(value.sql)), true);
  assert.equal(statements.some(value => value.args.includes(rawKey)), false);
  const allowance = statements.find(value => /UPDATE accounts/i.test(value.sql));
  assert.match(allowance.sql, /current_period_calls < 5000/i);
  assert.match(allowance.sql, /\?2 >= period_start AND \?2 < period_end/i);
  assert.doesNotMatch(allowance.sql, /wallet_balance\s*=/i);
});

test('malformed paid bearer fails before D1 and authenticated HEAD is quota-neutral', async () => {
  let updates = 0;
  const statements = [];
  const db = {
    prepare(sql) {
      return { bind(...args) { statements.push({ sql, args }); return { async first() {
        if (/SELECT accounts\.id/i.test(sql)) return { id: 'acct_1', active: 1 };
        if (/UPDATE accounts/i.test(sql)) updates++;
        return null;
      } }; } };
    },
  };
  const bindings = { ...env(), PAID_ACCESS_ENABLED: 'true', DB: db };
  const malformed = await request('/mjd', { headers: { Authorization: 'Bearer nope' } }, bindings);
  assert.equal(malformed.status, 401);
  const headKey = `sg_${'ef'.repeat(24)}`;
  const head = await request('/mjd', { method: 'HEAD', headers: { Authorization: ['Bearer', headKey].join(' ') } }, bindings);
  assert.equal(head.status, 200);
  assert.equal(updates, 0);
  const authentication = statements.find(value => /SELECT accounts\.id/i.test(value.sql));
  assert.match(authentication.sql, /\?2 >= accounts\.period_start AND \?2 < accounts\.period_end/i);
  assert.equal(Number.isSafeInteger(authentication.args[1]), true);
});

test('webhook fails closed when transactional billing is not configured', async () => {
  const response = await request('/webhook', { method: 'POST', body: '{}', headers: { 'stripe-signature': 't=1,v1=x' } });
  assert.equal(response.status, 503);
});

test('webhook requires an exact Stripe livemode configuration', async () => {
  for (const value of [undefined, '', 'False', 'test', 'TRUE']) {
    const response = await request('/webhook', { method: 'POST', body: '{}', headers: { 'stripe-signature': 'bad' } }, webhookBindings({ STRIPE_LIVEMODE: value }));
    assert.equal(response.status, 503);
  }
});

test('webhook rejects malformed delivery-secret encoding before D1 or Stripe', async () => {
  let touched = false;
  const bindings = webhookBindings({ API_KEY_DELIVERY_SECRET_BASE64: Buffer.alloc(31).toString('base64'), DB: { prepare() { touched = true; } } });
  const response = await request('/webhook', { method: 'POST', body: '{}', headers: { 'stripe-signature': 'bad' } }, bindings);
  assert.equal(response.status, 503);
  assert.equal(touched, false);
});

test('webhook caps the raw body before signature verification, JSON parse, D1, or Stripe', async () => {
  let touched = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { touched = true; throw new Error('Stripe must not be touched'); };
  try {
    const bindings = webhookBindings({ DB: { prepare() { touched = true; } } });
    const response = await request('/webhook', { method: 'POST', body: 'x'.repeat(65_537), headers: { 'stripe-signature': 'bad' } }, bindings);
    assert.equal(response.status, 413);
    assert.equal(touched, false);
  } finally { globalThis.fetch = originalFetch; }
});

test('webhook streaming reader cancels once the 64 KiB accumulation bound is crossed', async () => {
  let produced = 0;
  let cancelled = false;
  const body = new ReadableStream({
    pull(controller) {
      produced++;
      if (produced > 100) return controller.close();
      controller.enqueue(new Uint8Array(1024));
    },
    cancel() { cancelled = true; },
  });
  const response = await request('/webhook', {
    method: 'POST', body, duplex: 'half', headers: { 'stripe-signature': 'bad' },
  }, webhookBindings());
  assert.equal(response.status, 413);
  assert.equal(cancelled, true);
  assert.equal(produced <= 66, true);
});

test('webhook verifies the exact raw body before parsing or Stripe/D1 processing', async () => {
  let touched = false;
  const raw = '{not-json}';
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { touched = true; throw new Error('Stripe must not be touched'); };
  try {
    const signature = await signedWebhook(raw, 'whsec_test');
    const bindings = webhookBindings({ DB: { prepare() { touched = true; } } });
    const response = await request('/webhook', { method: 'POST', body: raw, headers: { 'stripe-signature': signature } }, bindings);
    assert.equal(response.status, 400);
    assert.equal(touched, false);
  } finally { globalThis.fetch = originalFetch; }
});

test('invalid webhook signature never retrieves Checkout or touches D1', async () => {
  let touched = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { touched = true; throw new Error('Stripe must not be touched'); };
  try {
    const bindings = webhookBindings({ DB: { prepare() { touched = true; } } });
    const response = await request('/webhook', { method: 'POST', body: JSON.stringify({ id: 'evt_1', type: 'checkout.session.completed' }), headers: { 'stripe-signature': 't=1,v1=' + '0'.repeat(64) } }, bindings);
    assert.equal(response.status, 400);
    assert.equal(touched, false);
  } finally { globalThis.fetch = originalFetch; }
});

test('unknown signed webhook succeeds ignored without D1 or Stripe', async () => {
  const raw = JSON.stringify({ id: 'evt_unknown', created: 1_000, type: 'charge.succeeded', data: { object: {} } });
  const signature = await signedWebhook(raw, 'whsec_test');
  let touched = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { touched = true; };
  try {
    const response = await request('/webhook', { method: 'POST', body: raw, headers: { 'stripe-signature': signature } }, webhookBindings({ DB: { prepare() { touched = true; } } }));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { received: true, ignored: true });
    assert.equal(touched, false);
  } finally { globalThis.fetch = originalFetch; }
});

test('signed Checkout webhook retrieves authority and provisions only the pending account', async () => {
  const raw = JSON.stringify({ id: 'evt_checkout', created: 1_100, livemode: false, type: 'checkout.session.completed', data: { object: { id: 'cs_1' } } });
  const signature = await signedWebhook(raw, 'whsec_test');
  const statements = [];
  const db = {
    prepare(sql) {
      return { bind(...args) {
        const statement = {
          sql, args,
          async first() {
            if (/subscription_status = 'pending'/i.test(sql)) return { pending: 1 };
            return null;
          },
          async run() { return { success: true, meta: { changes: 1 } }; },
        };
        statements.push(statement);
        return statement;
      } };
    },
    async batch(batch) { return batch.map(() => ({ success: true, meta: { changes: 1 } })); },
  };
  const originalFetch = globalThis.fetch;
  const stripeCalls = [];
  globalThis.fetch = async (url, init) => {
    stripeCalls.push({ url: String(url), init });
    return Response.json({
      id: 'cs_1', status: 'complete', payment_status: 'paid', livemode: false, mode: 'subscription',
      customer: 'cus_1', client_reference_id: 'acct_1', amount_total: 489, currency: 'usd',
      metadata: { spydergoat_sku: 'subscription', spydergoat_account_id: 'acct_1' },
      line_items: { data: [{ quantity: 1, price: { id: 'price_pro', product: { id: 'prod_pro' }, unit_amount: 489, currency: 'usd' } }] },
      subscription: { id: 'sub_1', status: 'active', current_period_start: 1_000, current_period_end: 2_000, metadata: { spydergoat_sku: 'subscription', spydergoat_account_id: 'acct_1' } },
    });
  };
  try {
    const response = await request('/webhook', { method: 'POST', body: raw, headers: { 'stripe-signature': signature } }, webhookBindings({ DB: db }));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { received: true, replayed: false, stale: false });
    assert.equal(stripeCalls.length, 1);
    assert.match(stripeCalls[0].url, /checkout\/sessions\/cs_1/);
    assert.equal(statements.some(value => /UPDATE accounts/i.test(value.sql) && /subscription_status = 'pending'/i.test(value.sql)), true);
    const delivery = statements.find(value => /INSERT INTO key_deliveries/i.test(value.sql));
    assert.equal(delivery.args[2] instanceof ArrayBuffer, true);
  } finally { globalThis.fetch = originalFetch; }
});

test('Pro checkout remains unavailable unless the paid capability is explicitly enabled', async () => {
  let calls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { calls++; throw new Error('network forbidden'); };
  try {
    const response = await request('/checkout/pro', {
      method: 'POST',
      headers: { Origin: 'https://spydergoat.test' },
    });
    assert.equal(response.status, 503);
    assert.equal(calls, 0);
  } finally { globalThis.fetch = originalFetch; }
});

test('Pro checkout rejects unexpected request bodies before D1 or Stripe', async () => {
  let touched = false;
  const bindings = {
    ...env(),
    PAID_ACCESS_ENABLED: 'true',
    CHECKOUT_ORIGINS: 'https://spydergoat.test',
    STRIPE_SECRET_KEY: '«redacted:sk_test_…»',
    STRIPE_PRO_PRICE_ID: 'price_pro',
    STRIPE_PRO_PRODUCT_ID: 'prod_pro',
    STRIPE_PRO_AMOUNT: '489',
    DB: { prepare() { touched = true; throw new Error('D1 should not be touched'); } },
  };
  const response = await request('/checkout/pro', {
    method: 'POST',
    headers: { Origin: 'https://spydergoat.test', 'Content-Type': 'text/plain' },
    body: 'garbage',
  }, bindings);
  assert.equal(response.status, 400);
  assert.equal(touched, false);
});

test('Pro checkout rejects an origin outside the configured allowlist before D1 or Stripe', async () => {
  let touched = false;
  const bindings = {
    ...env(),
    PAID_ACCESS_ENABLED: 'true',
    CHECKOUT_ORIGINS: 'https://spydergoat.test',
    STRIPE_SECRET_KEY: '«redacted:sk_test_…»',
    STRIPE_PRO_PRICE_ID: 'price_pro',
    STRIPE_PRO_PRODUCT_ID: 'prod_pro',
    STRIPE_PRO_AMOUNT: '489',
    DB: { prepare() { touched = true; throw new Error('D1 should not be touched'); } },
  };
  const response = await request('/checkout/pro', {
    method: 'POST',
    headers: { Origin: 'https://evil.example' },
  }, bindings);
  assert.equal(response.status, 403);
  assert.equal(touched, false);
});

test('Pro checkout requires an exact Stripe livemode configuration before D1 or Stripe', async () => {
  let touched = false;
  const bindings = {
    ...env(), PAID_ACCESS_ENABLED: 'true', CHECKOUT_ORIGINS: 'https://spydergoat.test',
    STRIPE_SECRET_KEY: '«redacted:sk_test_…»', STRIPE_PRO_PRICE_ID: 'price_pro',
    STRIPE_PRO_PRODUCT_ID: 'prod_pro', STRIPE_PRO_AMOUNT: '489', STRIPE_LIVEMODE: 'test',
    DB: { prepare() { touched = true; } },
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { touched = true; };
  try {
    const response = await request('/checkout/pro', { method: 'POST', headers: { Origin: 'https://spydergoat.test' } }, bindings);
    assert.equal(response.status, 503);
    assert.equal(touched, false);
  } finally { globalThis.fetch = originalFetch; }
});

test('enabled Pro checkout binds a server account and sends an allowlisted Stripe command', async () => {
  const sql = [];
  const stripeRequests = [];
  let stripeRequest;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async function (url, init) {
    assert.equal(this, globalThis);
    stripeRequests.push({ url: String(url), init });
    if (init.method === 'GET') {
      return Response.json({
        id: 'price_pro', active: true, currency: 'usd', unit_amount: 489,
        type: 'recurring', recurring: { interval: 'month', interval_count: 1 }, product: 'prod_pro',
      });
    }
    stripeRequest = { url: String(url), init, body: new URLSearchParams(init.body) };
    return new Response(JSON.stringify({ id: 'cs_test_1', url: 'https://checkout.stripe.com/c/pay/cs_test_1' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  const bindings = {
    ...env(),
    PAID_ACCESS_ENABLED: 'true',
    CHECKOUT_ORIGINS: 'https://spydergoat.test',
    STRIPE_SECRET_KEY: 'sk_test_redacted',
    STRIPE_PRO_PRICE_ID: 'price_pro',
    STRIPE_PRO_PRODUCT_ID: 'prod_pro',
    STRIPE_PRO_AMOUNT: '489',
    STRIPE_LIVEMODE: 'false',
    DB: {
      prepare(text) {
        sql.push(text);
        return { bind() { return { async run() { return { success: true, meta: { changes: 1 } }; } }; } };
      },
    },
  };
  try {
    const emptyEdgeBody = new ReadableStream({ start(controller) { controller.close(); } });
    const response = await request('/checkout/pro', {
      method: 'POST',
      body: emptyEdgeBody,
      duplex: 'half',
      headers: { Origin: 'https://spydergoat.test' },
    }, bindings);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.checkout_url, 'https://checkout.stripe.com/c/pay/cs_test_1');
    assert.match(sql.join('\n'), /INSERT INTO accounts/i);
    assert.equal(stripeRequests[0].url, 'https://api.stripe.com/v1/prices/price_pro');
    assert.equal(stripeRequests[0].init.method, 'GET');
    assert.equal(stripeRequest.url, 'https://api.stripe.com/v1/checkout/sessions');
    assert.equal(stripeRequest.body.get('mode'), 'subscription');
    assert.equal(stripeRequest.body.get('line_items[0][price]'), 'price_pro');
    assert.equal(stripeRequest.body.get('metadata[spydergoat_sku]'), 'subscription');
    assert.match(stripeRequest.body.get('metadata[spydergoat_account_id]'), /^acct_/);
    assert.equal(
      stripeRequest.body.get('subscription_data[metadata][spydergoat_account_id]'),
      stripeRequest.body.get('metadata[spydergoat_account_id]'),
    );
  } finally { globalThis.fetch = originalFetch; }
});

test('HEAD, sitemap, robots and route-specific methods are supported', async () => {
  const head = await request('/', { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  assert.equal((await request('/sitemap.xml')).status, 200);
  assert.equal((await request('/robots.txt')).status, 200);
  const post = await request('/mjd', { method: 'POST' });
  assert.equal(post.status, 405);
  assert.equal(post.headers.get('allow'), 'GET, HEAD, OPTIONS');
});

test('HEAD on a public API is quota-neutral', async () => {
  const bindings = env();
  const head = await request('/mjd', { method: 'HEAD' }, bindings);
  const get = await request('/mjd', {}, bindings);
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  assert.equal(get.status, 200);
});

test('public API keeps CORS and returns documented response', async () => {
  const response = await request('/mjd');
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('access-control-allow-origin'), '*');
  assert.equal(typeof body.mjd, 'number');
  assert.equal(typeof body.utc, 'string');
  assert.equal(typeof body.unix, 'number');
  assert.equal(body.source, 'server');
});
