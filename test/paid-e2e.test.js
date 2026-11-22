import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { runDailyBillingCheck } from '../src/api/worker.js';

async function stripeHeader(payload, secret, timestamp = Math.floor(Date.now() / 1000)) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${payload}`));
  return `t=${timestamp},v1=${Buffer.from(signature).toString('hex')}`;
}

test('mocked signed Stripe checkout provisions one-time key and refund revokes it', async () => {
  const secret = ['whsec', 'fixture', 'only'].join('_');
  const deliveries = new Map();
  const commands = [];
  const repository = {
    async applyStripeEventOnce(id, command) {
      commands.push(command);
      if (command.kind === 'provision') deliveries.set(command.checkoutSessionId, {
        encrypted_key: command.credential.encryptedKey, iv: command.credential.iv,
      });
      return { replayed: false, id };
    },
    async consumeKeyDelivery(id) {
      const value = deliveries.get(id);
      deliveries.delete(id);
      return value || null;
    },
  };
  const env = {
    PAID_ENABLED: 'true', STRIPE_WEBHOOK_SECRET: secret,
    STRIPE_SECRET_KEY: ['sk', 'test', 'fixture'].join('_'),
    STRIPE_PRO_PRODUCT_ID: 'prod_fixture', STRIPE_PRO_PRICE_ID: 'price_fixture',
    KEY_DELIVERY_SECRET: 'local-test-encryption-secret-at-least-32-bytes',
    BILLING_REPOSITORY: repository,
  };
  // Stripe webhook delivery shape: line_items is not embedded here.
  const event = {
    id: 'evt_checkout_fixture', type: 'checkout.session.completed',
    data: { object: {
      id: 'cs_fixture', mode: 'subscription', payment_status: 'paid', status: 'complete', livemode: false,
      customer: 'cus_fixture', subscription: 'sub_fixture', amount_total: 500, currency: 'usd',
      metadata: { spydergoat_sku: 'subscription', spydergoat_account_id: 'acct_fixture' },
    } },
  };
  const expandedSession = {
    ...event.data.object,
    line_items: { data: [{ quantity: 1, price: { id: 'price_fixture', product: 'prod_fixture', unit_amount: 500, currency: 'usd' } }] },
  };
  const payload = JSON.stringify(event);
  const originalFetch = globalThis.fetch;
  let stripeRequest;
  globalThis.fetch = async url => {
    stripeRequest = new URL(url);
    return new Response(JSON.stringify(expandedSession), { headers: { 'content-type': 'application/json' } });
  };
  let webhook;
  try {
    webhook = await worker.fetch(new Request('https://spydergoat.test/webhook', {
      method: 'POST', body: payload, headers: { 'stripe-signature': await stripeHeader(payload, secret) },
    }), env, {});
  } finally { globalThis.fetch = originalFetch; }
  assert.equal(webhook.status, 200);
  assert.equal(stripeRequest.pathname, '/v1/checkout/sessions/cs_fixture');
  assert.deepEqual(stripeRequest.searchParams.getAll('expand[]'), ['line_items']);
  assert.equal(commands[0].kind, 'provision');
  assert.match(commands[0].credential.digest, /^[0-9a-f]{64}$/);
  assert.equal(Object.hasOwn(commands[0].credential, 'raw'), false);

  const success = await worker.fetch(new Request('https://spydergoat.test/success?session_id=cs_fixture'), env, {});
  assert.equal(success.status, 200);
  assert.match(await success.text(), /sg_[0-9a-f]{48}/);
  assert.equal((await worker.fetch(new Request('https://spydergoat.test/success?session_id=cs_fixture'), env, {})).status, 404);

  const refund = { id: 'evt_refund_fixture', type: 'charge.refunded', data: { object: { customer: 'cus_fixture' } } };
  const refundPayload = JSON.stringify(refund);
  assert.equal((await worker.fetch(new Request('https://spydergoat.test/webhook', {
    method: 'POST', body: refundPayload, headers: { 'stripe-signature': await stripeHeader(refundPayload, secret) },
  }), env, {})).status, 200);
  assert.equal(commands[1].kind, 'revoke');
});

test('operator key resend revalidates the paid session and rotates delivery without returning a key', async () => {
  let replacement;
  const repository = { async replaceCredentialForCheckout(command) { replacement = command; } };
  const env = {
    PAID_ENABLED: 'true', BILLING_ADMIN_TOKEN: 'a'.repeat(32),
    STRIPE_SECRET_KEY: ['sk', 'test', 'fixture'].join('_'),
    STRIPE_PRO_PRODUCT_ID: 'prod_fixture', STRIPE_PRO_PRICE_ID: 'price_fixture',
    KEY_DELIVERY_SECRET: 'local-test-encryption-secret-at-least-32-bytes',
    BILLING_REPOSITORY: repository,
  };
  const session = {
    id: 'cs_fixture', mode: 'subscription', payment_status: 'paid', status: 'complete', livemode: false,
    customer: 'cus_fixture', subscription: 'sub_fixture', amount_total: 500, currency: 'usd',
    metadata: { spydergoat_sku: 'subscription', spydergoat_account_id: 'acct_fixture' },
    line_items: { data: [{ quantity: 1, price: { id: 'price_fixture', product: 'prod_fixture', unit_amount: 500, currency: 'usd' } }] },
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify(session), { headers: { 'content-type': 'application/json' } });
  let response;
  try {
    response = await worker.fetch(new Request('https://spydergoat.test/billing/key-resend', {
      method: 'POST', headers: { 'content-type': 'application/json', 'X-Admin-Token': env.BILLING_ADMIN_TOKEN },
      body: JSON.stringify({ checkout_session_id: 'cs_fixture' }),
    }), env, {});
  } finally { globalThis.fetch = originalFetch; }
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(body, { resent: true, delivery_path: '/success?session_id=cs_fixture' });
  assert.equal(replacement.accountId, 'acct_fixture');
  assert.match(replacement.credential.digest, /^[0-9a-f]{64}$/);
  assert.equal(JSON.stringify(body).includes('sg_'), false);
});

test('daily billing check alerts on paid sessions without a provisioned key and revokes expired grace', async () => {
  const repository = {
    async revokeExpiredGrace(now) { assert.equal(now, 2_000_000); return 2; },
    async hasProvisionedCheckoutSession(id) { assert.equal(id, 'cs_missing'); return false; },
  };
  const env = {
    STRIPE_SECRET_KEY: ['sk', 'test', 'fixture'].join('_'),
    STRIPE_PRO_PRODUCT_ID: 'prod_fixture', STRIPE_PRO_PRICE_ID: 'price_fixture',
    BILLING_REPOSITORY: repository,
  };
  const session = {
    id: 'cs_missing', mode: 'subscription', payment_status: 'paid', status: 'complete', livemode: false,
    customer: 'cus_fixture', amount_total: 500, currency: 'usd',
    metadata: { spydergoat_sku: 'subscription', spydergoat_account_id: 'acct_fixture' },
    line_items: { data: [{ quantity: 1, price: { id: 'price_fixture', product: 'prod_fixture', unit_amount: 500, currency: 'usd' } }] },
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ data: [session], has_more: false }), { headers: { 'content-type': 'application/json' } });
  const errors = [];
  let result;
  try {
    result = await runDailyBillingCheck(env, { error(event, fields) { errors.push({ event, fields }); }, info() {} }, 2_000_000);
  } finally { globalThis.fetch = originalFetch; }
  assert.deepEqual(result, { missing: ['cs_missing'], revoked: 2 });
  assert.deepEqual(errors, [{ event: 'paid_checkout_unprovisioned', fields: { checkoutSessionId: 'cs_missing' } }]);
});
