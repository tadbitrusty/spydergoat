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

test('D1 pending account creation fails when no new row was inserted', async () => {
  const db = { prepare() { return { bind() { return { async run() { return { success: true, meta: { changes: 0 } }; } }; } }; } };
  await assert.rejects(() => new D1BillingRepository(db).createPendingAccount('acct_collision'), /not created/i);
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

test('D1 checkout failure fails when no pending row transitioned', async () => {
  const db = { prepare() { return { bind() { return { async run() { return { success: true, meta: { changes: 0 } }; } }; } }; } };
  await assert.rejects(() => new D1BillingRepository(db).markCheckoutFailed('acct_missing'), /not recorded/i);
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

test('D1 provisioning atomically stores digest-only credential and encrypted delivery before processing', async () => {
  const statements = [];
  const db = {
    prepare(sql) { return { bind(...args) { const value = { sql, args }; statements.push(value); return value; } }; },
    async batch(batch) { return batch.map(() => ({ success: true, meta: { changes: 1 } })); },
  };
  const result = await new D1BillingRepository(db).applyStripeEventOnce('evt_1', {
    kind: 'provision', accountId: 'acct_1', customerId: 'cus_1', checkoutSessionId: 'cs_1', credentialId: 'cred_1',
    keyDigest: 'digest-only', displaySuffix: '1234abcd', encryptedKey: new Uint8Array([1, 2, 3]),
    iv: new Uint8Array(12).fill(4), deliveryExpiresAt: 1_600,
  });
  assert.equal(result.replayed, false);
  const sql = statements.map(value => value.sql).join('\n');
  assert.match(sql, /INSERT INTO accounts/i);
  assert.match(sql, /ON CONFLICT\s*\(id\) DO UPDATE/i);
  assert.match(sql, /INSERT INTO api_credentials/i);
  assert.match(sql, /INSERT INTO key_deliveries/i);
  assert.doesNotMatch(sql, /INSERT OR IGNORE INTO (api_credentials|key_deliveries)/i);
  assert.doesNotMatch(sql, /plaintext|raw_key/i);
  assert.equal(statements.some(value => value.args.includes('digest-only')), true);
  assert.equal(statements.some(value => value.args.includes('1234abcd')), true);
  assert.equal(statements.some(value => value.args.some(arg => typeof arg === 'string' && arg.startsWith('sg_'))), false);
});

test('D1 one-time delivery claim is one conditional UPDATE with RETURNING', async () => {
  const log = [];
  const encryptedKey = new Uint8Array([1, 2, 3]);
  const iv = new Uint8Array(12).fill(4);
  const db = { prepare(sql) { return statement(sql, log, { encrypted_key: encryptedKey, iv, expires_at: 1_800 }); } };
  const result = await new D1BillingRepository(db).claimKeyDeliveryOnce('cs_1', 'acct_1', 1_700);
  assert.deepEqual(result, { encryptedKey, iv, expiresAt: 1_800 });
  assert.match(log[0].sql, /UPDATE key_deliveries/i);
  assert.match(log[0].sql, /consumed_at IS NULL/i);
  assert.match(log[0].sql, /expires_at > /i);
  assert.match(log[0].sql, /RETURNING encrypted_key, iv, expires_at/i);
  assert.deepEqual(log[0].args, [1_700, 'cs_1', 'acct_1']);
});
