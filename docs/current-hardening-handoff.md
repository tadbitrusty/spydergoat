# SpyderGoat Current Hardening Handoff

**Updated:** 2026-08-11T08:14:54-05:00
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

Uncommitted paid-access work is implementing the pending-account/Checkout seam from Task 2 of the paid rebuild plan:

- `POST /checkout/pro` exists behind `PAID_ACCESS_ENABLED=true`.
- Request Origin must match the configured checkout allowlist.
- D1 and Stripe configuration are required.
- The server generates a pending internal account before contacting Stripe.
- The server fetches the configured Stripe Price and requires an exact active monthly product/currency/amount match before Checkout creation.
- Stripe creation failure moves the pending account to `checkout_failed` for an explicit recovery trail.
- Checkout URL responses are constrained to Stripe’s HTTPS checkout host.
- Unexpected request bodies are rejected before D1 or Stripe.
- Default/local unconfigured behavior remains 503.

When deliberately enabled and configured, this slice can initiate a Stripe Checkout flow capable of accepting payment. It does not fulfill paid access, process webhooks, issue keys, deliver keys, authenticate paid requests, or reset billing periods. Enabling it is therefore a money-path boundary requiring explicit approval, not an inert configuration change.

## Verification at this checkpoint

- `npm test`: 47 Node Worker/billing/static tests and 5 React tests passed.
- `npm run check`: TypeScript plus Worker, billing, signature, and Stripe-client syntax passed.
- `npm run build`: Vite production build passed; no public source map emitted.
- `npm audit`: zero known vulnerabilities.
- `npm audit --omit=dev`: zero known vulnerabilities.
- `npx wrangler deploy --dry-run`: passed; 29.54 KiB raw / 9.65 KiB gzip; KV, D1, Assets, and environment bindings detected; no deploy.
- `git diff --check`: passed.
- Authority-path assertions: active plan, paid plan, current handoff, archive index, archived concept plan, and archived legacy schema all present.
- Browser UI was not changed in this authority slice. The v1.1 candidate receipt remains the latest repository-resident browser evidence; v1.1.1 has current automated logo coverage but no separate browser receipt.

## Remaining paid blockers

1. Idempotent digest-only key issuance.
2. Complete reviewed versioned D1 migration posture.
3. Encrypted expiring one-time key delivery.
4. Signed webhook runtime integration and body limits.
5. Renewal/reset, failure, cancellation, and event-order semantics.
6. Transactional 5,000-call period boundary.
7. Bearer authentication and allowance consumption.
8. Disposable local-D1 end-to-end rehearsal.
9. Separately authorized Stripe test-mode rehearsal.
10. Separately authorized production-dark configuration and deploy.
11. Explicit authorization before accepting real payment.

## Hard stop-lines

No commit, push, merge, deploy, D1 migration, Stripe action, secret change, DNS mutation, customer-data access, publication, email, or payment acceptance is authorized by this handoff.
