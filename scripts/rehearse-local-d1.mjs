import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Miniflare } from 'miniflare';
import { D1BillingRepository } from '../src/billing/d1-repository.js';
import { authenticateApiKey, consumePaidRequest, processStripeEvent } from '../src/billing/service.js';
import { claimAndDecryptApiKey } from '../src/billing/key-delivery.js';

const mf = new Miniflare({
  modules: true,
  script: 'export default { fetch(){ return new Response("ok") } }',
  d1Databases: { DB: '7a4439ad-a213-432e-a1cd-e14065f60df2' },
});

try {
  const db = await mf.getD1Database('DB');
  const migration = (await readFile(new URL('../migrations/0001_transactional_billing.sql', import.meta.url), 'utf8'))
    .replace(/^--.*$/gm, '');
  for (const statement of migration.split(';').map(value => value.trim()).filter(Boolean)) {
    await db.prepare(statement).run();
  }

  const repository = new D1BillingRepository(db);
  const now = Math.floor(Date.now() / 1000);
  const accountId = 'acct_rehearsal';
  const checkoutSessionId = 'cs_test_rehearsal_123456';
  const deliverySecret = new Uint8Array(32).fill(17);
  const catalog = {
    subscription: { mode: 'subscription', product: 'prod_pro', price: 'price_pro', currency: 'usd', amount: 489 },
  };
  const session = {
    id: checkoutSessionId,
    status: 'complete',
    payment_status: 'paid',
    livemode: false,
    mode: 'subscription',
    customer: 'cus_rehearsal',
    client_reference_id: accountId,
    amount_total: 489,
    currency: 'usd',
    metadata: { spydergoat_sku: 'subscription', spydergoat_account_id: accountId },
    line_items: { data: [{ quantity: 1, price: { id: 'price_pro', product: { id: 'prod_pro' }, unit_amount: 489, currency: 'usd' } }] },
    subscription: {
      id: 'sub_rehearsal',
      status: 'active',
      current_period_start: now - 60,
      current_period_end: now + 3_600,
      metadata: { spydergoat_sku: 'subscription', spydergoat_account_id: accountId },
    },
  };
  await repository.createPendingAccount(accountId);
  const completion = await processStripeEvent(repository, {
    id: 'evt_checkout_rehearsal', type: 'checkout.session.completed', created: now - 30, livemode: false,
    data: { object: session },
  }, catalog, { livemode: false, deliverySecret, now: () => now });
  assert.equal(completion.replayed, false);

  const stored = await db.prepare(`
    SELECT a.subscription_status, a.wallet_balance,
      (SELECT COUNT(*) FROM api_credentials WHERE account_id = a.id) AS credential_count,
      (SELECT COUNT(*) FROM key_deliveries WHERE account_id = a.id) AS delivery_count,
      (SELECT COUNT(*) FROM stripe_events WHERE status = 'processed') AS processed_events
    FROM accounts a WHERE a.id = ?1
  `).bind(accountId).first();
  assert.deepEqual({ ...stored }, {
    subscription_status: 'active', wallet_balance: 0,
    credential_count: 1, delivery_count: 1, processed_events: 1,
  });

  const duplicate = await processStripeEvent(repository, {
    id: 'evt_checkout_rehearsal', type: 'checkout.session.completed', created: now - 30, livemode: false,
    data: { object: session },
  }, catalog, { livemode: false, deliverySecret, now: () => now });
  assert.equal(duplicate.replayed, true);
  assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM api_credentials').first()).count, 1);

  const delivered = await claimAndDecryptApiKey(repository, {
    accountId, checkoutSessionId, secret: deliverySecret, now,
  });
  assert.match(delivered, /^sg_[0-9a-f]{48}$/);
  assert.equal(await claimAndDecryptApiKey(repository, {
    accountId, checkoutSessionId, secret: deliverySecret, now,
  }), null);

  assert.equal((await authenticateApiKey(repository, delivered, now)).id, accountId);
  await db.prepare('UPDATE accounts SET current_period_calls = 4999, wallet_balance = 7 WHERE id = ?1').bind(accountId).run();
  const finalAllowed = await consumePaidRequest(repository, accountId, now);
  const exhausted = await consumePaidRequest(repository, accountId, now);
  assert.equal(finalAllowed.allowed, true);
  assert.equal(finalAllowed.calls, 5000);
  assert.deepEqual(exhausted, { allowed: false, reason: 'inactive_outside_period_or_exhausted' });
  assert.equal((await db.prepare('SELECT wallet_balance FROM accounts WHERE id = ?1').bind(accountId).first()).wallet_balance, 7);

  const renewed = await processStripeEvent(repository, {
    id: 'evt_invoice_paid_rehearsal', type: 'invoice.paid', created: now + 1, livemode: false,
    data: { object: {
      customer: 'cus_rehearsal', subscription: 'sub_rehearsal', paid: true, status: 'paid',
      billing_reason: 'subscription_cycle',
      lines: { data: [{ type: 'subscription', subscription: 'sub_rehearsal', period: { start: now + 1, end: now + 7_200 } }] },
      subscription_details: { metadata: { spydergoat_sku: 'subscription', spydergoat_account_id: accountId } },
    } },
  }, catalog, { livemode: false, now: () => now });
  assert.equal(renewed.replayed, false);
  const afterRenewal = await db.prepare('SELECT subscription_status, current_period_calls, wallet_balance FROM accounts WHERE id = ?1').bind(accountId).first();
  assert.deepEqual({ ...afterRenewal }, { subscription_status: 'active', current_period_calls: 0, wallet_balance: 7 });

  const canceled = await processStripeEvent(repository, {
    id: 'evt_subscription_deleted_rehearsal', type: 'customer.subscription.deleted', created: now + 2, livemode: false,
    data: { object: {
      id: 'sub_rehearsal', customer: 'cus_rehearsal', status: 'canceled',
      current_period_start: now + 1, current_period_end: now + 7_200,
      metadata: { spydergoat_sku: 'subscription', spydergoat_account_id: accountId },
    } },
  }, catalog, { livemode: false, now: () => now });
  assert.equal(canceled.replayed, false);
  assert.equal((await authenticateApiKey(repository, delivered, now + 2)).id, accountId);

  await processStripeEvent(repository, {
    id: 'evt_invoice_failed_rehearsal', type: 'invoice.payment_failed', created: now + 3, livemode: false,
    data: { object: {
      customer: 'cus_rehearsal', subscription: 'sub_rehearsal', paid: false, status: 'open',
      subscription_details: { metadata: { spydergoat_sku: 'subscription', spydergoat_account_id: accountId } },
    } },
  }, catalog, { livemode: false, now: () => now });
  await processStripeEvent(repository, {
    id: 'evt_deleted_after_failed_payment', type: 'customer.subscription.deleted', created: now + 4, livemode: false,
    data: { object: {
      id: 'sub_rehearsal', customer: 'cus_rehearsal', status: 'canceled',
      current_period_start: now + 1, current_period_end: now + 7_200,
      metadata: { spydergoat_sku: 'subscription', spydergoat_account_id: accountId },
    } },
  }, catalog, { livemode: false, now: () => now });
  await assert.rejects(() => authenticateApiKey(repository, delivered, now + 4), /Invalid API key/);
  await assert.rejects(() => authenticateApiKey(repository, delivered, now + 7_200), /Invalid API key/);

  const schema = await db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table'").all();
  assert.equal(JSON.stringify(schema.results).includes('api_key TEXT'), false);
  console.log(JSON.stringify({
    status: 'PASS',
    migration: 'applied',
    checkout: 'pending-to-active',
    credentialAuthority: 'sha256-digest-only',
    delivery: 'one-time-and-replay-closed',
    allowance: '5000-exact-wallet-unchanged',
    lifecycle: 'renewal-cancellation-through-period-end-failed-payment-stays-disabled',
  }));
} finally {
  await mf.dispose();
}
