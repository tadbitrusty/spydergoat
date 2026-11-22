import test from 'node:test';
import assert from 'node:assert/strict';
import {
  authenticateApiKey,
  consumePaidRequest,
  hashApiKey,
  processStripeEvent,
  validateCheckoutSession,
} from '../src/billing/service.js';

const catalog = {
  subscription: { mode: 'subscription', product: 'prod_pro', price: 'price_pro', currency: 'usd', amount: 500 },
  topup_1000: { mode: 'payment', product: 'prod_1k', price: 'price_1k', currency: 'usd', amount: 100, credits: 1000 },
};

function validSession(overrides = {}) {
  return {
    id: 'cs_1', mode: 'subscription', payment_status: 'paid', status: 'complete', livemode: false,
    customer: 'cus_1', subscription: 'sub_1', amount_total: 500, currency: 'usd',
    metadata: { spydergoat_sku: 'subscription', spydergoat_account_id: 'acct_1' },
    line_items: { data: [{ quantity: 1, price: { id: 'price_pro', product: 'prod_pro', unit_amount: 500, currency: 'usd' } }] },
    ...overrides,
  };
}

function checkoutOptions(session = validSession(), overrides = {}) {
  return {
    livemode: false,
    retrieveCheckoutSession: async id => {
      assert.equal(id, session.id);
      return session;
    },
    ...overrides,
  };
}

test('checkout validation accepts only the allowlisted paid completed session', () => {
  const result = validateCheckoutSession(validSession(), catalog, { livemode: false, accountId: 'acct_1' });
  assert.equal(result.ok, true);
  assert.equal(result.sku, 'subscription');
});

for (const [name, override] of [
  ['open session', { status: 'open' }],
  ['unpaid session', { payment_status: 'unpaid' }],
  ['wrong mode', { mode: 'payment' }],
  ['wrong live mode', { livemode: true }],
  ['wrong currency', { currency: 'eur' }],
  ['wrong amount', { amount_total: 499 }],
  ['missing customer', { customer: null }],
  ['wrong account binding', { metadata: { spydergoat_sku: 'subscription', spydergoat_account_id: 'acct_other' } }],
]) {
  test(`checkout validation fails closed for ${name}`, () => {
    assert.equal(validateCheckoutSession(validSession(override), catalog, { livemode: false, accountId: 'acct_1' }).ok, false);
  });
}

test('checkout validation fails closed for wrong product and price', () => {
  const line_items = { data: [{ quantity: 1, price: { id: 'price_wrong', product: 'prod_wrong', unit_amount: 500, currency: 'usd' } }] };
  assert.equal(validateCheckoutSession(validSession({ line_items }), catalog, { livemode: false, accountId: 'acct_1' }).ok, false);
});

class AtomicRepository {
  constructor({ calls = 0, wallet = 0 } = {}) { this.calls = calls; this.wallet = wallet; this.events = new Set(); this.keys = 0; this.credits = 0; }
  async consumeAllowance() {
    const turn = this._turn = (this._turn || Promise.resolve()).then(() => {
      if (this.calls < 5000) { this.calls++; return { allowed: true, tier: 'paid', calls: this.calls, wallet: this.wallet }; }
      if (this.wallet > 0) { this.calls++; this.wallet--; return { allowed: true, tier: 'wallet', calls: this.calls, wallet: this.wallet }; }
      return { allowed: false, reason: 'wallet_empty' };
    });
    return turn;
  }
  async applyStripeEventOnce(eventId, command) {
    if (this.events.has(eventId)) return { replayed: true };
    this.events.add(eventId);
    if (command.kind === 'provision') this.keys++;
    if (command.kind === 'credit') this.credits += command.credits;
    return { replayed: false };
  }
}

test('concurrent allowance accounting does not lose updates or overspend wallet', async () => {
  const repo = new AtomicRepository({ calls: 4999, wallet: 1 });
  const results = await Promise.all([consumePaidRequest(repo, 'acct_1'), consumePaidRequest(repo, 'acct_1'), consumePaidRequest(repo, 'acct_1')]);
  assert.deepEqual(results.map(x => x.allowed), [true, true, false]);
  assert.equal(repo.calls, 5001);
  assert.equal(repo.wallet, 0);
});

test('duplicate subscription event neither rotates nor creates a second key', async () => {
  const repo = new AtomicRepository();
  const event = { id: 'evt_sub', type: 'checkout.session.completed', data: { object: validSession() } };
  delete event.data.object.line_items;
  const options = checkoutOptions(validSession(), { issueCredential: async () => ({ id: 'cred', digest: 'digest', suffix: 'suffix' }) });
  assert.equal((await processStripeEvent(repo, event, catalog, options)).replayed, false);
  assert.equal((await processStripeEvent(repo, event, catalog, options)).replayed, true);
  assert.equal(repo.keys, 1);
});

