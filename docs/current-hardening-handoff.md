# SpyderGoat Current Hardening Handoff

**Updated:** 2026-08-11
**Branch:** `feature/paid-access-v1`
**Baseline:** tagged v1.1.1 plus current local paid-access work
**Posture:** production-dark release active; paid access explicitly disabled

## Authority

Adam’s 2026-08-11 decision is controlling: the React v1.1 refactor and deliberate hardening after it are the product source of truth. Pre-refactor v1 concepts are historical only.

Read in this order:

1. `BUILD_PLAN.md`
2. `docs/plans/2026-08-10-paid-access-rebuild.md`
3. this handoff
4. `README.md`
5. tagged release receipts and archive history

## Stable baseline

- React 19 + TypeScript + Vite frontend delivered through Worker Static Assets.
- Worker-generated server-time bootstrap with truthful browser fallback.
- `/mjd` and `/jd` public free APIs.
- Shared best-effort per-IP KV limit for free GETs.
- Quota-neutral API HEAD requests.
- Strict security headers, no public source maps, mobile/reduced-motion support.
- Paid UI and runtime fail closed by default.
- Product copy disclaims NTP, atomic-clock, signed-authority, accuracy-SLA, monotonicity, and measured-uptime claims.

## Current local slice

Current paid-access work implements Tasks 3–6 plus the bounded fresh-database runtime portion of Task 7 from the paid rebuild plan:

- API keys are generated as `sg_` plus 48 cryptographically random lowercase hex characters.
- SHA-256 digest is the only persisted authentication authority; D1 also stores an eight-character display suffix.
- The temporary copy is AES-GCM encrypted with an injected exactly-32-byte secret and a fresh 12-byte IV.
- Account ID, Checkout Session ID, and expiry are cryptographically bound as additional authenticated data.
- Delivery defaults to ten minutes and cannot be configured beyond fifteen minutes in this service seam.
- Account activation, credential insertion, encrypted delivery insertion, and Stripe event processing share one D1 batch guarded by the event claim.
- Checkout Session and one-active-key constraints reject duplicate issuance; delivery insertion requires the matching newly persisted digest.
- Delivery reads the unconsumed envelope, authenticates/decrypts it, then wins one conditional consume before returning plaintext; failed authentication does not burn the delivery and racing readers cannot both receive it.
- `/webhook` is wired only behind the explicit paid gate, a bounded streaming read that cancels when accumulated body bytes cross 64 KiB, exact raw-body Stripe signature verification, exact `STRIPE_LIVEMODE` configuration, and complete billing/secret configuration.
- Checkout fulfillment retrieves the authoritative expanded Stripe Session, requires the pre-created pending account, and binds the Stripe customer/subscription and event timestamp before key generation and activation.
- Subscription renewal, payment-failure, cancellation, and stale-event behavior is idempotent and ordered by authenticated `event.created`; same-second conflicts disable entitlement as `event_conflict` rather than guessing, and renewals reset calls without changing wallet balance.
- `/success` retrieves and validates the authoritative Stripe Session, then reveals a correctly bound encrypted delivery only after winning one conditional consume; the response is no-store/no-referrer and fails closed on replay, expiry, or mismatch.
- Paid bearer GETs authenticate only by SHA-256 digest and consume one call with a single conditional D1 `UPDATE ... RETURNING` inside the proven period. The 5,000-call boundary is exact; HEAD is quota-neutral and parked wallet balance is never spent.
- `npm run rehearse:d1` applies the production migration to disposable D1 and proves pending activation, duplicate fulfillment, real BLOB read/decrypt, one-time delivery, digest auth, exact allowance, renewal, and cancellation.

Production D1 now has the secure empty schema, a delivery secret is configured in Cloudflare, and the Worker is dark-deployed. Paid access remains unavailable because packaged configuration explicitly sets `PAID_ACCESS_ENABLED=false`.

## Verification at this checkpoint

- Independent authority/security review of the complete local candidate at `acede06` passed after 81 Worker tests, 5 React tests, type/syntax checks, and the disposable-D1 rehearsal passed. No runtime security blocker remained in the reviewed scope.
- Production migration and post-apply verification passed: five secure tables, no legacy table, no plaintext-key column, zero authority rows, no foreign-key violations, and no pending migration.
- Worker version `9dad18c2-66cd-4951-ae98-52b9c8daa84a` is live production-dark; apex, www, and free API are healthy while Checkout, webhook, and success fail closed.
- Browser UI was not changed. Existing browser evidence was not reused as proof of paid behavior.

## Remaining paid blockers

1. Correct the live Pro description and add `customer.subscription.updated` plus `invoice.payment_failed` to the live webhook endpoint. Stripe CLI write access currently no-ops despite successful re-authentication; direct restricted-key use returns 401.
2. Run one real Checkout → webhook → fulfillment → one-time key claim path and verify failed-payment disablement.
3. Change `PAID_ACCESS_ENABLED` to true only after those gates pass.

## Reboot handoff

- Docker Desktop was upgraded from 4.70.0 to 4.86.0; Docker Engine is 29.7.2 and MCP Toolkit is 0.43.3.
- Docker profiles, images, containers, and named Supabase volumes were preserved; nothing was pruned.
- Docker MCP OAuth remained in a silent-failure state across all previously authorized tools after the first Desktop restart. Adam elected to reboot the host before retrying OAuth.
- On return: verify Docker Desktop health, run `/reload-mcp`, authorize only `stripe-remote` first, prove one harmless Stripe read, then complete the two held Stripe corrections. Do not broaden into Cloudflare MCP until the Stripe launch blocker is closed.

## Hard stop-lines

Paid-enable stop-line: do not set `PAID_ACCESS_ENABLED=true` until the held Stripe webhook corrections and one real Checkout/fulfillment/key-claim path pass. Push remains a separate source-control action.
