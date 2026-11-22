import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/api/worker.js';

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
    STRIPE_PRO_PRODUCT_ID: 'prod_fixture', STRIPE_PRO_PRICE_ID: 'price_fixture',
    KEY_DELIVERY_SECRET: 'local-test-encryption-secret-at-least-32-bytes',
    BILLING_REPOSITORY: repository,
  };
  const event = {
    id: 'evt_checkout_fixture', type: 'checkout.session.completed',
    data: { object: {
      id: 'cs_fixture', mode: 'subscription', payment_status: 'paid', status: 'complete', livemode: false,
      customer: 'cus_fixture', subscription: 'sub_fixture', amount_total: 500, currency: 'usd',
      metadata: { spydergoat_sku: 'subscription', spydergoat_account_id: 'acct_fixture' },
      line_items: { data: [{ quantity: 1, price: { id: 'price_fixture', product: 'prod_fixture', unit_amount: 500, currency: 'usd' } }] },
    } },
  };
  const payload = JSON.stringify(event);
  const webhook = await worker.fetch(new Request('https://spydergoat.test/webhook', {
    method: 'POST', body: payload, headers: { 'stripe-signature': await stripeHeader(payload, secret) },
  }), env, {});
  assert.equal(webhook.status, 200);
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
