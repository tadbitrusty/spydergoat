import test from 'node:test';
import assert from 'node:assert/strict';
import { StripeBillingClient } from '../src/billing/stripe-client.js';

const command = {
  accountId: 'acct_1',
  sku: 'subscription',
  mode: 'subscription',
  priceId: 'price_pro',
  productId: 'prod_pro',
  currency: 'usd',
  amount: 489,
  successUrl: 'https://spydergoat.test/success?session_id={CHECKOUT_SESSION_ID}',
  cancelUrl: 'https://spydergoat.test/#pricing',
};

function price(overrides = {}) {
  return {
    id: 'price_pro',
    active: true,
    currency: 'usd',
    unit_amount: 489,
    type: 'recurring',
    recurring: { interval: 'month', interval_count: 1 },
    product: 'prod_pro',
    ...overrides,
  };
}

test('Stripe client verifies the exact recurring catalog price before creating Checkout', async () => {
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push({ url: String(url), init });
    if (init.method === 'GET') return Response.json(price());
    return Response.json({ id: 'cs_test_1', url: 'https://checkout.stripe.com/c/pay/cs_test_1' });
  };
  const result = await new StripeBillingClient('test-secret', { fetcher }).createCheckoutSession(command);
  assert.equal(result.id, 'cs_test_1');
  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /\/v1\/prices\/price_pro$/);
  assert.equal(calls[0].init.method, 'GET');
  assert.equal(calls[1].url, 'https://api.stripe.com/v1/checkout/sessions');
  assert.equal(calls[1].init.method, 'POST');
});

test('Stripe client refuses a mismatched catalog price without creating Checkout', async () => {
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push({ url: String(url), init });
    return Response.json(price({ unit_amount: 999 }));
  };
  await assert.rejects(
    () => new StripeBillingClient('test-secret', { fetcher }).createCheckoutSession(command),
    /catalog/i,
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.method, 'GET');
});

test('Stripe client refuses a multi-month recurring price without creating Checkout', async () => {
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push({ url: String(url), init });
    return Response.json(price({ recurring: { interval: 'month', interval_count: 3 } }));
  };
  await assert.rejects(
    () => new StripeBillingClient('test-secret', { fetcher }).createCheckoutSession(command),
    /catalog/i,
  );
  assert.equal(calls.length, 1);
});

test('Stripe client retrieves an authoritative expanded Checkout Session by encoded ID', async () => {
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push({ url: String(url), init });
    return Response.json({ id: 'cs_test/unsafe', line_items: { data: [] }, subscription: { id: 'sub_1' } });
  };
  const result = await new StripeBillingClient('test-secret', { fetcher }).retrieveCheckoutSession('cs_test/unsafe');
  assert.equal(result.id, 'cs_test/unsafe');
  const url = new URL(calls[0].url);
  assert.equal(url.pathname, '/v1/checkout/sessions/cs_test%2Funsafe');
  assert.deepEqual(url.searchParams.getAll('expand[]'), ['line_items.data.price.product', 'subscription']);
  assert.equal(calls[0].init.method, 'GET');
});

test('Stripe client fails closed when authoritative Checkout retrieval fails', async () => {
  const fetcher = async () => new Response('not-json', { status: 502 });
  await assert.rejects(
    () => new StripeBillingClient('test-secret', { fetcher }).retrieveCheckoutSession('cs_1'),
    /retrieval failed with status 502/i,
  );
});
