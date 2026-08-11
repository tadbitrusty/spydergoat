# SpyderGoat Paid Access Rebuild Plan

> **Status:** Active controlled implementation plan. Tasks may proceed locally under Adam’s v1.1 hardening directive, but no Stripe vendor calls, D1 migrations, secret changes, payment links, customer emails, pushes, or deployments are authorized by this document.
>
> **Authority:** The React v1.1 refactor and subsequent hardening are current truth. `BUILD_PLAN.md` governs product/runtime claims; this document governs the paid-access sequence.

**Goal:** Launch a safe Pro subscription that issues one API key, enforces a 5,000-request monthly allowance, and fails closed whenever identity, payment, accounting, or delivery cannot be proven.

**Architecture:** Keep KV limited to best-effort free-tier abuse control. Use D1 as the transactional authority for accounts, credentials, Stripe event deduplication, allowance consumption, subscription periods, and future wallet ledger entries. Create accounts before checkout, bind every Stripe session to one internal account ID, generate each API key once, store only its digest, and encrypt the one-time delivery copy with a separately managed Worker secret.

**Tech stack:** Cloudflare Worker + D1 + KV + Stripe Checkout/Webhooks + Node tests + Wrangler local/test-mode rehearsal.

---

## Scope decision

**Operator decision — 2026-08-11:** Build the complete Pro + Wallet architecture. Launch Pro first. Activate Wallet only after Pro survives real use and its billing, entitlement, quota, cancellation, recovery, and operational controls are proven.

### Phase 1 — launch this

- Pro subscription: **$4.89/month**.
- One active API key per initial account.
- 5,000 included requests per billing period.
- Bearer-key access to `/mjd` and `/jd`.
- One-time key display after verified checkout.
- Subscription activation, renewal/reset, cancellation, and payment-failure handling.

### Phase 2 — deliberately park this

- Wallet top-ups.
- `$0.001/request` overage deductions.
- Multiple keys per account.
- Customer dashboard, self-service rotation, invoices, teams, or usage analytics.
- Automated email delivery or recovery.

Wallet stays paused until the simpler subscription lifecycle is proven. The existing wallet schema/tests remain design material, not launch permission.

---

## Current truth

### Already present and useful

- `src/billing/service.js`
  - API-key SHA-256 hashing and strict key format.
  - Fail-closed Stripe Checkout Session catalog validation.
  - Deterministic account-binding requirement.
  - One-time Stripe event processing seam.
- `src/billing/stripe.js`
  - Five-minute timestamp tolerance.
  - Multiple `v1` signatures supported.
  - Constant-time signature comparison.
- `src/billing/d1-repository.js`
  - Atomic D1 allowance consumption via conditional `UPDATE ... RETURNING`.
  - Credential lookup by digest only.
  - Event claim/deduplication and account provisioning seam.
- `migrations/0001_transactional_billing.local.sql`
  - Accounts, credential digests, Stripe event receipts, wallet ledger, and encrypted one-time key-delivery shape.
- Existing billing, D1, Worker, and static tests.
- Production currently fails closed:
  - `/success` → `503`.
  - `/webhook` → `503`.
  - Bearer API requests → `503 paid_access_paused`.
  - No payment links/buttons are rendered.

### Current execution checkpoint — local only

Tasks 3–7 now have a bounded local candidate on `feature/paid-access-v1`: checkout completion generates `sg_` plus 48 random hex characters only after proving the pre-created pending account, treats only the SHA-256 digest as authentication authority, stores an eight-character display suffix, and creates a ten-minute AES-GCM delivery envelope using an injected exactly-32-byte secret. Account ID, Checkout Session ID, and expiry are authenticated as AES-GCM additional data. D1 provisioning places pending-account activation, credential digest, delivery envelope, and Stripe event receipt in one transactional batch; completion is foreign-key-bound to both artifacts so missing authority rolls back rather than leaving an unrecoverable event claim. The gated Worker webhook uses a bounded streaming read, verifies the exact raw body, requires exact Stripe test/live-mode agreement, retrieves the authoritative Checkout Session, and applies renewal/failure/cancellation state. Same-second lifecycle ambiguity disables entitlement instead of guessing order. The gated success route revalidates the authoritative Session and authenticates the encrypted envelope before one conditional consume. Paid bearer GETs use digest-only authentication and one conditional in-period update capped at 5,000; HEAD is neutral and parked wallet funds are untouched. None of this is released or enabled.

### Missing before money can move

1. Complete independent review and packaging of the complete local paid runtime candidate.
2. No Stripe test-mode catalog/webhook rehearsal.
3. No production migration, secrets, products/prices, or guarded enable flag.

**Current launch posture:** Paid launch remains **NO-GO**, correctly and intentionally.

---

## Decisions Adam should make before implementation crosses into UX

These do not need answers while tired.

1. **Initial customer identity**
   - Recommended: email collected by Stripe Checkout, with SpyderGoat generating the internal account UUID before creating the session.
   - No separate SpyderGoat password/account dashboard in phase 1.

