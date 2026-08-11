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

Production D1 has the secure authority schema, a delivery secret is configured in Cloudflare, and paid access is live with packaged configuration explicitly set to `PAID_ACCESS_ENABLED=true`.

## Verification at this checkpoint

- Fresh cutover gate passed after production-shaped compatibility fixes: 84 Worker tests, 5 React tests, type/syntax checks, disposable-D1 rehearsal, Vite production build, both dependency audits, Wrangler deploy dry-run, and `git diff --check`.
- Dependency audits passed with zero production or development vulnerabilities; added-line secret/dangerous-code scan returned zero findings.
- Production D1 verification passed: the paid event is processed once; one active entitlement has a valid period and one consumed call; one digest-only credential and one consumed one-time delivery exist.
- All three required Worker secrets are present by name. Live Worker version `1ee60f31-28c5-4ac4-bb53-463d9c85275f` has paid access enabled.
- Live cutover smoke passed: one real $4.89 Checkout completed; the signed webhook retry succeeded with zero pending deliveries; one-time key claim returned 200 and replay returned 409 without a key; authenticated HEAD returned 200 quota-neutral; authenticated GET returned 200 with 4,999 remaining; an invalid key returned 401. Repeated `/mjd` and `/jd` HEAD checks returned 200, wrong-origin Checkout returned 403, and malformed success claims returned 400.
- Live Stripe readback passed: active $4.89 monthly recurring Pro price, corrected Pro description, enabled webhook, and complete six-event lifecycle set.
- Browser UI was not changed. Existing browser evidence was not reused as proof of paid behavior.

## Remaining paid blockers

The live Stripe catalog correction is complete and read back through Stripe: the Pro description now states the exact 5,000 authenticated MJD/JD requests per monthly billing period. The enabled live webhook preserves its existing events and now also includes `customer.subscription.updated` and `invoice.payment_failed`.

Blocker-only review found three connected entitlement failures in the earlier candidate. The local candidate now requires the active billing period during digest authentication—including quota-neutral `HEAD`; preserves canceled subscription access only while the existing entitlement is active and before `current_period_end`; and prevents a later cancellation event from reactivating access disabled by failed payment. Focused RED/GREEN tests, an executable D1 sequence covering failed-payment → cancellation, and the complete release gate pass.

Final independent blocker-only review: **PASS**. It verified the strict billing-period boundary, quota-neutral authenticated `HEAD`, cancellation-through-period-end behavior, failed-payment disablement, no failed-payment reactivation, and retained event ordering/conflict behavior.

Cutover is complete. Keep `PAID_ACCESS_ENABLED=true`; return it to `false` immediately if production later violates the paid-access contract. Remote Git push remains separately authorized.

## Reboot/OAuth resolution

- Docker Desktop was upgraded from 4.70.0 to 4.86.0; Docker Engine is 29.7.2 and MCP Toolkit is 0.43.3.
- Docker profiles, images, containers, and named Supabase volumes were preserved; nothing was pruned.
- Docker MCP `stripe-remote` OAuth is authorized. Harmless live reads and both required live Stripe corrections succeeded and were independently read back.
- Docker MCP's credential-helper path has shown intermittent timeout failures on some fresh gateway processes; this did not invalidate the successful Stripe writes/readbacks and is not a SpyderGoat product blocker.

## Hard stop-lines

Paid-enable stop-line was satisfied: the pre-cutover gate passed, Adam explicitly authorized cutover, and the controlled real Checkout/fulfillment/key-claim path passed after bounded production-compatibility fixes. Any future contract failure returns the flag to `false`. Push remains a separate source-control action.

Flow stop-line: once the stated requirements and verification gates pass, stop. Additional refinement is overprocessing unless a concrete gross production security hole blocks forward motion.
