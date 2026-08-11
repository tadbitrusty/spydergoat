# SpyderGoat v1.1 Global Value and Launch Sheet

**Status:** Current positioning guide; public launch still requires explicit approval.
**Authority:** React v1.1 refactor and subsequent hardening.

## Product sentence

**External server-time receipts for software. One API call.**

SpyderGoat provides a compact HTTP observation of the Cloudflare Worker clock as UTC, Unix time, MJD, and optionally JD.

It is not NTP, an atomic-clock feed, a signed timestamp authority, a monotonic clock, or an accuracy/uptime SLA.

## Why it has global value

Software, agents, logs, audits, simulations, and scientific tools need a shared time representation. SpyderGoat’s useful wedge is small and boring:

- one external server-clock observation;
- one timezone-independent numeric representation;
- one inspectable JSON response;
- no SDK or account required for the free endpoint.

## First audiences

### AI-agent builders

“Give your agent an external server-time observation: UTC, Unix, MJD, or JD.”

### DevOps and audit-log builders

“Add a small external timestamp reference to jobs, webhooks, and event records.”

### Astronomy and science tooling

“MJD/JD over HTTP, with the time-source and time-scale caveats stated plainly.”

### API directories and developer testing

“A tiny public time API with a no-signup free path.”

## Current product ladder

### Free — available in the product design

- $0;
- no signup;
- one successful GET per IP every 30 minutes, shared across `/mjd` and `/jd`;
- API `HEAD` requests do not consume quota;
- KV enforcement is best-effort abuse control.

### Pro — intended, currently paused

- $4.89/month;
- 5,000 authenticated calls per proven billing period;
- one initial API key;
- no free-tier wait;
- not launchable until checkout, webhook, entitlement, key delivery, cancellation, renewal, and allowance boundaries are proven.

### Wallet — parked

- intended price: $0.001/request;
- no top-ups or wallet links exposed;
- activation waits until Pro survives real use.

## Current interface

The React v1.1 product surface includes:

- MJD instrument panel;
- explicit server/browser provenance labels;
- epoch ruler;
- Why MJD and use-case sections;
- runtime facts;
- public API example;
- free-available and paid-paused access states;
- original SpyderGoat brand mark;
- mobile and reduced-motion behavior.

It does not contain the earlier proposed “Time Is Infrastructure” section, account dashboard, wallet UI, SDK collection, or public payment controls.

## Future value, not current claims

Possible later layers:

- signed timestamp receipts;
- batch receipts;
- status/uptime evidence;
- SDKs and an MCP/Hermes integration;
- regulated audit bundles;
- team keys and account administration.

None of these may be advertised as shipped before implementation and verification.

## Launch law

Do not post, publish, deploy, enable checkout, or describe paid access as available without Adam’s explicit approval and a current release receipt.

Current safe public wording:

> SpyderGoat gives software a compact external server-time observation as UTC, Unix time, MJD, or JD. The free endpoint requires no signup. Paid access is paused while billing and key delivery are hardened.