2. **One-time key delivery**
   - Recommended: `/success?session_id=...` reveals the key once after webhook-confirmed payment; refreshes show “already claimed.”
   - Store only key digest for authentication.
   - Store the temporary delivery copy encrypted with AES-GCM and a Worker secret, with a short expiry.

3. **Recovery promise**
   - Recommended phase-1 truth: lost keys are not recoverable; support can revoke and issue a replacement after manual verification.
   - Do not promise automated recovery before an authenticated account surface exists.

4. **Cancellation behavior**
   - Recommended: keep access through Stripe’s paid `current_period_end`; disable after entitlement expires, not immediately when cancel-at-period-end is selected.

---

## Implementation sequence

### Task 1: Freeze the Pro-only contract

**Objective:** Encode one launch SKU and explicitly disable wallet behavior.

**Files:**
- Modify: `src/billing/service.js`
- Modify: `test/billing.test.js`
- Modify: `README.md`

**Steps:**
1. Add tests proving the launch catalog accepts only the Pro subscription SKU.
2. Prove wallet/top-up commands remain unavailable behind a disabled capability.
3. Document exact price, included calls, cancellation semantics, and lost-key policy.
4. Run `npm test` and `npm run check`.
5. Commit one verified contract slice.

### Task 2: Create pending accounts before Checkout

**Objective:** Every Checkout Session must be bound to a server-generated internal account ID before Stripe can accept payment.

**Files:**
- Modify: `src/billing/d1-repository.js`
- Modify: `src/billing/service.js`
- Modify: `src/api/worker.js`
- Test: `test/d1-repository.test.js`
- Test: `test/billing.test.js`
- Test: `test/worker.test.js`

**Route shape:**
- `POST /checkout/pro`
- Server generates `acct_<uuid>`.
- D1 inserts a pending account.
- Server creates the Stripe Checkout Session with allowlisted price and metadata:
  - `spydergoat_sku=subscription`
  - `spydergoat_account_id=<internal id>`
- Browser never chooses product ID, price ID, amount, account status, or entitlement.

**Tests first:** missing D1/Stripe config, malformed request, unknown Origin, Stripe failure after pending-account creation, and catalog mismatch must all fail closed.

### Task 3: Complete idempotent API-key issuance

**Objective:** A valid completed subscription creates exactly one credential, even under duplicate webhook delivery.

**Files:**
- Modify: `src/billing/service.js`
- Modify: `src/billing/d1-repository.js`
- Test: `test/billing.test.js`
- Test: `test/d1-repository.test.js`

**Contract:**
- Generate `sg_` plus 48 cryptographically random hex characters.
- Persist only SHA-256 digest and display suffix in `api_credentials`.
- Insert account entitlement, credential, Stripe event receipt, and key-delivery envelope atomically/idempotently.
- Never log or return the raw key from webhook processing.

### Task 4: Implement encrypted one-time key delivery

**Objective:** The post-checkout page can reveal a key once without storing plaintext.

**Files:**
- Create: `src/billing/key-delivery.js`
- Modify: `src/billing/d1-repository.js`
- Modify: `src/api/worker.js`
- Test: `test/key-delivery.test.js`
- Test: `test/worker.test.js`

**Contract:**
- AES-GCM encryption key comes from a Worker secret; never from source or D1.
- D1 stores ciphertext, IV, nonce/session binding, expiry, and consumed timestamp.
- `GET /success?session_id=...`:
  - pending webhook → honest pending state;
  - valid unconsumed delivery → atomically mark consumed and reveal once;
  - consumed → no key disclosure;
  - expired/invalid → no key disclosure.
- `Cache-Control: no-store, private`; `Referrer-Policy: no-referrer`; no third-party scripts.

### Task 5: Wire and harden the webhook locally

**Objective:** Signed Stripe events update D1 exactly once and unsupported events remain harmless.

**Files:**
- Modify: `src/api/worker.js`
- Modify: `src/billing/service.js`
- Test: `test/worker.test.js`
- Test: `test/billing.test.js`

**Required events:**
- `checkout.session.completed`
- `invoice.paid`
- `invoice.payment_failed`
- `customer.subscription.updated`
- `customer.subscription.deleted`

**Required behaviors:**
- Read raw body once with a body-size limit.
- Verify signature before JSON parsing/business mutation.
- Deduplicate by Stripe event ID.
- Track subscription ID, status, period start/end.
- Reset included usage once per proven new paid period.
- Handle out-of-order delivery using Stripe object timestamps/period boundaries instead of arrival order.

### Task 6: Wire paid API authentication and atomic allowance use

**Objective:** A valid active key consumes exactly one allowance per successful API request.

**Files:**
- Modify: `src/api/worker.js`
- Modify: `src/billing/d1-repository.js`
- Test: `test/worker.test.js`
- Test: `test/d1-repository.test.js`

