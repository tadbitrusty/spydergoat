import test from 'node:test';
import assert from 'node:assert/strict';
import { D1BillingRepository } from '../src/billing/d1-repository.js';

function statement(sql, log, result) {
  return { bind(...args) { log.push({ sql, args }); return { async first() { return result; }, async run() { return { success: true, meta: { changes: result ? 1 : 0 } }; } }; } };
}

test('D1 allowance consumption is one conditional UPDATE with RETURNING', async () => {
  const log = [];
  const db = { prepare(sql) { return statement(sql, log, { current_period_calls: 5001, wallet_balance: 0 }); } };
  const result = await new D1BillingRepository(db).consumeAllowance('acct_1');
  assert.equal(result.allowed, true);
  assert.match(log[0].sql, /UPDATE accounts/i);
  assert.match(log[0].sql, /current_period_calls < 5000/i);
  assert.match(log[0].sql, /subscription_status = 'past_due'/i);
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
  const result = await new D1BillingRepository(db).applyStripeEventOnce('evt_1', {
    kind: 'provision', accountId: 'acct_1', customerId: 'cus_1', subscriptionId: 'sub_1', checkoutSessionId: 'cs_1',
    credential: { id: 'cred_1', digest: 'digest', suffix: 'suffix', encryptedKey: 'ciphertext', iv: 'iv', nonceDigest: 'nonce' },
  });
  assert.equal(result.replayed, false);
  assert.match(sql.join('\n'), /INSERT INTO accounts/i);
  assert.match(sql.join('\n'), /ON CONFLICT\s*\(id\) DO UPDATE/i);
});

test('D1 grace expiry revokes credentials and accounts in one batch', async () => {
  const sql = [];
  const db = {
    prepare(text) { sql.push(text); return { bind() { return { text }; } }; },
    async batch() { return [{ success: true, meta: { changes: 2 } }, { success: true, meta: { changes: 1 } }]; },
  };
  assert.equal(await new D1BillingRepository(db).revokeExpiredGrace(1234), 1);
  assert.match(sql.join('\n'), /grace_until <=/i);
  assert.match(sql.join('\n'), /subscription_status = 'revoked'/i);
});
