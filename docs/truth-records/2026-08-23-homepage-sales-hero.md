# SpyderGoat homepage sales-hero receipt

**Date:** 2026-08-23
**Branch:** `feature/paid-access-v1`
**Baseline:** `cd07d83cf549c17d91887bf8f84529c40c49f765`
**Posture:** Shipped and live

## Why

The live homepage explained the MJD/time primitive but did not put the buyer's timestamp-disagreement problem or the paid action above the fold. Zero purchases could not be interpreted without traffic/funnel evidence.

## Changed

- Reframed the hero around “Timestamp receipts for software events.”
- Added the concrete problem: logs, agents, webhooks, or databases disagreeing about when something happened.
- Kept the bounded product truth: external server-derived UTC, Unix, and MJD; no accuracy, synchronization, cryptographic, authority, or uptime claim.
- Added above-fold `Try the free endpoint` and `Get Pro — $4.89/month` actions.
- Reused the existing first-party `/checkout/pro` flow; no Stripe URL is embedded in the page.
- Added one viewport-visible checkout status toast so either Pro action reports failure without duplicate live-region announcements.
- Updated HTML/no-script/fallback metadata and copy to preserve crawlable and degraded-path consistency.

## Measurement readiness

- The live site already receives Cloudflare's automatically injected Web Analytics beacon (`static.cloudflareinsights.com/beacon.min.js` observed in the live DOM).
- Homepage visits are therefore measurable in Cloudflare Web Analytics.
- Free intent reaches `/mjd`; paid intent reaches first-party `POST /checkout/pro`; completed purchases remain authoritative in Stripe/D1.
- A read-only GraphQL traffic query was attempted and correctly stopped: the current API token lacks `com.cloudflare.api.account.zone.analytics.read` for `spydergoat.com`.
- No Cloudflare token permission, analytics setting, account configuration, DNS, Worker binding, or production data was changed.

## TDD receipts

RED was observed before implementation:

- React hero contract failed because the new heading/actions did not exist.
- Static no-script contract failed because the new copy did not exist.
- Worker fallback contract failed because the new copy/actions did not exist.

GREEN:

- Focused React: 7/7 passed.
- Focused static/Worker: 30/30 passed.
- Full `npm test`: 138 Worker tests and 7 React tests passed.
- `npm run check`: passed.
- `npm audit`: 0 vulnerabilities.
- `npm audit --omit=dev`: 0 vulnerabilities.
- `npm run build`: passed; HTML 3.35 kB, CSS 12.42 kB, JS 205.16 kB.
- `npx wrangler deploy --dry-run`: passed; six assets read, 111.62 KiB upload / 30.12 KiB gzip, expected KV/D1/assets/production bindings present.
- Desktop browser: one H1, both hero actions present, no horizontal overflow, no console messages or JavaScript errors.
- Mobile browser: 320 × 568 and 390 × 844 inspections passed with no horizontal overflow. Both 46 px-tall CTAs are fully above-fold even at 320 × 568 (bottom edge 521.2 px).
- Independent review initially found the 320 × 568 CTAs below-fold. A second RED/GREEN cycle shortened the visible labels, retained full accessible names, compacted the mobile hero, and placed the actions side-by-side; exact viewport remeasurement closed the blocker.
- Independent review then caught two additional blockers: the shortened labels violated WCAG label-in-name expectations, and the degraded Worker fallback simultaneously promoted Pro and called it unavailable. A third RED/GREEN cycle made each visible CTA its exact accessible name and made the fallback explicitly describe interactive-site degradation without presenting a broken checkout action. Focused and full suites passed afterward.

Visual evidence is outside the repo at:

- `/home/adam/Desktop/spydergoat-hero-review-2026-08-23/01-desktop-1280x900.png`
- `/home/adam/Desktop/spydergoat-hero-review-2026-08-23/02-mobile-390x844.png`
- `/home/adam/Desktop/spydergoat-hero-review-2026-08-23/03-small-mobile-320x568.png`
- `/home/adam/Desktop/spydergoat-hero-review-2026-08-23/04-live-mobile-after-deploy.png`

## Publication receipts

- Adam authorized shipment in-chat with “Ship it.”
- Code commit: `174951cfa8890394396601b574c904c1f61cbb57` (`feat(web): sharpen homepage sales path`).
- Pushed to `origin/feature/paid-access-v1`; local and remote SHAs matched with ahead/behind `0 0`.
- Cloudflare production deployment succeeded with Version ID `2dcd9086-f0fa-4864-8104-b0f3adbb61b2`.
- Live homepage returned HTTP 200 with the revised hero and expected built asset `index-B-E80J6x.js`.
- Live `/mjd` returned HTTP 200 with `mjd`, `source`, `unix`, and `utc`; source was `server`.
- Post-deploy 390 × 844 screenshot confirmed both CTAs above-fold without clipping or an error/interstitial.
- No Cloudflare token-permission, analytics configuration, DNS, Stripe, D1, KV, secret, billing, or customer-data mutation was made.

## Remaining measurement gate

Cloudflare analytics-read permission is needed only if Adam wants Mim to retrieve and interpret traffic directly. The live dashboard and automatically injected Web Analytics beacon do not depend on a Worker change.