**Contract:**
- Parse only `Authorization: Bearer <key>`.
- Hash before lookup; never log raw key.
- Confirm entitlement period/status.
- Atomically consume allowance in D1.
- Preserve quota-neutral `HEAD`.
- Invalid, inactive, expired, empty, or unavailable D1 all fail closed.
- Free and paid limiter paths remain separate.

### Task 7: Rehearse the migration locally

**Objective:** Prove schema creation, replay safety, and upgrade/rollback procedure without touching production D1.

**Files:**
- Modify/create a versioned migration only after schema review.
- Create: `docs/billing/local-d1-rehearsal-receipt.md`

**Verification:**
1. Apply migration to disposable local D1.
2. Reapply and confirm the intended idempotency policy.
3. Exercise checkout-account creation, duplicate webhooks, key claim, allowance boundary, renewal, failure, and cancellation.
4. Inspect rows for plaintext keys or secret leakage.
5. Rebuild a fresh local database from migrations.
6. Record exact schema, commands, results, rollback/forward-fix posture.

### Task 8: Supervised Stripe test-mode rehearsal

**Objective:** Prove the complete flow against Stripe test mode with no real money.

**External-action gate:** Requires Adam’s explicit approval before creating Stripe test products/prices, webhook endpoints, or secrets.

**Rehearsal:**
1. Create test-mode Pro product and `$4.89/month` price.
2. Configure test-only Stripe keys and webhook secret without printing values.
3. Run local/preview Worker with isolated D1.
4. Complete Checkout using Stripe’s test card.
5. Verify one account, one credential digest, one delivery envelope, and one event receipt.
6. Replay the webhook and prove no second key/entitlement.
7. Claim key once; prove refresh cannot recover it.
8. Exercise bearer API at calls 4,999 / 5,000 / 5,001.
9. Rehearse renewal/reset, failed invoice, cancellation, and event reordering.
10. Return a GO/NO-GO receipt; do not proceed automatically.

### Task 9: Production-dark deployment

**Objective:** Install production plumbing while paid access stays visibly and operationally disabled.

**External-action gates:** Production D1 migration, Worker secrets, Stripe live catalog/webhook, deploy, and vendor changes each require explicit current approval.

**Order:**
1. Back up/inspect production D1 posture.
2. Apply reviewed migration.
3. Set encryption and Stripe secrets.
4. Configure live Stripe product/price and webhook.
5. Deploy with `PAID_ACCESS_ENABLED=false`.
6. Verify free API and paused paid routes are unchanged.
7. Verify signed synthetic/test-safe webhook behavior without enabling Checkout.
8. Record Worker version, schema receipt, Stripe object IDs (never secrets), and rollback steps.

### Task 10: Enable Pro subscription

**Objective:** Expose Checkout only after every prior gate is green.

**External-action gate:** Explicit approval to accept real payment.

**Launch:**
1. Enable Pro capability only; wallet remains disabled.
2. Publish truthful pricing, key-loss, cancellation, and support language.
3. Perform one explicitly approved real low-risk purchase/rehearsal if required.
4. Verify payment → webhook → one-time key → authenticated API.
5. Monitor Stripe events, D1 event receipts, errors, and allowance accounting.
6. Maintain a one-command/one-variable kill switch that returns paid paths to `503` without harming the free API.

---

## Release gates

Paid launch is **GO** only when all are true:

- [ ] Account ID exists before Checkout and is bound server-side.
- [ ] Stripe catalog identity/amount/mode/live-mode checks pass.
- [ ] Webhook signature, replay, body-size, and event-order tests pass.
- [ ] D1 migration was rehearsed from empty state.
- [ ] No plaintext API key exists in D1, logs, responses, source, or receipts.
- [ ] Duplicate events cannot create duplicate credentials or credits.
- [ ] One-time key claim is atomic, expiring, and non-repeatable.
- [ ] Allowance boundaries and period reset are transactionally proven.
- [ ] Cancellation and failed-payment semantics match customer-facing copy.
- [ ] Free endpoint behavior remains unchanged.
- [ ] Paid kill switch was rehearsed.
- [ ] Stripe test-mode end-to-end rehearsal is green.
- [ ] Production-dark deployment is green before Checkout is exposed.
- [ ] Adam explicitly authorizes accepting real payments.

---

## Mushy-brain mode for today

Do **not** start with Stripe Dashboard or secrets.

If Adam wants to touch this today, the only recommended slice is:

1. Read the four decision questions above.
2. Confirm or change the recommended answers.
3. Freeze **Pro-only first; wallet later**.
4. Open a local branch for Task 1.
5. Stop after the Pro-only contract/tests are green and committed locally.

That is useful progress without putting money, customer access, PWD work, or a tired operator in the blast radius.

## Separate lane reminder

PWD/CPA PDF planning is not a dependency of SpyderGoat billing. Keep its calls, requirements, forms, and stakeholder decisions in the PWD workspace. Do not mix CPA/PWD facts into this repository or use SpyderGoat payment work as an excuse to postpone documenting the CPA call while it is fresh.