test('malformed checkout event without an id fails closed', async () => {
  const repo = new AtomicRepository();
  await assert.rejects(
    () => processStripeEvent(repo, { type: 'checkout.session.completed', data: { object: validSession() } }, catalog, { livemode: false, issueCredential: async () => ({}) }),
    /event id/i,
  );
});

test('duplicate top-up event credits exactly once and requires deterministic binding', async () => {
  const repo = new AtomicRepository();
  const session = validSession({
    mode: 'payment', amount_total: 100,
    metadata: { spydergoat_sku: 'topup_1000', spydergoat_account_id: 'acct_1' },
    line_items: { data: [{ quantity: 1, price: { id: 'price_1k', product: 'prod_1k', unit_amount: 100, currency: 'usd' } }] },
  });
  const event = { id: 'evt_topup', type: 'checkout.session.completed', data: { object: session } };
  await processStripeEvent(repo, event, catalog, checkoutOptions(session));
  await processStripeEvent(repo, event, catalog, checkoutOptions(session));
  assert.equal(repo.credits, 1000);
});

test('top-up without deterministic account binding fails closed', async () => {
  const repo = new AtomicRepository();
  const session = validSession({ mode: 'payment', amount_total: 100, metadata: { spydergoat_sku: 'topup_1000' }, line_items: { data: [{ quantity: 1, price: { id: 'price_1k', product: 'prod_1k', unit_amount: 100, currency: 'usd' } }] } });
  await assert.rejects(() => processStripeEvent(repo, { id: 'evt_bad', type: 'checkout.session.completed', data: { object: session } }, catalog, checkoutOptions(session)), /account binding/i);
  assert.equal(repo.credits, 0);
});

test('API key authentication hashes credentials and fails closed', async () => {
  const raw = 'sg_' + 'a'.repeat(48);
  const digest = await hashApiKey(raw);
  let lookup;
  const repo = { async findAccountByKeyDigest(value) { lookup = value; return { id: 'acct_1', active: true }; } };
  assert.equal((await authenticateApiKey(repo, raw)).id, 'acct_1');
  assert.equal(lookup, digest);
  await assert.rejects(() => authenticateApiKey(repo, 'bad'), /invalid api key/i);
  await assert.rejects(() => authenticateApiKey({ async findAccountByKeyDigest() { return { id: 'acct_1', active: 0 }; } }, raw), /invalid api key/i);
});

test('raw API keys never appear in structured logs', async () => {
  const raw = 'sg_' + 'b'.repeat(48);
  const lines = [];
  const logger = { info(event, fields) { lines.push(JSON.stringify({ event, ...fields })); } };
  const repo = { async applyStripeEventOnce() { return { replayed: false }; } };
  await processStripeEvent(repo, { id: 'evt_log', type: 'checkout.session.completed', data: { object: { id: 'cs_1' } } }, catalog,
    checkoutOptions(validSession(), { logger, issueCredential: async () => ({ id: 'cred', digest: 'digest', suffix: 'suffix' }) }));
  assert.equal(lines.join('\n').includes(raw), false);
});

test('refund and subscription cancellation revoke by verified customer binding', async () => {
  const commands = [];
  const repo = { async applyStripeEventOnce(_id, command) { commands.push(command); return { replayed: false }; } };
  await processStripeEvent(repo, { id: 'evt_refund', type: 'charge.refunded', data: { object: { customer: 'cus_1' } } }, catalog);
  await processStripeEvent(repo, { id: 'evt_cancel', type: 'customer.subscription.deleted', data: { object: { customer: 'cus_1' } } }, catalog);
  assert.deepEqual(commands.map(command => command.kind), ['revoke', 'revoke']);
});

test('payment failure and past_due subscription start a seven-day grace period', async () => {
  const commands = [];
  const repo = { async applyStripeEventOnce(_id, command) { commands.push(command); return { replayed: false }; } };
  const now = Date.parse('2026-01-01T00:00:00.000Z');
  await processStripeEvent(repo, { id: 'evt_failed', type: 'invoice.payment_failed', data: { object: { customer: 'cus_1' } } }, catalog, { now: () => now });
  await processStripeEvent(repo, { id: 'evt_past_due', type: 'customer.subscription.updated', data: { object: { customer: 'cus_1', status: 'past_due' } } }, catalog, { now: () => now });
  assert.deepEqual(commands.map(command => command.kind), ['past_due', 'past_due']);
  assert.deepEqual(commands.map(command => command.graceUntil), [now / 1000 + 7 * 86_400, now / 1000 + 7 * 86_400]);
});

test('paid invoice restores access and resets the billing period', async () => {
  let command;
  const repo = { async applyStripeEventOnce(_id, value) { command = value; return { replayed: false }; } };
  await processStripeEvent(repo, { id: 'evt_paid', type: 'invoice.paid', data: { object: {
    customer: 'cus_1', period_start: 100, period_end: 200,
  } } }, catalog);
  assert.deepEqual(command, { kind: 'renew', customerId: 'cus_1', periodStart: 100, periodEnd: 200 });
});
