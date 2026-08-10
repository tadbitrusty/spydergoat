# Spydergoat Local Hardening Handoff — 2026-08-10

## Verdict

- **Public free endpoint/runtime: PARTIAL publish-readiness.** Local tests, Worker smoke, browser checks, dependency audit, and Wrangler dry-run pass. Nothing was deployed.
- **Paid launch: NO-GO / NEEDS_ADAM.** The local Worker deliberately returns 503 for paid success and webhook routes, ignores bearer credentials, and exposes no checkout/top-up links.
- **Transactional billing: PARTIAL.** Production-shaped pure validation, signature verification, hashed-key lookup, atomic D1 accounting SQL, event idempotency, and a local-only schema exist and are tested. They are not wired into the runtime and no migration was applied remotely.

## What changed

- Replaced the monolithic cyan homepage with a truthful navy/amber semantic page.
- Kept the MJD hero, epoch ruler, Why MJD, use cases, runtime trust facts, docs, and pricing structure.
- Made API calibration an intentional one-click `/mjd` request so page load does not spend the visitor's free request; the display interpolates locally afterward.
- Added mobile navigation/layout, reduced-motion behavior, focus styles, canonical/OG/JSON-LD metadata, favicon, sitemap, robots, HEAD, route-specific methods/CORS, and security headers.
- Removed checkout links and unsupported uptime, accuracy, monotonicity, customer, and atomic-clock claims.
- Disabled `/success`, `/webhook`, and bearer-key behavior until paid architecture is supervised and complete.
- Added strict Checkout catalog/session validation, deterministic top-up account binding, replay contracts, signature parsing with multiple `v1` support, and no plaintext-key logging.
- Added a D1 repository seam, conditional atomic allowance/wallet update, Stripe event claim ledger, hashed credential lookup, and local-only migration design.
- Updated Wrangler to 4.120.0 after the prior version's dev dependency audit exposed high-severity advisories.

## Verification receipts

- `npm test` — 31/31 pass.
- `npm run check` — Worker and billing module syntax pass.
- `npm audit` — 0 vulnerabilities.
- `npm audit --omit=dev` — 0 vulnerabilities.
- `npx wrangler deploy --dry-run` — pass; 16.21 KiB raw / 6.02 KiB gzip; expected KV, D1, and environment bindings detected; Stripe checkout URL is not packaged; no deploy.
- Local D1 schema rehearsal — 8 statements applied successfully to isolated `/tmp` persistence; expected account, credential, event, wallet-ledger, and key-delivery tables present.
- Local Worker smoke — `/` 200 and `/mjd` 200.
- Browser at 390×844 — no horizontal overflow; all anchors resolve; paid-link count 0; one-click `/mjd` calibration succeeds; console has 0 errors and 0 warnings.
- `git diff --check` — pass.
- Independent review cycle 1 found recoverability, quota, IP trust, and packaged-link issues; fixes were applied with new failing tests first.
- Independent review cycle 2 — passed with no security concerns or logic errors.
- Local server started for smoke/browser checks was stopped; port 8787 verified closed.

## Paid-launch blockers

1. Adam must decide and supervise deactivation/verification of any already-created Stripe Payment Links. Removing URLs from this bundle does not disable vendor-side links.
2. Approve the authoritative D1 migration/cutover and reconcile any existing KV account/key/balance data without printing plaintext credentials.
3. Supply/verify an allowlisted Stripe catalog (mode, livemode, product, price, currency, amount) through a supervised configuration path.
4. Build and rehearse authenticated checkout creation with deterministic account binding; static anonymous top-up links are not acceptable.
5. Complete encrypted, expiring, one-time key delivery plus rotation, revocation, and recovery. Only key digests may remain authoritative.
6. Wire webhook handling to the D1 repository and run actual local-D1 replay/rollback/concurrency integration tests.
7. Perform supervised Stripe test-mode and Cloudflare preview rehearsal, including duplicate events, failed payment, cancellation, top-up, key delivery, and rollback.
8. Decide the final free-tier economics. KV remains a best-effort abuse throttle, not a transactional quota authority.

## Safest supervised morning order

1. Review this branch and local commit(s); do not deploy it as paid-ready.
2. Decide whether existing Stripe Payment Links must be disabled immediately in Stripe Dashboard.
3. Review the local migration and choose the D1 cutover/reconciliation plan.
4. Define the exact Stripe allowlist and authenticated checkout/account-binding contract.
5. Finish one-time encrypted key delivery and local-D1 integration tests.
6. Run Stripe test-mode plus Cloudflare local/preview rehearsal with no live charges.
7. Re-run tests, audits, dry-run, browser checks, and independent review.
8. Only then choose commit/push/release/deploy actions under explicit authorization.

## Boundary receipt

No push, PR, merge, deploy, publication, DNS change, Cloudflare production mutation, live KV/D1 read or write, Stripe API/Dashboard action, payment, refund, webhook delivery, email, analytics/search mutation, secret rotation, customer-data inspection, or external send occurred.
