# SpyderGoat Current Hardening Handoff

**Updated:** 2026-08-11
**Branch:** `feature/paid-access-v1`
**Baseline:** tagged v1.1.1 plus current local paid-access work
**Posture:** local hardening in progress; no push or deploy authorized

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

Current paid-access work implements the bounded issuance, delivery, signed lifecycle, and transactional bearer seams from Tasks 3–6 of the paid rebuild plan:

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

This slice does not make paid access available. The packaged configuration keeps paid access disabled, no delivery secret is configured, and no remote migration was applied.

## Verification at this checkpoint

- Focused RED/GREEN and final local gate receipts are recorded in the implementing session handoff; final command results must be re-run against the exact candidate before packaging.
- Browser UI was not changed. Existing browser evidence was not reused as proof of paid behavior.

## Remaining paid blockers

1. Independent review and packaging of the complete local paid runtime candidate.
2. Complete reviewed versioned D1 migration posture.
3. Disposable local-D1 end-to-end rehearsal.
4. Separately authorized Stripe test-mode rehearsal.
5. Separately authorized production-dark configuration and deploy.
6. Explicit authorization before accepting real payment.

## Hard stop-lines

Adam's current directive authorizes autonomous local implementation, disposable-D1 rehearsal, verification, and clean local commits. No push, merge, deploy, remote D1 migration, Stripe action, secret change, DNS mutation, customer-data access, publication, email, or payment acceptance is authorized.
