# Paid-access production D1 inventory — 2026-08-11

Status: **PASS — read-only inventory; zero customer rows found**

Authority: Adam authorized read-only production D1 inventory with an expected legitimate paid population of at most one historical self-customer. Adam reported receiving no outside customer payments; his own historical Stripe payments are supported by bank receipts outside this repository. Those financial receipts were not inspected in this inventory.

## Scope and privacy

Inspected only schema/index definitions, Wrangler migration status, and aggregate counts. No API key, Stripe customer ID, customer record, email, payment value, or other row content was selected or printed.

No D1 mutation, migration, backup, Stripe action, secret change, deploy, DNS change, or payment action was performed.

## Production schema

The remote `spydergoat-db` contains:

- Cloudflare internal table `_cf_KV`;
- legacy table `users`;
- legacy index `idx_users_api_key`.

The legacy table definition includes plaintext `users.api_key` authority, matching the archived obsolete schema. The new secure tables (`accounts`, `api_credentials`, `stripe_events`, `wallet_ledger`, and `key_deliveries`) do not exist remotely.

## Aggregate counts

```json
{
  "total_users": 0,
  "plaintext_key_rows": 0,
  "distinct_plaintext_keys": 0,
  "stripe_bound_rows": 0,
  "distinct_stripe_customers": 0
}
```

Because `users` is empty, aggregate nonzero-wallet, usage, and missing-timestamp sums returned SQL `NULL`; there were no rows to classify.

## Migration state

Wrangler reports `0001_transactional_billing.local.sql` as pending remotely. No repository migration has been applied through Wrangler migration tracking.

## Interpretation

- There is **no evidence of unauthorized D1-backed paid users**: observed population is zero, not greater than Adam’s expected maximum of one.
- There is also **no D1 record of Adam’s historical self-customer/key**. The database cannot prove or reconstruct that entitlement.
- This inventory does not prove whether the free endpoint was used, whether historical traffic occurred, or whether any authorization path outside this D1 database existed. Those questions require separate logs/configuration evidence.
- Since the legacy table is empty, no customer, key, wallet, period, or usage data needs conversion. The safe production path is a fail-closed replacement migration that refuses to proceed if `users` is nonempty at apply time, removes the empty plaintext schema, and creates the reviewed secure schema.

## Read-only receipts

Schema query metadata reported:

- `changes: 0`;
- `changed_db: false`;
- `rows_written: 0`.

Aggregate count query metadata reported:

- `changes: 0`;
- `changed_db: false`;
- `rows_written: 0`.

A direct count attempt against Cloudflare’s protected `_cf_KV` table was rejected with `SQLITE_AUTH`; no write occurred. Wrangler’s supported migration-list command was used instead.

## Next bounded build slice

Author and locally rehearse an immutable production migration that:

1. fails if the legacy `users` table contains any row;
2. removes the empty legacy plaintext-key index/table;
3. creates only the reviewed secure authority schema;
4. runs through Wrangler migration tracking;
5. proves a second migration invocation has nothing pending;
6. includes preflight, backup, post-apply verification, abort, and forward-fix receipts;
7. remains unapplied remotely until separately authorized.
