# Paid-access disposable D1 rehearsal — 2026-08-11

Status: **PASS — local only**

This is evidence for the local candidate, not authorization to migrate, deploy, configure Stripe, expose secrets, or accept payment.

## Command

```bash
npm run rehearse:d1
```

The script creates an in-memory Miniflare D1 database, applies `migrations/0001_transactional_billing.local.sql`, uses the production billing service and D1 repository, asserts the flow, then disposes the database.

## Proven locally

- pending account becomes active only through claimed Checkout fulfillment;
- only a SHA-256 credential digest and display suffix persist as key authority;
- duplicate Checkout completion creates no second credential;
- encrypted delivery decrypts once and replay returns no key;
- D1-returned BLOB byte arrays are normalized before Web Crypto use;
- digest authentication resolves the active account;
- call 5,000 succeeds and call 5,001 fails inside the proven period;
- wallet balance remains unchanged;
- authenticated renewal resets period calls without resetting wallet;
- authenticated cancellation disables the credential;
- the schema contains no plaintext API-key column.

## Receipt

```json
{"status":"PASS","migration":"applied","checkout":"pending-to-active","credentialAuthority":"sha256-digest-only","delivery":"one-time-and-replay-closed","allowance":"5000-exact-wallet-unchanged","lifecycle":"renewal-reset-and-cancellation-disable"}
```

No remote D1 database, Stripe account, Cloudflare deployment, production secret, or real payment was touched.
