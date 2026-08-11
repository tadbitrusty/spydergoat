# Spydergoat - Real-Time Atomic Modified Julian Clock

> **Historical concept document — superseded for v1.1.** This January 2026 plan records the original product hypothesis, not the current runtime or release contract. SpyderGoat v1.1 uses the Cloudflare Worker clock and does **not** claim NIST/GPS synchronization, atomic-clock accuracy, signed receipts, or a measured uptime SLA. Use `README.md` and `docs/v1.1-release-candidate-2026-08-10.md` for current behavior and release posture.

**Domain:** spydergoat.com (owned, Cloudflare, locked 10 years through 2036)
**Tagline:** "One number. Always right. Solve temporal drift."

---

## The Problem (Documented Proof)

AI systems cannot reliably tell time. Tested December 2024 against production Claude:

**Failure Modes Identified:**
1. No instinct to ground temporally
2. No self-correction after temporal errors
3. Web search results are cached/stale
4. Authoritative time sources use client-side JS (unscrapable)
5. Some URLs error out silently
6. Even server-rendered times can be ~2 hours stale

**The Gap:** Every AI provider (Anthropic, OpenAI, Google) has this problem. None have solved it natively. All can convert Julian - it's basic math. None have a reliable source to fetch from.

**The Solution:** NTP for AI. A canonical time source that returns one number, always accurate, always available.

---

## Product Definition

### What It Is
- Single-page website with MJD ticker
- JSON API endpoint
- Synced to atomic clock source (NIST/GPS)
- Server-rendered (no JS required for scraping)
- Absurd goat in sunglasses in hero section

### What It Is NOT
- Pretty UI beyond the basics
- User accounts (at MVP)
- Analytics dashboards
- Timezone pickers
- World clock displays
- Any feature that doesn't solve temporal drift

---

## Technical Spec

### Format Decision: MJD (Modified Julian Date)
- MJD = JD - 2,400,000.5
- Midnight epoch (intuitive)
- Smaller number: `61031.37` instead of `2461031.87`
- Adopted by IAU in 1973
- Used by NASA, ESA, telecom standards, GPS

### API Endpoints

```
GET /              → HTML page with ticker
GET /mjd           → JSON: { "mjd": 61031.87452, "timestamp": "2026-01-24T..." }
GET /jd            → JSON: { "jd": 2461031.87452 }  (optional, standard Julian)
GET /tz/{zone}     → JSON: { "timezone": "EST", "time": "14:30:00", "mjd": ... }
```

### Response Format
```json
{
  "mjd": 61031.87452,
  "jd": 2461031.87452,
  "utc": "2026-01-24T20:59:18.528Z",
  "unix": 1737752358,
  "source": "NIST",
  "accuracy": "±0.001s"
}
```

### Integration Example
```python
import requests

mjd = requests.get('https://spydergoat.com/mjd').json()['mjd']
# done. you have the time.
```

---

## Architecture

### Infrastructure
```
[NIST/GPS Atomic Source] → [Spydergoat Server] → [REST/Scrape] → [AI Systems]
```

### Hosting: Cloudflare Workers
- Free tier: 100k requests/day
- Paid tier ($5/mo): 10M requests/month
- No cold starts
- Global edge deployment
- Already using Cloudflare for DNS

### Data Persistence (for billing)
- Cloudflare KV (free tier available) OR
- Supabase (you already have one) OR
- Simple SQLite on Hetzner

### Atomic Time Sync
- Primary: NIST time servers
- Sync interval: Every minute or on-demand
- Display verification: "Synchronized to NIST atomic clock"

---

## Billing Model (Final from this conversation)

### Tiers

| Tier | Price | Calls | Rate Limit |
|------|-------|-------|------------|
| Free | $0 | Unlimited | 1 per 30 min |
| Paid | $4.89/mo | 5,000/mo | None |
| Overage | $0.001/call | From wallet | None |

### How It Works
1. **$4.89/month subscription** - covers first 5k calls, no rate limit
2. **Wallet** - prepaid balance for overages at $0.001/call
3. **Wallet empty** - drops to 1 call per 30 min ("make engineering yell at accounting" tier)

### Key Design Decisions
- No invoicing - Stripe collects, deposits weekly
- No refunds - wallet balance carries forward
- Usage tracking is THEIR problem (another API call if they want logs)
- No monthly reconciliation, no billing complexity

