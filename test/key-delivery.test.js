import test from 'node:test';
import assert from 'node:assert/strict';
import {
  claimAndDecryptApiKey,
  decryptApiKeyDelivery,
  encryptApiKeyDelivery,
} from '../src/billing/key-delivery.js';

const secret = new Uint8Array(32).fill(7);
const rawKey = `sg_${'ab'.repeat(24)}`;

test('AES-GCM delivery encrypts a key and binds it to account and Checkout Session', async () => {
  const envelope = await encryptApiKeyDelivery(rawKey, {
    secret,
    accountId: 'acct_1',
    checkoutSessionId: 'cs_1',
    expiresAt: 1_800,
  });

  assert.equal(envelope.iv.byteLength, 12);
  assert.equal(envelope.encryptedKey instanceof Uint8Array, true);
  assert.equal(new TextDecoder().decode(envelope.encryptedKey).includes(rawKey), false);
  assert.equal(await decryptApiKeyDelivery(envelope, {
    secret,
    accountId: 'acct_1',
    checkoutSessionId: 'cs_1',
    now: 1_799,
  }), rawKey);
  await assert.rejects(() => decryptApiKeyDelivery(envelope, {
    secret,
    accountId: 'acct_other',
    checkoutSessionId: 'cs_1',
    now: 1_799,
  }));
  await assert.rejects(() => decryptApiKeyDelivery(envelope, {
    secret,
    accountId: 'acct_1',
    checkoutSessionId: 'cs_other',
    now: 1_799,
  }));
  await assert.rejects(() => decryptApiKeyDelivery({ ...envelope, expiresAt: 1_900 }, {
    secret,
    accountId: 'acct_1',
    checkoutSessionId: 'cs_1',
    now: 1_799,
  }));
});

test('delivery rejects secrets that are not exactly 32 bytes', async () => {
  for (const length of [0, 31, 33]) {
    await assert.rejects(() => encryptApiKeyDelivery(rawKey, {
      secret: new Uint8Array(length),
      accountId: 'acct_1',
      checkoutSessionId: 'cs_1',
      expiresAt: 1_800,
    }), /32 bytes/i);
  }
});

test('delivery decryption fails closed at expiry', async () => {
  const envelope = await encryptApiKeyDelivery(rawKey, {
    secret,
    accountId: 'acct_1',
    checkoutSessionId: 'cs_1',
    expiresAt: 1_800,
  });
  await assert.rejects(() => decryptApiKeyDelivery(envelope, {
    secret,
    accountId: 'acct_1',
    checkoutSessionId: 'cs_1',
    now: 1_800,
  }), /expired/i);
});

test('claim seam atomically consumes before decrypting and returns no key on replay', async () => {
  const envelope = await encryptApiKeyDelivery(rawKey, {
    secret,
    accountId: 'acct_1',
    checkoutSessionId: 'cs_1',
    expiresAt: 1_800,
  });
  let available = true;
  const repository = {
    async claimKeyDeliveryOnce(checkoutSessionId, accountId, now) {
      assert.deepEqual([checkoutSessionId, accountId, now], ['cs_1', 'acct_1', 1_700]);
      if (!available) return null;
      available = false;
      return envelope;
    },
  };

  assert.equal(await claimAndDecryptApiKey(repository, {
    secret,
    accountId: 'acct_1',
    checkoutSessionId: 'cs_1',
    now: 1_700,
  }), rawKey);
  assert.equal(await claimAndDecryptApiKey(repository, {
    secret,
    accountId: 'acct_1',
    checkoutSessionId: 'cs_1',
    now: 1_700,
  }), null);
});
