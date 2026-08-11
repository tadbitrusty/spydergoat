import test from 'node:test';
import assert from 'node:assert/strict';
import {
  authenticateApiKey,
  consumePaidRequest,
  createProCheckout,
  generateApiKey,
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
    customer: 'cus_1',
    subscription: { id: 'sub_1', status: 'active', current_period_start: 1_000, current_period_end: 2_000, metadata: { spydergoat_account_id: 'acct_1', spydergoat_sku: 'subscription' } },
    amount_total: 489, currency: 'usd', client_reference_id: 'acct_1',
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

test('checkout validation accepts Stripe item-level billing periods from the live API schema', () => {
  const session = validSession();
  session.subscription = {
    ...session.subscription,
    current_period_start: null,
    current_period_end: null,
    items: { data: [{
      quantity: 1,
      current_period_start: 1_000,
      current_period_end: 2_000,
      price: { id: 'price_pro', product: 'prod_pro' },
    }] },
  };
  const result = validateCheckoutSession(session, catalog, { livemode: false, accountId: 'acct_1' });
  assert.equal(result.ok, true);
  assert.equal(result.periodStart, 1_000);
  assert.equal(result.periodEnd, 2_000);
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
      return { allowed: false, reason: 'period_exhausted' };
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

test('concurrent Pro allowance accounting stops exactly at 5,000 and never spends parked wallet', async () => {
  const repo = new AtomicRepository({ calls: 4999, wallet: 1 });
  const results = await Promise.all([consumePaidRequest(repo, 'acct_1'), consumePaidRequest(repo, 'acct_1'), consumePaidRequest(repo, 'acct_1')]);
  assert.deepEqual(results.map(x => x.allowed), [true, false, false]);
  assert.equal(repo.calls, 5000);
  assert.equal(repo.wallet, 1);
});

test('duplicate subscription event does not regenerate or rotate key material', async () => {
  const commands = [];
  let randomCalls = 0;
  const repo = {
    seen: false,
    async hasStripeEvent() { return this.seen; },
    async applyStripeEventOnce(eventId, command) {
      commands.push(command);
      this.seen = true;
      return { replayed: false };
    },
  };
  const event = { id: 'evt_sub', created: 1_000, livemode: false, type: 'checkout.session.completed', data: { object: validSession() } };
  const options = {
    livemode: false, deliverySecret: new Uint8Array(32).fill(9), now: () => 1_000,
    fillRandom(bytes) { randomCalls++; bytes.fill(0xab); return bytes; },
  };
  assert.equal((await processStripeEvent(repo, event, catalog, options)).replayed, false);
  assert.equal((await processStripeEvent(repo, event, catalog, options)).replayed, true);
  assert.equal(commands.length, 1);
  assert.equal(randomCalls, 1);
  assert.equal(commands[0].kind, 'provision');
  assert.equal(commands[0].accountId, 'acct_1');
  assert.equal(commands[0].checkoutSessionId, 'cs_1');
  assert.match(commands[0].credentialId, /^cred_/);
  assert.match(commands[0].keyDigest, /^[0-9a-f]{64}$/);
  assert.match(commands[0].displaySuffix, /^[0-9a-f]{8}$/);
  assert.equal(commands[0].deliveryExpiresAt, 1_600);
  assert.equal(commands[0].encryptedKey instanceof Uint8Array, true);
  assert.equal(commands[0].iv.byteLength, 12);
  assert.equal(JSON.stringify(commands[0]).includes('sg_'), false);
});

test('checkout fulfillment requires the pre-created pending account before key generation', async () => {
  let randomTouched = false;
  const repo = {
    async hasStripeEvent() { return false; },
    async hasPendingAccount() { return false; },
    async applyStripeEventOnce() { throw new Error('must not apply'); },
  };
  await assert.rejects(() => processStripeEvent(repo, {
    id: 'evt_unbound', created: 1_000, livemode: false, type: 'checkout.session.completed', data: { object: validSession() },
  }, catalog, {
    livemode: false, deliverySecret: new Uint8Array(32).fill(9),
    fillRandom(bytes) { randomTouched = true; return bytes; },
  }), /account authority/i);
  assert.equal(randomTouched, false);
});

test('API key generation uses 24 random bytes for sg_ plus 48 lowercase hex characters', () => {
  let requested;
  const key = generateApiKey(bytes => {
    requested = bytes.byteLength;
    bytes.fill(0xab);
    return bytes;
  });
  assert.equal(requested, 24);
  assert.equal(key, `sg_${'ab'.repeat(24)}`);
});

test('malformed checkout event without an id fails closed', async () => {
  const repo = new AtomicRepository();
  await assert.rejects(
    () => processStripeEvent(repo, { type: 'checkout.session.completed', data: { object: validSession() } }, catalog, { livemode: false }),
    /event id/i,
  );
});

test('top-up Checkout remains fail-closed in the Pro-first runtime', async () => {
  const repo = new AtomicRepository();
  const session = validSession({
    mode: 'payment', amount_total: 100,
    metadata: { spydergoat_sku: 'topup_1000', spydergoat_account_id: 'acct_1' },
    line_items: { data: [{ quantity: 1, price: { id: 'price_1k', product: 'prod_1k', unit_amount: 100, currency: 'usd' } }] },
  });
  const event = { id: 'evt_topup', created: 1_000, livemode: false, type: 'checkout.session.completed', data: { object: session } };
  await assert.rejects(() => processStripeEvent(repo, event, catalog, { livemode: false }), /failed closed/i);
  assert.equal(repo.credits, 0);
});

test('top-up without deterministic account binding fails closed', async () => {
  const repo = new AtomicRepository();
  const session = validSession({ mode: 'payment', amount_total: 100, metadata: { spydergoat_sku: 'topup_1000' }, line_items: { data: [{ quantity: 1, price: { id: 'price_1k', product: 'prod_1k', unit_amount: 100, currency: 'usd' } }] } });
  await assert.rejects(() => processStripeEvent(repo, { id: 'evt_bad', created: 1_000, livemode: false, type: 'checkout.session.completed', data: { object: session } }, catalog, { livemode: false }), /account binding|failed closed/i);
  assert.equal(repo.credits, 0);
});

test('API key authentication hashes credentials and requires an in-period entitlement', async () => {
  const raw = `sg_${'ab'.repeat(24)}`;
  const digest = await hashApiKey(raw);
  let lookup;
  const repo = { async findAccountByKeyDigest(...value) { lookup = value; return { id: 'acct_1', active: true }; } };
  assert.equal((await authenticateApiKey(repo, raw, 1_500)).id, 'acct_1');
  assert.deepEqual(lookup, [digest, 1_500]);
  await assert.rejects(() => authenticateApiKey(repo, 'bad', 1_500), /Invalid API key/);
  await assert.rejects(() => authenticateApiKey({ async findAccountByKeyDigest() { return { id: 'acct_1', active: 0 }; } }, raw, 1_500), /Invalid API key/);
  await assert.rejects(() => authenticateApiKey(repo, raw), /Invalid API key/);
});

test('generated plaintext API key never appears in structured logs', async () => {
  const raw = `sg_${'bb'.repeat(24)}`;
  const lines = [];
  const logger = { info(event, fields) { lines.push(JSON.stringify({ event, ...fields })); } };
  const repo = { async hasStripeEvent() { return false; }, async applyStripeEventOnce() { return { replayed: false }; } };
  await processStripeEvent(repo, { id: 'evt_log', created: 1_000, livemode: false, type: 'checkout.session.completed', data: { object: validSession() } }, catalog, {
    livemode: false,
    logger,
    deliverySecret: new Uint8Array(32).fill(8),
    fillRandom(bytes) { bytes.fill(0xbb); return bytes; },
  });
  assert.equal(lines.join('\n').includes(raw), false);
});

test('checkout provisioning persists authoritative subscription and event ordering fields', async () => {
  let command;
  const repo = { async applyStripeEventOnce(_id, value) { command = value; return { replayed: false }; } };
  await processStripeEvent(repo, { id: 'evt_checkout', created: 1_100, livemode: false, type: 'checkout.session.completed', data: { object: validSession() } }, catalog, {
    livemode: false, deliverySecret: new Uint8Array(32).fill(7), now: () => 1_100,
  });
  assert.equal(command.subscriptionId, 'sub_1');
  assert.equal(command.periodStart, 1_000);
  assert.equal(command.periodEnd, 2_000);
  assert.equal(command.eventCreated, 1_100);
});

test('subscription lifecycle preserves paid access through cancellation period end and disables failed payment', async () => {
  const commands = [];
  const repo = { async applyStripeEventOnce(_id, command) { commands.push(command); return { replayed: false }; } };
  const metadata = { spydergoat_account_id: 'acct_1', spydergoat_sku: 'subscription' };
  await processStripeEvent(repo, { id: 'evt_failed', created: 1_200, livemode: false, type: 'invoice.payment_failed', data: { object: { id: 'in_1', subscription: 'sub_1', customer: 'cus_1', status: 'open', paid: false, subscription_details: { metadata } } } }, catalog, { livemode: false });
  await processStripeEvent(repo, { id: 'evt_deleted', created: 1_300, livemode: false, type: 'customer.subscription.deleted', data: { object: { id: 'sub_1', customer: 'cus_1', status: 'canceled', current_period_start: 1_000, current_period_end: 2_000, metadata } } }, catalog, { livemode: false });
  assert.deepEqual(commands.map(value => [value.kind, value.status, value.resetPeriodCalls]), [
    ['lifecycle', 'past_due', false],
    ['lifecycle', 'canceled', false],
  ]);
  assert.equal(commands[1].periodEnd, 2_000);
  assert.equal(commands[1].preserveActiveUntilPeriodEnd, true);
});

test('subscription lifecycle accepts Stripe item-level billing periods from the live API schema', async () => {
  const commands = [];
  const repo = { async applyStripeEventOnce(_id, command) { commands.push(command); return { replayed: false }; } };
  const metadata = { spydergoat_account_id: 'acct_1', spydergoat_sku: 'subscription' };
  await processStripeEvent(repo, {
    id: 'evt_updated_items', created: 1_200, livemode: false, type: 'customer.subscription.updated',
    data: { object: {
      id: 'sub_1', customer: 'cus_1', status: 'active', metadata,
      current_period_start: null, current_period_end: null,
      items: { data: [{
        quantity: 1, current_period_start: 1_000, current_period_end: 2_000,
        price: { id: 'price_pro', product: 'prod_pro' },
      }] },
    } },
  }, catalog, { livemode: false });
  assert.equal(commands[0].periodStart, 1_000);
  assert.equal(commands[0].periodEnd, 2_000);
  assert.equal(commands[0].resetPeriodCalls, true);
});

test('subscription deletion at the paid period boundary disables entitlement', async () => {
  let command;
  const repo = { async applyStripeEventOnce(_id, value) { command = value; return { replayed: false }; } };
  const metadata = { spydergoat_account_id: 'acct_1', spydergoat_sku: 'subscription' };
  await processStripeEvent(repo, {
    id: 'evt_deleted_at_end', created: 2_000, livemode: false, type: 'customer.subscription.deleted',
    data: { object: { id: 'sub_1', customer: 'cus_1', status: 'canceled', current_period_start: 1_000, current_period_end: 2_000, metadata } },
  }, catalog, { livemode: false });
  assert.equal(command.status, 'canceled');
  assert.equal(command.preserveActiveUntilPeriodEnd, false);
});

test('lifecycle processing rejects Stripe events from the wrong livemode', async () => {
  let touched = false;
  const repo = { async applyStripeEventOnce() { touched = true; } };
  const metadata = { spydergoat_account_id: 'acct_1', spydergoat_sku: 'subscription' };
  await assert.rejects(() => processStripeEvent(repo, {
    id: 'evt_wrong_mode', created: 1_200, livemode: false, type: 'customer.subscription.updated',
    data: { object: { id: 'sub_1', customer: 'cus_1', status: 'active', current_period_start: 1_000, current_period_end: 2_000, metadata } },
  }, catalog, { livemode: true }), /livemode/i);
  assert.equal(touched, false);
});

test('lifecycle processing rejects a missing account/customer/subscription authority match', async () => {
  let touched = false;
  const repo = {
    async hasLifecycleAuthority() { return false; },
    async applyStripeEventOnce() { touched = true; },
  };
  const metadata = { spydergoat_account_id: 'acct_1', spydergoat_sku: 'subscription' };
  await assert.rejects(() => processStripeEvent(repo, {
    id: 'evt_unbound_lifecycle', created: 1_200, livemode: false, type: 'customer.subscription.updated',
    data: { object: { id: 'sub_1', customer: 'cus_1', status: 'active', current_period_start: 1_000, current_period_end: 2_000, metadata } },
  }, catalog, { livemode: false }), /account authority/i);
  assert.equal(touched, false);
});

test('paid renewal resets period calls but never changes wallet balance', async () => {
  let command;
  const repo = { async applyStripeEventOnce(_id, value) { command = value; return { replayed: false }; } };
  const metadata = { spydergoat_account_id: 'acct_1', spydergoat_sku: 'subscription' };
  await processStripeEvent(repo, { id: 'evt_renewal', created: 2_100, livemode: false, type: 'invoice.paid', data: { object: {
    id: 'in_1', subscription: 'sub_1', customer: 'cus_1', status: 'paid', paid: true, billing_reason: 'subscription_cycle',
    subscription_details: { metadata }, lines: { data: [{ type: 'subscription', period: { start: 2_000, end: 3_000 }, subscription: 'sub_1' }] },
  } } }, catalog, { livemode: false });
  assert.equal(command.resetPeriodCalls, true);
  assert.equal(command.periodStart, 2_000);
  assert.equal(command.periodEnd, 3_000);
  assert.equal('walletBalance' in command, false);
});

test('unknown Stripe events return ignored without touching the repository', async () => {
  let touched = false;
  const result = await processStripeEvent({ async applyStripeEventOnce() { touched = true; } }, { type: 'charge.succeeded' }, catalog);
  assert.deepEqual(result, { ignored: true });
  assert.equal(touched, false);
});
