import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/api/worker.js';

function env() {
  const values = new Map();
  return { SPYDERGOAT_KV: { async get(key) { return values.get(key) ?? null; }, async put(key, value) { values.set(key, value); } } };
}

async function request(path, init = {}, bindings = env()) {
  return worker.fetch(new Request(`https://spydergoat.test${path}`, init), bindings, {});
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

test('webhook fails closed when transactional billing is not configured', async () => {
  const response = await request('/webhook', { method: 'POST', body: '{}', headers: { 'stripe-signature': 't=1,v1=x' } });
  assert.equal(response.status, 503);
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
    STRIPE_SECRET_KEY: 'sk_test_redacted',
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

test('enabled Pro checkout binds a server account and sends an allowlisted Stripe command', async () => {
  const sql = [];
  const stripeRequests = [];
  let stripeRequest;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
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
    DB: {
      prepare(text) {
        sql.push(text);
        return { bind() { return { async run() { return { success: true, meta: { changes: 1 } }; } }; } };
      },
    },
  };
  try {
    const response = await request('/checkout/pro', {
      method: 'POST',
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
