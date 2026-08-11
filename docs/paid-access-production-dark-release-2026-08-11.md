# Paid-access production-dark release — 2026-08-11

Status: **D1 MIGRATED; WORKER DARK-DEPLOYED; PAID ACCESS DISABLED**

## Operator authority

Adam authorized the local production migration package, remote D1 application after it passed, and required Cloudflare/Stripe CLI work. The release train must avoid repeated confidence loops and stop only on material failures or human/vendor gates.

## One full release gate

Passed once before migration/deploy:

- Worker/Node: 81 passed;
- React/Vitest: 5 passed;
- TypeScript and JavaScript checks: passed;
- Vite production build: passed;
- npm audit including development dependencies: 0 vulnerabilities;
- npm audit production-only: 0 vulnerabilities;
- disposable production-code D1 rehearsal: passed;
- Wrangler deploy dry-run: passed;
- `git diff --check`: passed.

## Production D1

Applied `0001_transactional_billing.sql` after:

- aggregate preflight reconfirmed zero legacy users, plaintext keys, and Stripe-bound rows;
- remote migration list showed only the intended migration;
- Cloudflare D1 Time Travel bookmark was captured;
- a mode-600 SQL export and SHA-256 were stored outside the repository.

Post-apply:

- secure authority tables: 5;
- legacy `users` tables: 0;
- plaintext API-key columns: 0;
- rows in each authority table: 0;
- foreign-key violations: 0;
- pending migrations: 0.

Exact recovery identifiers are stored only in `/home/adam/.hermes/backups/spydergoat/pre-paid-access-recovery-20260811.md`.

## Production-dark Worker

Cloudflare Worker version: `9dad18c2-66cd-4951-ae98-52b9c8daa84a`

Packaged posture:

- `PAID_ACCESS_ENABLED=false`;
- live-mode catalog identifiers and exact $4.89 amount configured;
- exact apex/www Checkout origins configured;
- 32-byte delivery encryption secret added as a Cloudflare secret;
- existing Stripe secret and webhook-secret bindings preserved;
- wallet remains unexposed and disabled.

Live smoke receipts:

- apex homepage: 200;
- www homepage: 200;
- free MJD API: 200;
- paid Checkout: stable 503 `paid_access_paused`;
- webhook: 503 `paid_access_paused`;
- success/key-delivery route: 503, `no-store, private`, `no-referrer`;
- plaintext-key scan of live response bodies: no match.

## Stripe state and current human gate

Read-only live Stripe inspection found:

- active SpyderGoat Pro product;
- active $4.89 monthly licensed recurring price;
- all SpyderGoat Payment Links inactive;
- the only active Payment Link belongs to a separate ResumeVita product and was untouched;
- existing `https://spydergoat.com/webhook` endpoint is enabled.

Two live Stripe corrections remain blocked by defective CLI write authorization:

1. replace stale “no rate limits” product description with exact 5,000-period wording;
2. add `customer.subscription.updated` and `invoice.payment_failed` to the webhook endpoint.

Several CLI write attempts returned empty objects and made no mutation; readback proved no change. Stripe CLI browser re-authentication then succeeded, but CLI writes still no-op and direct use of the newly issued live restricted key returns 401. The authenticated Dashboard must be used manually unless Stripe CLI write access is repaired. Paid access remains disabled, so this is fail-closed.

## Publication posture

The Worker and D1 are live in production-dark posture. Repository changes are local and uncommitted/unpushed. Paid acceptance remains disabled until Stripe write access, webhook lifecycle coverage, and one real Checkout/fulfillment/key-claim path are proven.
