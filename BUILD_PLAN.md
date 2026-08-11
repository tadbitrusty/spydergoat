# SpyderGoat v1.1+ Build and Hardening Plan

**Status:** Active source of truth
**Authority decision:** 2026-08-11, Adam
**Current branch:** `feature/paid-access-v1`

## Authority law

The authoritative product starts with the React v1.1 refactor and everything deliberately hardened after it. Pre-refactor v1 concepts are historical input only. They do not define current APIs, guarantees, billing behavior, release readiness, or implementation sequence.

Authority order:

1. Current code, tests, migrations, and configuration on the active branch.
2. This active build plan.
3. `docs/plans/2026-08-10-paid-access-rebuild.md` for the paid-access implementation sequence.
4. `docs/current-hardening-handoff.md` for live local state and receipts.
5. `docs/v1.1-release-candidate-2026-08-10.md` for the tagged v1.1 candidate receipt.
6. Archived and superseded documents for history only.

When documents disagree, current tested behavior wins temporarily and the active documents must be corrected in the same local slice.

## Current product truth

SpyderGoat is a Cloudflare Worker time API with a React 19, TypeScript, and Vite product surface.

- `/mjd` returns MJD, UTC ISO time, Unix seconds, and `source: "server"`.
- `/jd` returns the same receipt plus Julian Date.
- Values come from the Cloudflare Worker runtime clock.
- SpyderGoat does not claim NIST/GPS synchronization, atomic-clock accuracy, signed timestamps, monotonic time, or a measured uptime SLA.
- The HTML shell receives a fresh Worker-generated bootstrap before React mounts.
- A direct Vite/browser fallback is visibly labeled browser-derived.
- Time responses use `Cache-Control: no-store`.
- Free GET requests share one best-effort per-IP KV bucket: one successful call per 30 minutes across `/mjd` and `/jd`.
- API `HEAD` requests are quota-neutral.
- KV is abuse control, not transactional accounting.

## Current release posture

### Free v1.1 surface

The v1.1 release line is the stable product baseline. The v1.1 candidate receipt records its local tests, checks, build, audits, dry-run, and browser inspection. The later v1.1.1 logo correction is covered by automated regression tests in the current tree but does not have a separate repository-resident browser receipt.

### Paid access

Paid access remains **NO-GO** and disabled by default.

The active local branch now contains the bounded Pro-first runtime behind explicit capability and origin gates: hardened Checkout, digest-only key issuance, encrypted expiring one-time delivery, signed/order-safe Stripe lifecycle handling, no-store success delivery, and transactional bearer allowance. The webhook requires exact test/live-mode configuration, rejects mismatched event mode, and disables entitlement on same-second lifecycle ambiguity rather than guessing order. Paid access remains disabled in packaged configuration.

The runtime candidate passed independent authority/security review and the one full release gate. Production D1 is migrated to the secure empty authority schema, and Worker version `9dad18c2-66cd-4951-ae98-52b9c8daa84a` is dark-deployed with `PAID_ACCESS_ENABLED=false`. Receipt: `docs/paid-access-production-dark-release-2026-08-11.md`.

Still required before accepting money:

1. Make the two held Stripe Dashboard corrections: exact Pro description and complete webhook lifecycle events.
2. Run one real Checkout → signed webhook → one-time key claim rehearsal and verify failed-payment disablement.
3. Enable paid access only after that path passes; verify the live kill switch and first customer path.
4. Commit/push the exact deployed source when separately authorized.

Wallet top-ups and paid overages remain parked until Pro survives real use.

## Product contract

### Free

- Price: $0.
- Signup: none.
- Limit: one successful GET per IP every 30 minutes across `/mjd` and `/jd`.
- Enforcement: best-effort Cloudflare KV.

### Intended Pro

- Price: $4.89/month.
- Included usage: 5,000 successful authenticated requests per proven Stripe billing period.
- Initial account: one active key.
- Lost-key posture: no plaintext recovery; manual verified replacement is the phase-one target.
- Cancellation target: access continues through the paid entitlement period, then disables.
- Current availability: paused.

### Wallet

- Intended price: $0.001/request.
- Current availability: deliberately parked and disabled.

## Hardening rules

- Fail closed when payment, identity, entitlement, D1 state, signature verification, catalog identity, or delivery cannot be proven.
- Never store or log plaintext API keys as authority.
- The browser cannot choose product IDs, prices, account status, allowance, or entitlement.
- Every Stripe mutation must be bound to one server-generated internal account ID.
- Every event mutation must be idempotent and safe under duplicate or reordered delivery.
- Free and paid quota paths remain separate.
- No product copy may imply atomic time, cryptographic attestation, or an accuracy/uptime guarantee.
- Incomplete paid behavior must remain visibly and operationally unavailable.
- Local verification is not production proof.

## Verification gate for each local slice

Run and record:

```bash
npm test
npm run check
npm run build
npm audit
npm audit --omit=dev
npx wrangler deploy --dry-run
git diff --check
git status --short --branch --untracked-files=all
```

Also run focused tests first for behavior changes and inspect the final diff/status. Browser-facing changes require desktop and 390 × 844 inspection with console and overflow checks.

## Publication stop-line

Local source/docs/tests may be hardened under Adam’s current directive. Commit, push, merge, deploy, D1 migration, Worker secret changes, Stripe API/Dashboard actions, DNS changes, publication, customer-data access, and accepting payment remain separate authorization classes.

## Historical material

- Original January v1 concept: `docs/archive/BUILD_PLAN-v1-concept-2026-01-24.md`
- Original plaintext schema sketch: `docs/archive/schema-v1-plaintext-legacy.sql`
- Early hardening snapshot: `docs/overnight-hardening-handoff-2026-08-10.md`

Historical files explain where the idea came from. They are not implementation instructions.
