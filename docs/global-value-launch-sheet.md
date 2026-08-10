# SpyderGoat Global Value Launch Sheet

Date: 2026-06-24 / 2026-06-25 overnight sprint

## Core read

Adam's instinct is right: time has global value because software, agents, ledgers, audits, satellites, simulations, and workflows all need shared temporal truth.

The fast product sentence is not just:

"Accurate time for anything."

It is:

"Trusted time for software that needs receipts."

## Positioning

SpyderGoat is a tiny external time anchor for:

- AI agents that need live temporal context;
- autonomous tool runs that need receipts;
- audit logs and webhooks;
- scientific/satellite/simulation time math;
- distributed systems avoiding timezone/local-clock weirdness.

## Why this can travel globally

- Time is universal infrastructure.
- MJD/JD are niche but real scientific/technical formats.
- AI-agent builders need external truth anchors.
- The endpoint is simple enough for any language.
- The free tier creates immediate proof.
- Paid tier is impulse-priced for developers.

## First wedge audiences

### 1. AI agent builders

Pain:

"My agent does not know what time it is and I need timestamped decisions/tool logs."

Message:

"Give your agent a tiny external clock receipt: UTC, Unix, MJD, JD. One call."

### 2. DevOps / webhook / audit-log builders

Pain:

"I want event receipts that do not depend only on the app server's local clock."

Message:

"Add an external edge timestamp receipt to jobs, webhooks, and audit trails."

### 3. Astronomy / satellite / science hackers

Pain:

"I need MJD/JD without calendar/timezone nonsense."

Message:

"MJD/JD over HTTP. Tiny, boring, useful."

### 4. Developer toy / API directories

Pain:

"I want a simple useful API to test with."

Message:

"NTP-ish timestamp API with MJD/JD and free use."

## Product ladder

### Free

- no signup;
- 1 request / 30 min;
- useful for testing and demos.

### Pro

- $4.89/mo;
- 5,000 requests/month;
- API key;
- no free-tier wait.

### Wallet

- $0.001/request;
- prepaid;
- no expiration.

### Future higher-value layer

Do not build yet, but possible:

- signed timestamp receipts;
- batch receipts;
- uptime/status receipts;
- agent SDK snippets;
- MCP tool / Hermes plugin;
- audit bundle for regulated workflows;
- teams/organization API keys.

## Build changes made in this slice

- Repositioned landing-page hero copy around agents, audits, satellites, ledgers, and systems that need timestamp receipts.
- Added "Time Is Infrastructure" value section.
- Added use-case cards: AI agents, audit trails, scientific systems, global software.
- Fixed API example copy.
- Rewrote README around the global value wedge.

## Do not build yet

- signed receipts;
- accounts dashboard;
- SDKs in five languages;
- enterprise pricing;
- public launch blast;
- live deploy;
- Stripe changes.

Those come after we verify current live billing/provisioning and decide the launch surface.

## Next safe technical action

Run local Worker preview and inspect the rendered page:

```bash
cd /home/adam/Desktop/spydergoat/spydergoat
npm run dev
```

Then open the local wrangler URL.

## Next business action

Create a tiny launch post aimed at AI-agent builders:

"AI agents hallucinate time. SpyderGoat gives them a tiny external clock receipt: UTC, Unix, MJD, JD. Free endpoint, one call."

Do not post until Adam explicitly approves the channel/message.