### Payment Flow
```
User tops up wallet → Stripe deposits to you weekly
Monthly: charge $4.89, reset 5k allowance
Over 5k: decrement wallet at $0.001/call
Wallet = $0: throttle to 1/30min until top-up or next month
```

### Data Model
```sql
users:
  - user_id
  - stripe_customer_id
  - wallet_balance
  - current_period_calls
  - period_start
  - api_key
```

---

## Billing Infrastructure

### Components
1. **Cloudflare Workers** - handles auth, rate limiting, call counting
2. **Stripe** - subscriptions + usage-based billing
3. **Cloudflare KV or Supabase** - wallet balances, usage counts

### Gateway Logic
```
if wallet > 0:
    charge wallet, allow call
elif calls_this_period < 5000:
    allow call
else:
    if last_call > 30_min_ago:
        allow call
    else:
        reject with "try again in X minutes"
```

---

## Frontend Spec

### Hero Section
- Absurd goat in sunglasses (brand identity)
- Pleasing color background
- MJD ticker in a box, updating real-time
- Clean, minimal, weird

### Single Page Layout
```
[HERO: Goat + Ticker]

[API Documentation]
- One endpoint
- One code example
- That's it

[Pricing]
- Free: 1/30min
- $4.89/mo: 5k calls
- Overage: $0.001/call

[Sign Up / Get API Key]

[Footer: GitHub link, Stripe badge]
```

---

## Build Phases

### Phase 1: Core (MVP)
- [ ] Cloudflare Worker: returns MJD synced to atomic source
- [ ] HTML page with ticker (server-rendered)
- [ ] JSON endpoint: /mjd
- [ ] Deploy to spydergoat.com
- [ ] GitHub repo (open source core)

### Phase 2: Billing
- [ ] Stripe integration (subscription + wallet top-ups)
- [ ] API key generation
- [ ] Rate limiting logic
- [ ] Cloudflare KV for user state

### Phase 3: Polish
- [ ] Goat hero graphic
- [ ] Documentation page
- [ ] Usage dashboard (minimal - just balance/calls remaining)

---

## File Structure

```
spydergoat/
├── BUILD_PLAN.md          # This file
├── README.md              # Public-facing, why this exists
├── docs/
│   ├── PROBLEM.md         # The temporal drift documentation
│   └── API.md             # Endpoint documentation
├── src/
│   ├── api/
│   │   ├── worker.js      # Cloudflare Worker (main logic)
│   │   └── auth.js        # API key validation
│   └── frontend/
│       └── index.html     # Single page app
├── assets/
│   └── goat.svg           # The absurd goat
└── wrangler.toml          # Cloudflare config
```

---

## Operating Costs (Estimated)

| Item | Cost |
|------|------|
| Domain | $10.46/yr (prepaid 10 years) |
| Cloudflare Workers Paid | $5/mo |
| Stripe fees | 2.9% + $0.30 per transaction |
| **Total before revenue** | ~$5/mo |

Breakeven: 2 paying customers at $4.89/mo

---

## Revenue Projections

| Users | Monthly Revenue |
|-------|-----------------|
| 10 | $48.90 |
| 100 | $489 |
| 1000 | $4,890 |
| + overage | Variable |

At scale, this is passive income. Build once, maintain rarely.

---

## The Brand

**Spydergoat** = 
1. Transgenic bioengineered goats producing spider silk (real science)
2. GOAT = God of All Time (not greatest)
3. Spyder = web crawler, network, weaving connections
4. Google spider crawlers indexing the web

The name has layers. The more someone digs, the more they find.

---

## Origin Story

Discovered accidentally during a temporal grounding test, December 2024. Documented four distinct failure modes against a production AI system in five minutes. The conversation proving the problem IS the documentation.

---

## Success Criteria

1. API returns accurate MJD within ±1 second
2. 99.9% uptime
3. Build once, never touch (except security updates)
4. Passive income covering hosting + profit

---

## Next Actions

1. [ ] Create Cloudflare Worker skeleton
2. [ ] Implement atomic time sync
3. [ ] Design goat graphic
4. [ ] Set up Stripe
5. [ ] Write README
6. [ ] Deploy MVP
7. [ ] Announce on GitHub

---

*"One number. Always right. Solve temporal drift."*

*Last updated: 2026-01-24 by Adam, Head of IT / Circuit Magician*
