import test from 'node:test';
import assert from 'node:assert/strict';
import {
  authenticateApiKey,
  consumePaidRequest,
  createProCheckout,
  hashApiKey,
  processStripeEvent,
  validateCheckoutSession,
} from '../src/billing/service.js';

const catalog = {
  subscription: { mode: 'subscription', product: 'prod_pro', price: 'price_pro', currency: 'usd', amount: 489 },
  topup_1000: { mode: 'payment', product: 'prod_1k', price: 'price_1k', currency: 'usd', amount: 100, credits: 1000 },
};

function validSession(overrides = {}) {
  return {
    id: 'cs_1', mode: 'subscription', payment_status: 'paid', status: 'complete', livemode: false,
    customer: 'cus_1', amount_total: 489, currency: 'usd',
    metadata: { spydergoat_sku: 'subscription', spydergoat_account_id: 'acct_1' },
    line_items: { data: [{ quantity: 1, price: { id: 'price_pro', product: 'prod_pro', unit_amount: 489, currency: 'usd' } }] },
    ...overrides,
  };
}

test('Pro checkout creates the bound pending account before contacting Stripe', async () => {
  const order = [];
  const repository = {
    async createPendingAccount(accountId) {
      order.push(['account', accountId]);
    },
  };
  const stripe = {
    async createCheckoutSession(command) {
      order.push(['stripe', command]);
      return { id: 'cs_test_1', url: 'https://checkout.stripe.com/c/pay/cs_test_1' };
    },
  };

  const result = await createProCheckout(repository, stripe, catalog, {
    generateAccountId: () => 'acct_fixed',
    successUrl: 'https://spydergoat.test/success?session_id={CHECKOUT_SESSION_ID}',
    cancelUrl: 'https://spydergoat.test/#pricing',
  });

  assert.equal(result.accountId, 'acct_fixed');
  assert.equal(result.checkoutUrl, 'https://checkout.stripe.com/c/pay/cs_test_1');
  assert.deepEqual(order[0], ['account', 'acct_fixed']);
  assert.equal(order[1][0], 'stripe');
  assert.deepEqual(order[1][1], {
    accountId: 'acct_fixed',
    sku: 'subscription',
    mode: 'subscription',
    priceId: 'price_pro',
    productId: 'prod_pro',
    currency: 'usd',
    amount: 489,
    successUrl: 'https://spydergoat.test/success?session_id={CHECKOUT_SESSION_ID}',
    cancelUrl: 'https://spydergoat.test/#pricing',
  });
});

test('Pro checkout marks the pending account failed when Stripe cannot create a session', async () => {
  const states = [];
  const repository = {
    async createPendingAccount(accountId) { states.push(['pending', accountId]); },
    async markCheckoutFailed(accountId) { states.push(['failed', accountId]); },
  };
  const stripe = { async createCheckoutSession() { throw new Error('Stripe unavailable'); } };

  await assert.rejects(
    () => createProCheckout(repository, stripe, catalog, {
      generateAccountId: () => 'acct_fixed',
      successUrl: 'https://spydergoat.test/success',
      cancelUrl: 'https://spydergoat.test/#pricing',
    }),
    /Stripe unavailable/,
  );
  assert.deepEqual(states, [['pending', 'acct_fixed'], ['failed', 'acct_fixed']]);
});

test('Pro checkout fails closed before account creation when catalog is unavailable', async () => {
  let touched = false;
  const repository = { async createPendingAccount() { touched = true; } };
  await assert.rejects(
    () => createProCheckout(repository, {}, {}, {
      generateAccountId: () => 'acct_fixed',
      successUrl: 'https://spydergoat.test/success',
      cancelUrl: 'https://spydergoat.test/#pricing',
    }),
    /Pro checkout is not configured/i,
  );
  assert.equal(touched, false);
});

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
  ['wrong amount', { amount_total: 488 }],
  ['missing customer', { customer: null }],
  ['wrong account binding', { metadata: { spydergoat_sku: 'subscription', spydergoat_account_id: 'acct_other' } }],
]) {
  test(`checkout validation fails closed for ${name}`, () => {
    assert.equal(validateCheckoutSession(validSession(override), catalog, { livemode: false, accountId: 'acct_1' }).ok, false);
  });
}

test('checkout validation fails closed for wrong product and price', () => {
  const line_items = { data: [{ quantity: 1, price: { id: 'price_wrong', product: 'prod_wrong', unit_amount: 489, currency: 'usd' } }] };
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
  assert.equal((await processStripeEvent(repo, event, catalog, { livemode: false })).replayed, false);
  assert.equal((await processStripeEvent(repo, event, catalog, { livemode: false })).replayed, true);
  assert.equal(repo.keys, 1);
});

test('malformed checkout event without an id fails closed', async () => {
  const repo = new AtomicRepository();
  await assert.rejects(
    () => processStripeEvent(repo, { type: 'checkout.session.completed', data: { object: validSession() } }, catalog, { livemode: false }),
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
  await processStripeEvent(repo, event, catalog, { livemode: false });
  await processStripeEvent(repo, event, catalog, { livemode: false });
  assert.equal(repo.credits, 1000);
});

test('top-up without deterministic account binding fails closed', async () => {
  const repo = new AtomicRepository();
  const session = validSession({ mode: 'payment', amount_total: 100, metadata: { spydergoat_sku: 'topup_1000' }, line_items: { data: [{ quantity: 1, price: { id: 'price_1k', product: 'prod_1k', unit_amount: 100, currency: 'usd' } }] } });
  await assert.rejects(() => processStripeEvent(repo, { id: 'evt_bad', type: 'checkout.session.completed', data: { object: session } }, catalog, { livemode: false }), /account binding/i);
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
});

test('raw API keys never appear in structured logs', async () => {
  const raw = 'sg_' + 'b'.repeat(48);
  const lines = [];
  const logger = { info(event, fields) { lines.push(JSON.stringify({ event, ...fields })); } };
  const repo = { async applyStripeEventOnce() { return { replayed: false }; } };
  await processStripeEvent(repo, { id: 'evt_log', type: 'checkout.session.completed', data: { object: validSession() } }, catalog, { livemode: false, logger, generatedApiKey: raw });
  assert.equal(lines.join('\n').includes(raw), false);
});
