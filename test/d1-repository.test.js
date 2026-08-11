import test from 'node:test';
import assert from 'node:assert/strict';
import { D1BillingRepository } from '../src/billing/d1-repository.js';

function statement(sql, log, result) {
  return { bind(...args) { log.push({ sql, args }); return { async first() { return result; }, async run() { return { success: true, meta: { changes: result ? 1 : 0 } }; } }; } };
}

test('D1 pending account creation inserts an inactive account without Stripe authority', async () => {
  const log = [];
  const db = { prepare(sql) { return statement(sql, log, { id: 'acct_1' }); } };
  await new D1BillingRepository(db).createPendingAccount('acct_1');
  assert.match(log[0].sql, /INSERT INTO accounts/i);
  assert.match(log[0].sql, /subscription_status/i);
  assert.deepEqual(log[0].args, ['acct_1']);
  assert.doesNotMatch(log[0].sql, /'active'/i);
});

test('D1 checkout failure only transitions the matching pending account', async () => {
  const log = [];
  const db = { prepare(sql) { return statement(sql, log, { id: 'acct_1' }); } };
  await new D1BillingRepository(db).markCheckoutFailed('acct_1');
  assert.match(log[0].sql, /UPDATE accounts/i);
  assert.match(log[0].sql, /subscription_status = 'checkout_failed'/i);
  assert.match(log[0].sql, /subscription_status = 'pending'/i);
  assert.deepEqual(log[0].args, ['acct_1']);
});

test('D1 allowance consumption is one conditional UPDATE with RETURNING', async () => {
  const log = [];
  const db = { prepare(sql) { return statement(sql, log, { current_period_calls: 5001, wallet_balance: 0 }); } };
  const result = await new D1BillingRepository(db).consumeAllowance('acct_1');
  assert.equal(result.allowed, true);
  assert.match(log[0].sql, /UPDATE accounts/i);
  assert.match(log[0].sql, /wallet_balance = wallet_balance -/i);
  assert.match(log[0].sql, /RETURNING/i);
  assert.deepEqual(log[0].args, ['acct_1']);
});

test('D1 allowance consumption fails closed when no atomic row is available', async () => {
  const db = { prepare(sql) { return statement(sql, [], null); } };
  assert.deepEqual(await new D1BillingRepository(db).consumeAllowance('acct_1'), { allowed: false, reason: 'inactive_or_empty' });
});

test('D1 key lookup uses only the credential digest', async () => {
  const log = [];
  const db = { prepare(sql) { return statement(sql, log, { id: 'acct_1', active: 1 }); } };
  const account = await new D1BillingRepository(db).findAccountByKeyDigest('digest');
  assert.equal(account.id, 'acct_1');
  assert.match(log[0].sql, /api_credentials/i);
  assert.doesNotMatch(log[0].sql, /plaintext|api_key\s*=/i);
});

test('D1 provisioning upserts the bound account before marking the event processed', async () => {
  const sql = [];
  const db = {
    prepare(text) { sql.push(text); return { bind() { return { text }; } }; },
    async batch(statements) { return statements.map(() => ({ success: true, meta: { changes: 1 } })); },
  };
  const result = await new D1BillingRepository(db).applyStripeEventOnce('evt_1', { kind: 'provision', accountId: 'acct_1', customerId: 'cus_1' });
  assert.equal(result.replayed, false);
  assert.match(sql.join('\n'), /INSERT INTO accounts/i);
  assert.match(sql.join('\n'), /ON CONFLICT\s*\(id\) DO UPDATE/i);
});
