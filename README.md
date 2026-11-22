# SpyderGoat 🐐

**External server-time receipts for software. One API call.**

AI agents can guess the date. Local clocks can drift. Timezones lie in wait like tiny bureaucratic demons. SpyderGoat is a dead-simple external server-time reference for agents, audit trails, scientific systems, distributed jobs, and workflows that need a compact timestamp receipt without dragging in a heavy dependency.

SpyderGoat is an HTTP time receipt derived from the Cloudflare Worker clock. Hash receipts are signed with Ed25519, but this service is **not RFC 3161**, not a timestamp authority, not legal-grade evidence, and not an accuracy SLA. It does not claim to be unique or stronger than FreeTSA or OpenTimestamps.

## The Problem

Programs only look smart when they agree on time.

Common failure modes:

- LLMs have stale training cutoffs and no native live clock.
- Agent runs need timestamped receipts for tool calls and decisions.
- Local `datetime.now()` can be wrong, timezone-dependent, or environment-specific.
- Distributed systems need one simple external time response for logs, webhooks, ledgers, and scheduled work.
- Scientific/space/simulation workflows often prefer MJD/JD over messy calendar math.

## The Wedge

One endpoint returns a compact global time receipt:

- Modified Julian Date (`mjd`)
- UTC ISO timestamp (`utc`)
- Unix seconds (`unix`)
- optional Julian Date (`jd`)
- source marker (`source`)

## Usage

```bash
# Free tier — no signup required
curl https://spydergoat.com/mjd
```

```json
{
  "mjd": 61107.380125,
  "utc": "2026-03-08T09:07:22.000Z",
  "unix": 1772960842,
  "source": "server"
}
```

```bash
# Include Julian Date
curl https://spydergoat.com/jd
```

Create a receipt for a SHA-256 digest (content is never accepted):

```bash
curl -X POST https://spydergoat.com/receipt \
  -H 'content-type: application/json' \
  --data '{"sha256":"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"}'
```

The signature covers canonical JSON containing `hash`, `key_id`, `mjd`, `unix_ms`, and `utc`. Send the returned object to `POST /verify`; use `GET /keys` to inspect public-key validity and revocation state.

## Endpoints

| Endpoint | Description |
|---|---|
| `GET /mjd` | Returns MJD, UTC, Unix timestamp, and source |
| `GET /jd` | Same as `/mjd` plus Julian Date |
| `POST /receipt` | Signs exactly one supplied SHA-256 digest; never accepts content |
| `GET or POST /verify` | Checks signature, key validity window, and revocation |
| `GET /keys` | Lists public receipt keys and validity metadata |
| `POST /checkout` | Creates a test-mode $5/month Checkout only when `PAID_ENABLED=true` |
| `GET /success?session_id=...` | Shows a provisioned API key once |
| `POST /webhook` | Verifies Stripe signatures; provisions or revokes API keys |

The free limit is best-effort because Cloudflare KV counters are eventually consistent. `/mjd`, `/jd`, and `/receipt` share one 10-request-per-IP count per UTC day. The rate-limit key contains the Cloudflare-provided IP and is retained in KV for up to roughly 48 hours; submitted receipt content is never accepted. `/verify` and `/keys` are separately limited to 60 requests per IP per minute. Receipt issuance also has a best-effort global safety cap of 10,000 receipts per UTC day.

## Use Cases

### AI agents

Anchor autonomous runs, decisions, memory records, and tool receipts to live external time.

### Audit trails

Add a small external timestamp receipt to logs, webhooks, fulfillment events, and business-process records.

### Scientific and space-adjacent systems

Use MJD/JD for compact, timezone-independent numeric time representation. MJD does not make an underlying clock monotonic.

### Global software

Give apps a tiny edge-hosted clock endpoint without shipping NTP clients, timezone assumptions, or bulky date services.

## Pricing

| Tier | Price | Limit |
|---|---:|---|
| Free | $0 | 10 requests / UTC day / IP |
| Pro | $5/mo | Feature-gated; 5,000 requests per billing month |

The intended prices remain recorded, but no paid checkout or wallet links are exposed by the local hardened build.

## Why MJD?

Modified Julian Date is a compact, unambiguous timestamp used by astronomers, satellite systems, and scientific computing. No timezones. No daylight saving. No ambiguous dates. Just a single numeric representation derived from the server clock. Clock corrections and time-scale caveats still apply.

```text
MJD = (unix_ms / 86400000) + 40587
JD  = MJD + 2400000.5
```

## Stack

- Frontend: React 19 + TypeScript + Vite, delivered as Cloudflare Worker Static Assets
- Runtime: Cloudflare Workers; the HTML shell receives a fresh server-time bootstrap before React mounts
- Storage: Cloudflare KV for free-tier daily limiting; D1 stores receipt hashes only and purges them after 90 days by default
- Database: Cloudflare D1 stores transactional account state, hashed API credentials, encrypted one-time delivery, and Stripe event replay claims
- Billing: Stripe test mode only in development; `PAID_ENABLED` defaults to `false`
- DNS/CDN: Cloudflare

## Local Development

```bash
npm install
npm run dev
```

`npm run dev` builds the initial asset bundle, then starts Vite with HMR at `http://localhost:5173` and the local Worker API at `http://localhost:8787`.

Useful commands:

```bash
npm test          # Node Worker/billing tests + Vitest React tests
npm run check     # TypeScript + Worker/billing syntax checks
npm run build     # Production Vite bundle
npm run db:migrate:local # apply D1 migrations locally only
npm run dev:worker
```

Deploy only when explicitly authorized:

```bash
npm run deploy
```

## Billing recovery runbook

Stripe billing is test-mode only. The webhook retrieves `checkout.session.completed` again from Stripe with `line_items` expanded before validating price, product, amount, customer, and account binding. The daily `17 3 * * *` UTC job checks completed paid Checkout Sessions from the previous 48 hours against D1 and emits `paid_checkout_unprovisioned` for each missing provision. It also revokes credentials whose payment grace period has expired.

`invoice.payment_failed` and `customer.subscription.updated` with `past_due` begin a seven-day grace period. Keys work during that period; the daily job revokes them after it ends. `invoice.paid` restores active status, clears the grace deadline, and resets the 5,000-request monthly allowance.

For a customer who did not receive or lost the one-time key, an operator verifies the test-mode Checkout Session and customer, then calls `POST /billing/key-resend` with `X-Admin-Token` and JSON `{"checkout_session_id":"cs_..."}`. The route re-fetches and validates the paid session, revokes the old credential, creates a new one-hour one-time delivery, and returns only its `/success` path—never the key. The operator must provide that path through an approved support channel.

Refund path: verify the test-mode charge, Checkout Session, customer, and account first; create the refund in the Stripe test Dashboard or test CLI; confirm the signed `charge.refunded` webhook returned 2xx; then confirm the matching account and credentials are revoked in D1. If the webhook fails, leave paid access disabled and reconcile before retrying. Never perform these steps in live mode.

## Launch Note

Paid launch remains **NO-GO by default** because `PAID_ENABLED=false`. Enabling it requires Adam's explicit approval plus Worker secrets for the Ed25519 private key, key-delivery encryption, a Stripe `sk_test_...` key, and a test webhook secret. Never put those values in source control.

## License

MIT

---

[spydergoat.com](https://spydergoat.com) · [contact@spydergoat.com](mailto:contact@spydergoat.com)
