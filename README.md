# SpyderGoat 🐐

**Trusted time for software that needs receipts. One API call.**

AI agents hallucinate the date. Local clocks drift. Timezones lie in wait like tiny bureaucratic demons. SpyderGoat is a dead-simple external time anchor for agents, audit trails, scientific systems, distributed jobs, and any workflow that needs a small timestamp receipt without dragging in a heavy dependency.

SpyderGoat is NTP-shaped truth for AI and software.

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

## Endpoints

| Endpoint | Description |
|---|---|
| `GET /mjd` | Returns MJD, UTC, Unix timestamp, and source |
| `GET /jd` | Same as `/mjd` plus Julian Date |
| `GET /success?session_id=...` | Fail-closed paid-access notice; no key disclosure |
| `POST /webhook` | Fail-closed until transactional billing is configured and migrated |

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
| Free | $0 | 1 request / 30 min |
| Pro | $4.89/mo | Paused pending transactional billing cutover |
| Wallet | $0.001/request | Top-ups disabled pending account binding and ledger rehearsal |

The intended prices remain recorded, but no paid checkout or wallet links are exposed by the local hardened build.

## Why MJD?

Modified Julian Date is a compact, unambiguous timestamp used by astronomers, satellite systems, and scientific computing. No timezones. No daylight saving. No ambiguous dates. Just a single numeric representation derived from the server clock. Clock corrections and time-scale caveats still apply.

```text
MJD = (unix_ms / 86400000) + 40587
JD  = MJD + 2400000.5
```

## Stack

- Runtime: Cloudflare Workers
- Storage: Cloudflare KV for free rate limiting
- Database binding: Cloudflare D1 reserved for transactional account state; local migration design is not applied live
- Billing: fail-closed while Stripe catalog validation, D1 migration, and one-time key delivery await supervised setup
- DNS/CDN: Cloudflare

## Local Development

```bash
npm install
npm run dev
```

Tests and syntax checks:

```bash
npm test
npm run check
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
