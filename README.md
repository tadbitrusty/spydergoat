# SpyderGoat 🐐

**Accurate time for anything. One API call.**

AI agents hallucinate the date. `datetime.now()` is local and untrustworthy. SpyderGoat is a dead-simple external time anchor — one endpoint, always accurate, always available.

## The Problem

LLMs have training cutoffs and no reliable way to know *when* they actually are. Building agents that need timestamped decisions, audit trails, or time-sensitive logic? You need a trusted external source.

SpyderGoat is NTP for AI.

## Usage

```bash
# Free tier — no signup required
curl https://spydergoat.com/mjd
```

```json
{
  "mjd": 61107.38012500,
  "utc": "2026-03-08T09:07:22.000Z",
  "unix": 1772960842,
  "source": "server"
}
```

```bash
# With API key (no rate limit)
curl -H "Authorization: Bearer sg_your_key" https://spydergoat.com/mjd
```

## Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /mjd` | Returns MJD, UTC, and Unix timestamp |
| `GET /jd` | Same as /mjd but includes Julian Date |

## Pricing

| Tier | Price | Limit |
|------|-------|-------|
| Free | $0 | 1 request / 30 min |
| Pro | $4.89/mo | 5,000 requests/month |
| Wallet | $0.001/request | Prepaid, never expires |

Pro tip: wallet credits roll over and never expire. Buy once, use when needed.

## Why MJD?

Modified Julian Date is a compact, unambiguous timestamp used by astronomers, satellite systems, and scientific computing. No timezones, no daylight saving, no ambiguity. Just a single floating point number that always increases.

`MJD = (unix_ms / 86400000) + 40587`

## Stack

- **Runtime:** Cloudflare Workers
- **Storage:** Cloudflare KV (rate limiting + API key management)
- **Billing:** Stripe (subscriptions + webhook provisioning)
- **DNS/CDN:** Cloudflare

## Self-Hosting

```bash
git clone https://github.com/tadbitrusty/spydergoat
cd spydergoat
npm install
cp .env.example .env  # add your Cloudflare + Stripe keys
npx wrangler deploy
```

## License

MIT

---

[spydergoat.com](https://spydergoat.com) · [contact@spydergoat.com](mailto:contact@spydergoat.com)
