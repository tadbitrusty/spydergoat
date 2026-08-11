# SpyderGoat 🐐

**External server-time receipts for software. One API call.**

AI agents can guess the date. Local clocks can drift. Timezones lie in wait like tiny bureaucratic demons. SpyderGoat is a dead-simple external server-time reference for agents, audit trails, scientific systems, distributed jobs, and workflows that need a compact timestamp receipt without dragging in a heavy dependency.

SpyderGoat is an HTTP time receipt derived from the Cloudflare Worker clock. It is not NTP, an atomic-clock feed, a signed timestamp authority, or an accuracy SLA.

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
  "mjd": 61107.38011574,
  "utc": "2026-03-08T09:07:22.000Z",
  "unix": 1772960842,
  "source": "server"
}
```

```bash
# Include Julian Date
curl https://spydergoat.com/jd
```

## Endpoints

| Endpoint | Description |
|---|---|
| `GET /mjd` | Returns MJD, UTC, Unix timestamp, and source |
| `GET /jd` | Same as `/mjd` plus Julian Date |
| `POST /checkout/pro` | Local candidate route; disabled by default and capable of initiating payment only after separately approved enablement/configuration |
| `GET /success?session_id=...` | Gated, no-store, one-time key delivery after authoritative Stripe validation; fail-closed by default |
| `POST /webhook` | Gated signed Stripe fulfillment/lifecycle endpoint; fail-closed by default |

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
| Free | $0 | 1 successful GET per IP / 30 min, shared across `/mjd` and `/jd`; HEAD is quota-neutral |
| Pro | $4.89/mo | 5,000 authenticated successful GETs per proven billing period; paused pending cutover |
| Wallet | $0.001/request | Top-ups disabled pending account binding and ledger rehearsal |

The intended prices remain recorded, but no paid checkout or wallet links are exposed by the hardened public surface. Local paid-access work remains disabled by default and is not a launch receipt.

## Why MJD?

Modified Julian Date is a compact, unambiguous timestamp used by astronomers, satellite systems, and scientific computing. No timezones. No daylight saving. No ambiguous dates. Just a single numeric representation derived from the server clock. Clock corrections and time-scale caveats still apply.

```text
MJD = (unix_ms / 86400000) + 40587
JD  = MJD + 2400000.5
```

## Stack

- Frontend: React 19 + TypeScript + Vite, delivered as Cloudflare Worker Static Assets
- Runtime: Cloudflare Workers; the HTML shell receives a fresh server-time bootstrap before React mounts
- Storage: Cloudflare KV for best-effort free-tier abuse limiting
- Database binding: Cloudflare D1 reserved for transactional account state; the local migration design is not applied live
- Billing: fail-closed while Stripe catalog validation, D1 migration, and one-time key delivery await supervised setup
- DNS/CDN: Cloudflare

## Local Development

```bash
npm install
npm run dev
```

`npm run dev` builds the initial asset bundle, then starts Vite with HMR at `http://localhost:5173` and the local Worker API at `http://localhost:8787`. Vite proxies `/mjd`, `/jd`, `/success`, and `/webhook` to the Worker.

Useful commands:

```bash
npm test          # Node Worker/billing tests + Vitest React tests
npm run check     # TypeScript + Worker/billing syntax checks
npm run build     # Production Vite bundle
npm run dev:worker
```

Deploy only when explicitly authorized:

```bash
npm run deploy
```

## Launch Note

Paid launch is **NO-GO**. The current local hardening branch disables payment links, authenticated access, webhooks, and API-key disclosure until the D1 migration, Stripe catalog, account binding, and one-time key delivery can be rehearsed under supervision. Do not casually deploy or push without checking the active git state and confirming the Cloudflare/Stripe boundary.

## License

MIT

---

[spydergoat.com](https://spydergoat.com) · [contact@spydergoat.com](mailto:contact@spydergoat.com)
