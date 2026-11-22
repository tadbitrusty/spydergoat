import test from 'node:test';
import assert from 'node:assert/strict';
import { createCheckoutSession, verifyStripeSignature } from '../src/billing/stripe.js';

async function signature(payload, secret, timestamp) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const bytes = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${payload}`));
  return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');
}

test('webhook verification accepts any valid v1 signature', async () => {
  const payload = '{"id":"evt_1"}', secret = ['whsec', 'local', 'fixture'].join('_'), now = 1_800_000_000;
  const good = await signature(payload, secret, now);
  assert.equal((await verifyStripeSignature(payload, `t=${now},v1=bad,v1=${good}`, secret, now)).valid, true);
});

test('webhook verification rejects missing secret, nonnumeric, stale and invalid signatures', async () => {
  const payload = '{}', secret = ['whsec', 'local', 'fixture'].join('_'), now = 1_800_000_000;
  assert.equal((await verifyStripeSignature(payload, `t=${now},v1=x`, '', now)).valid, false);
  assert.equal((await verifyStripeSignature(payload, 't=nope,v1=x', secret, now)).valid, false);
  assert.equal((await verifyStripeSignature(payload, `t=${now - 301},v1=x`, secret, now)).valid, false);
  assert.equal((await verifyStripeSignature(payload, `t=${now},v1=x`, secret, now)).valid, false);
});

test('checkout is test-mode only and creates the fixed subscription request', async () => {
  let seen;
  const env = {
    STRIPE_SECRET_KEY: ['sk', 'test', 'fixture'].join('_'),
    STRIPE_PRO_PRICE_ID: 'price_fixture', PUBLIC_ORIGIN: 'https://spydergoat.test',
  };
  const session = await createCheckoutSession(env, 'acct_fixture', async (url, init) => {
    seen = { url, init };
    return new Response(JSON.stringify({ id: 'cs_fixture', url: 'https://checkout.stripe.test/fixture' }), {
      headers: { 'content-type': 'application/json' },
    });
  });
  assert.equal(session.id, 'cs_fixture');
  assert.equal(seen.url, 'https://api.stripe.com/v1/checkout/sessions');
  assert.equal(seen.init.body.get('mode'), 'subscription');
  assert.equal(seen.init.body.get('line_items[0][price]'), 'price_fixture');
  assert.equal(seen.init.body.get('metadata[spydergoat_account_id]'), 'acct_fixture');
  await assert.rejects(
    () => createCheckoutSession({ ...env, STRIPE_SECRET_KEY: ['sk', 'live', 'forbidden'].join('_') }, 'acct_fixture', async () => { throw new Error('must not call'); }),
    /test-mode/i,
  );
});
