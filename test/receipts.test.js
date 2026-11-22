import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/api/worker.js';
import { createSignedReceipt, verifyReceipt } from '../src/receipts.js';

function base64url(bytes) {
  return Buffer.from(bytes).toString('base64url');
}

async function receiptBindings() {
  const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  const privateKey = base64url(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
  const publicKey = base64url(await crypto.subtle.exportKey('raw', pair.publicKey));
  const values = new Map();
  const stored = [];
  return {
    RECEIPT_PRIVATE_KEY_PKCS8: privateKey,
    RECEIPT_KEY_ID: 'test-2026',
    RECEIPT_KEYRING: JSON.stringify([{
      key_id: 'test-2026', public_key: publicKey,
      valid_from: '2020-01-01T00:00:00.000Z', valid_to: '2035-01-01T00:00:00.000Z', revoked: false,
    }]),
    SPYDERGOAT_KV: {
      async get(key) { return values.get(key) ?? null; },
      async put(key, value) { values.set(key, value); },
    },
    DB: {
      prepare(sql) {
        return { bind(...args) { return { async run() { stored.push({ sql, args }); return { meta: { changes: 1 } }; } }; } };
      },
    },
    stored,
  };
}

function post(path, body, env) {
  return worker.fetch(new Request(`https://spydergoat.test${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'CF-Connecting-IP': '203.0.113.7' }, body: JSON.stringify(body),
  }), env, {});
}

test('receipt endpoint signs canonical hash-only receipts and verify accepts them', async () => {
  const env = await receiptBindings();
  const response = await post('/receipt', { sha256: 'A'.repeat(64) }, env);
  assert.equal(response.status, 200);
  const receipt = await response.json();
  assert.deepEqual(Object.keys(receipt), ['hash', 'utc', 'mjd', 'unix_ms', 'key_id', 'sig']);
  assert.equal(receipt.hash, 'a'.repeat(64));
  assert.equal((await verifyReceipt(receipt, env)).valid, true);
  assert.equal(env.stored.length, 1);
  assert.deepEqual(env.stored[0].args.slice(0, 2), ['a'.repeat(64), 'test-2026']);
  assert.equal(env.stored[0].args[3] - env.stored[0].args[2], 90 * 86_400);
  assert.equal(env.stored[0].args.some(value => typeof value === 'string' && value.includes('content')), false);

  const verifyResponse = await post('/verify', receipt, env);
  assert.equal(verifyResponse.status, 200);
  assert.deepEqual(await verifyResponse.json(), { valid: true });
});

test('receipt rejects content, malformed hashes, tampering, expired and revoked signing keys', async () => {
  const env = await receiptBindings();
  assert.equal((await post('/receipt', { sha256: 'a'.repeat(64), content: 'never accept me' }, env)).status, 400);
  assert.equal((await post('/receipt', { sha256: 'not-a-hash' }, env)).status, 400);

  const receipt = await createSignedReceipt('b'.repeat(64), env, Date.parse('2026-01-02T00:00:00.000Z'));
  assert.equal((await verifyReceipt({ ...receipt, hash: 'c'.repeat(64) }, env)).error, 'bad_signature');

  const key = JSON.parse(env.RECEIPT_KEYRING)[0];
  const expired = { ...key, valid_to: '2025-01-01T00:00:00.000Z' };
  assert.equal((await verifyReceipt(receipt, { ...env, RECEIPT_KEYRING: JSON.stringify([expired]) })).error, 'key_outside_validity');
  assert.equal((await verifyReceipt(receipt, { ...env, RECEIPT_KEYRING: JSON.stringify([{ ...key, revoked: true }]) })).error, 'revoked_key');
});

test('free receipt limit returns 429 on the eleventh call', async () => {
  const env = await receiptBindings();
  for (let index = 0; index < 10; index++) {
    assert.equal((await post('/receipt', { sha256: index.toString(16).padStart(64, '0') }, env)).status, 200);
  }
  const response = await post('/receipt', { sha256: 'f'.repeat(64) }, env);
  assert.equal(response.status, 429);
  assert.equal((await response.json()).error, 'rate_limited');
});

test('keys exposes public validity metadata but no private material', async () => {
  const env = await receiptBindings();
  const response = await worker.fetch(new Request('https://spydergoat.test/keys'), env, {});
  const text = await response.text();
  assert.equal(response.status, 200);
  assert.match(text, /valid_from/);
  assert.match(text, /revoked/);
  assert.doesNotMatch(text, /private/i);
  assert.equal(text.includes(env.RECEIPT_PRIVATE_KEY_PKCS8), false);
});
