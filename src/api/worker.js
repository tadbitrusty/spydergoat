import { D1BillingRepository } from '../billing/d1-repository.js';
import { authenticateApiKey, consumePaidRequest, createProCheckout, processStripeEvent, validateCheckoutSession } from '../billing/service.js';
import { StripeBillingClient } from '../billing/stripe-client.js';
import { verifyStripeSignature } from '../billing/stripe.js';
import { claimAndDecryptApiKey } from '../billing/key-delivery.js';

const RATE_LIMIT_MS = 1_800_000;
const MAX_WEBHOOK_BYTES = 65_536;
const API_CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};
const SECURITY = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data: https://pub-972f1410bb404f91bce6fb7c715b72e4.r2.dev; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
};
const ASSET_SECURITY = {
  ...SECURITY,
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
};

export function getMJD(unixMs) { return unixMs / 86_400_000 + 40_587; }
export function getJD(mjd) { return mjd + 2_400_000.5; }

export function buildTimeResponse(now, includeJD = false) {
  const mjd = getMJD(now);
  const value = {
    mjd: Number(mjd.toFixed(8)),
    utc: new Date(now).toISOString(),
    unix: Math.floor(now / 1000),
    source: 'server',
  };
  if (includeJD) value.jd = Number(getJD(mjd).toFixed(8));
  return value;
}

function clientIP(request) {
  return request.headers.get('CF-Connecting-IP') || 'unknown';
}

async function checkFreeRateLimit(request, env) {
  if (!env.SPYDERGOAT_KV) return { allowed: true, retryAfter: 0 };
  const key = `rate:free:${clientIP(request)}`;
  const now = Date.now();
  const previous = Number(await env.SPYDERGOAT_KV.get(key));
  if (Number.isFinite(previous) && now - previous < RATE_LIMIT_MS) {
    return { allowed: false, retryAfter: Math.ceil((RATE_LIMIT_MS - (now - previous)) / 1000) };
  }
  await env.SPYDERGOAT_KV.put(key, String(now), { expirationTtl: 1800 });
  return { allowed: true, retryAfter: 0 };
}

function json(value, status = 200, headers = {}) {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers } });
}

function sensitiveUnavailable() {
  return new Response('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="robots" content="noindex,nofollow"><title>Paid access paused</title><body><main><h1>Paid access is paused</h1><p>Account and key delivery are unavailable while transactional billing is being hardened.</p><p><a href="/">Back to Spydergoat</a></p></main></body></html>', {
    status: 503,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store, private', Pragma: 'no-cache', ...SECURITY },
  });
}

function staticShellUnavailable() {
  return new Response('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="robots" content="noindex"><title>SpyderGoat temporarily unavailable</title><body><main><h1>SpyderGoat is temporarily unavailable</h1><p>The static application shell could not be verified. The time API remains available at <a href="/mjd">/mjd</a>.</p></main></body></html>', {
    status: 503,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', ...ASSET_SECURITY },
  });
}

async function assetHomepage(request, env) {
  const requestHeaders = new Headers(request.headers);
  for (const name of ['If-None-Match', 'If-Modified-Since', 'If-Match', 'If-Unmodified-Since', 'If-Range', 'Range']) {
    requestHeaders.delete(name);
  }
  const assetRequest = new Request(request.url, { method: 'GET', headers: requestHeaders });
  const asset = await env.ASSETS.fetch(assetRequest);
  const headers = new Headers(asset.headers);
  for (const name of ['Content-Length', 'Content-Encoding', 'Content-Range', 'ETag', 'Last-Modified', 'Accept-Ranges', 'CF-Cache-Status']) {
    headers.delete(name);
  }
  headers.set('Cache-Control', 'no-store');
  for (const [name, value] of Object.entries(ASSET_SECURITY)) headers.set(name, value);

  if (asset.status >= 300 && asset.status < 400) {
    return new Response(null, { status: asset.status, headers });
  }
  if (asset.status !== 200 || !headers.get('Content-Type')?.toLowerCase().includes('text/html')) {
    return staticShellUnavailable();
  }

  const html = await asset.text();
  const marker = '__SPYDERGOAT_BOOTSTRAP__';
  if (html.split(marker).length !== 2) return staticShellUnavailable();
  if (request.method === 'HEAD') return new Response(null, { status: 200, headers });

  const bootstrap = JSON.stringify(buildTimeResponse(Date.now())).replaceAll('<', '\\u003c');
  return new Response(html.replace(marker, bootstrap), { status: 200, headers });
}

function homepage(now) {
  const initial = buildTimeResponse(now);
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Spydergoat — Modified Julian Date (MJD) API</title>
<meta name="description" content="Get server-derived Modified Julian Date, UTC, and Unix time over HTTP. A compact external time reference for software.">
<link rel="canonical" href="https://spydergoat.com/"><link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='12' fill='%230A0F1E'/%3E%3Ctext x='12' y='46' font-size='40' fill='%23F5B23F'%3ES%3C/text%3E%3C/svg%3E"><meta name="theme-color" content="#0A0F1E">
<meta property="og:title" content="Spydergoat — MJD Time API"><meta property="og:description" content="Server-derived MJD, UTC, and Unix time over HTTP."><meta property="og:url" content="https://spydergoat.com/"><meta property="og:type" content="website">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"WebAPI","name":"Spydergoat MJD API","url":"https://spydergoat.com/mjd","documentation":"https://spydergoat.com/#docs"}</script>
<style>
:root{--ink:#0A0F1E;--surface:#121A31;--surface2:#0E1527;--line:#25304E;--amber:#F5B23F;--star:#E9EDF8;--muted:#9DA7C2;--mono:ui-monospace,SFMono-Regular,Consolas,monospace;--sans:system-ui,-apple-system,sans-serif}
*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:var(--ink);color:var(--star);font:16px/1.6 var(--sans)}a{color:var(--amber)}a:focus-visible{outline:3px solid var(--amber);outline-offset:3px}.skip{position:absolute;left:-999px}.skip:focus{left:12px;top:12px;background:var(--ink);padding:10px;z-index:20}.wrap{max-width:1080px;margin:auto;padding:0 24px}nav{position:sticky;top:0;z-index:10;background:#0a0f1ef2;border-bottom:1px solid var(--line)}.nav{min-height:60px;display:flex;align-items:center;gap:20px}.brand{color:var(--star);font-weight:700;text-decoration:none}.links{margin-left:auto;display:flex;gap:18px;flex-wrap:wrap}.links a{color:var(--muted);padding:12px 0}header{padding:70px 0 44px}.eyebrow,.kicker{font:12px var(--mono);letter-spacing:.16em;text-transform:uppercase;color:var(--amber)}h1{max-width:760px;font-size:clamp(30px,5vw,50px);line-height:1.12}.lede,.sub{max-width:680px;color:var(--muted)}.clock{margin:42px 0;font-family:var(--mono)}.mjd{font-size:clamp(36px,8vw,82px);font-weight:700;color:var(--amber);overflow-wrap:anywhere}.utc,.status{color:var(--muted);font-size:14px}.actions{display:flex;gap:12px;flex-wrap:wrap}.btn{padding:12px 18px;border:1px solid var(--line);border-radius:6px;text-decoration:none}.primary{background:var(--amber);color:var(--ink);font-weight:700}.ruler{margin-top:50px;padding:24px 0;border-block:1px solid var(--line);overflow:auto}.track{min-width:650px;display:grid;grid-template-columns:repeat(4,1fr);gap:16px}.tick{border-top:2px solid var(--line);padding-top:12px;color:var(--muted);font:12px var(--mono)}.tick strong{display:block;color:var(--star)}.tick.now{border-color:var(--amber)}.tick.now strong{color:var(--amber)}section{padding:68px 0;scroll-margin-top:70px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:1px;background:var(--line);border:1px solid var(--line)}.card{background:var(--surface2);padding:24px}.card p{color:var(--muted)}.cases article{display:grid;grid-template-columns:1fr 1.2fr;gap:28px;padding:28px 0;border-top:1px solid var(--line)}pre{margin:0;background:var(--surface2);border:1px solid var(--line);padding:18px;overflow:auto;color:var(--star)}.trust,.pricing{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:18px}.panel{padding:25px;background:var(--surface);border:1px solid var(--line);border-radius:8px}.panel b{display:block;color:var(--amber);font:600 22px var(--mono)}.paused{border-color:var(--amber)}.badge{display:inline-block;padding:7px 10px;border:1px solid var(--amber);color:var(--amber);font:13px var(--mono)}footer{padding:36px 0;border-top:1px solid var(--line);color:var(--muted)}
@media(max-width:760px){.cases article{grid-template-columns:1fr}.nav{align-items:flex-start;padding-block:10px}.links{gap:10px}.links a{min-height:44px}.actions .btn{flex:1;text-align:center}}
@media (max-width:600px){.wrap{padding-inline:18px}.nav{display:block}.links{margin:4px 0 0}.links a{font-size:13px}.track{min-width:0;grid-template-columns:1fr 1fr}.mjd{font-size:clamp(32px,12vw,52px)}}
@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}}
</style></head><body><a class="skip" href="#content">Skip to content</a>
<nav aria-label="Primary"><div class="wrap nav"><a class="brand" href="#top">spydergoat</a><div class="links"><a href="#why">Why MJD</a><a href="#cases">Use cases</a><a href="#docs">Docs</a><a href="#pricing">Pricing</a></div></div></nav>
<main id="content"><header id="top"><div class="wrap"><div class="eyebrow">Modified Julian Date · Time API</div><h1>A compact external time reference for software.</h1><p class="lede">Spydergoat returns server-derived MJD, UTC, and Unix time in one small JSON response. Use it to normalize and correlate event timestamps across systems.</p>
<div class="clock"><div>Current MJD</div><div class="mjd" id="mjd">${initial.mjd.toFixed(8)}</div><time class="utc" id="utc" datetime="${initial.utc}">${initial.utc}</time><div class="status" id="clock-status">Server-rendered value advanced locally.</div></div>
<div class="actions"><a class="btn primary" href="/mjd">Try the free endpoint</a><button class="btn" id="calibrate" type="button">Calibrate display from /mjd</button><a class="btn" href="#docs">Read the response</a></div>
<figure class="ruler" aria-label="Time epoch ruler"><div class="track"><div class="tick"><strong>JD 0</strong>4713 BCE · Julian calendar</div><div class="tick"><strong>MJD 0</strong>17 Nov 1858</div><div class="tick"><strong>MJD 40587</strong>Unix epoch · 1970</div><div class="tick now"><strong id="ruler-now">MJD ${Math.floor(initial.mjd)}</strong>server-derived today</div></div><figcaption class="status">MJD = JD − 2,400,000.5. The fractional part represents time of day on the stated scale.</figcaption></figure></div></header>
<section id="why"><div class="wrap"><div class="kicker">Why MJD</div><h2>Time as one comparable number</h2><p class="sub">MJD can reduce timezone and calendar-conversion work when systems share the same stated time convention.</p><div class="grid"><article class="card"><h3>Timezone-independent</h3><p>A numeric UTC-derived representation without a local timezone offset.</p></article><article class="card"><h3>Simple arithmetic</h3><p>Subtract values to compare nominal elapsed days; leap-second-sensitive work still needs an explicit time scale.</p></article><article class="card"><h3>Sortable</h3><p>Useful for numeric comparisons, range queries, and cross-system event correlation.</p></article><article class="card"><h3>Documented precision</h3><p>Eight decimal places are returned from a millisecond-resolution server clock; digits are not an accuracy guarantee.</p></article></div></div></section>
<section id="cases" class="cases"><div class="wrap"><div class="kicker">Use cases</div><h2>Where a shared reference helps</h2><article><div><h3>Agent and audit receipts</h3><p class="sub">Record when a tool run, approval, or state transition occurred using a small external response.</p></div><pre>{ "mjd": ${initial.mjd.toFixed(8)},
  "source": "server" }</pre></article><article><div><h3>Cross-system correlation</h3><p class="sub">Normalize application events to a common numeric representation before sorting or querying.</p></div><pre>ORDER BY event_mjd ASC</pre></article><article><div><h3>Science integrations</h3><p class="sub">Exchange MJD/JD values with astronomy and mission-oriented tooling while documenting the time scale.</p></div><pre>MJD = unix_ms / 86400000 + 40587</pre></article></div></section>
<section id="trust"><div class="wrap"><div class="kicker">Runtime facts</div><h2>Small and inspectable</h2><div class="trust"><div class="panel"><b>/mjd</b><span>Public JSON endpoint</span></div><div class="panel"><b>/jd</b><span>Includes Julian Date</span></div><div class="panel"><b>no-store</b><span>Time responses are not cached</span></div><div class="panel"><b>server</b><span>Source marker in every response</span></div></div></div></section>
<section id="docs"><div class="wrap"><div class="kicker">Docs</div><h2>The whole public API fits here</h2><p><code>GET https://spydergoat.com/mjd</code></p><pre>{
  "mjd": ${initial.mjd.toFixed(8)},
  "utc": "${initial.utc}",
  "unix": ${initial.unix},
  "source": "server"
}</pre><p class="sub">The free endpoint currently allows one request per IP every 30 minutes. <code>/jd</code> returns the same fields plus <code>jd</code>.</p></div></section>
<section id="pricing"><div class="wrap"><div class="kicker">Access</div><h2>Free endpoint available; paid access paused</h2><div class="pricing"><div class="panel"><h3>Free</h3><b>$0</b><p>One request per IP every 30 minutes. No signup.</p><a href="/mjd">Use /mjd</a></div><div class="panel paused"><h3>Pro · $4.89/month</h3><span class="badge">Not currently available</span><p>Paid access is paused while transactional accounting, replay protection, and key delivery are hardened.</p></div><div class="panel paused"><h3>Wallet · $0.001/request</h3><span class="badge">Top-ups disabled</span><p>No payment link is exposed until account binding and ledger behavior pass supervised rehearsal.</p></div></div></div></section></main>
<footer><div class="wrap">Spydergoat · server-derived MJD, UTC, and Unix time over HTTP.</div></footer>
<script>(function(){var mjdNode=document.getElementById('mjd'),utcNode=document.getElementById('utc'),status=document.getElementById('clock-status'),ruler=document.getElementById('ruler-now'),calibrate=document.getElementById('calibrate');var baseMjd=${initial.mjd},basePerf=performance.now(),baseUtc=Date.parse('${initial.utc}');function draw(){var elapsed=performance.now()-basePerf;var value=baseMjd+elapsed/86400000;mjdNode.textContent=value.toFixed(8);var date=new Date(baseUtc+elapsed);utcNode.textContent=date.toISOString();utcNode.dateTime=date.toISOString();ruler.textContent='MJD '+Math.floor(value)}calibrate.addEventListener('click',function(){calibrate.disabled=true;status.textContent='Calibrating once from /mjd…';fetch('/mjd',{headers:{Accept:'application/json'}}).then(function(response){if(!response.ok)throw new Error('status');return response.json()}).then(function(data){if(!Number.isFinite(data.mjd)||typeof data.utc!=='string')throw new Error('shape');baseMjd=data.mjd;baseUtc=Date.parse(data.utc);basePerf=performance.now();status.textContent='Calibrated once from /mjd; display advances locally.';draw()}).catch(function(){status.textContent='Live calibration unavailable; showing the server-rendered value advanced locally.'}).finally(function(){calibrate.disabled=false})});draw();setInterval(draw,window.matchMedia('(prefers-reduced-motion: reduce)').matches?2000:1000)})();</script></body></html>`;
}

function htmlResponse(body, method) {
  return new Response(method === 'HEAD' ? null : body, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', ...SECURITY } });
}

function paidCatalog(env) {
  return {
    subscription: {
      mode: 'subscription',
      product: env.STRIPE_PRO_PRODUCT_ID,
      price: env.STRIPE_PRO_PRICE_ID,
      currency: 'usd',
      amount: Number(env.STRIPE_PRO_AMOUNT),
    },
  };
}

function checkoutOriginAllowed(request, env) {
  const origin = request.headers.get('Origin');
  const allowed = String(env.CHECKOUT_ORIGINS || '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);
  return Boolean(origin && allowed.includes(origin));
}

async function checkoutBodyIsEmpty(request) {
  if (!request.body) return true;
  const reader = request.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return true;
      if (value.byteLength > 0) {
        await reader.cancel('unexpected request body');
        return false;
      }
    }
  } catch {
    return false;
  }
}

async function handleProCheckout(request, env) {
  if (env.PAID_ACCESS_ENABLED !== 'true') return json({ error: 'paid_access_paused' }, 503);
  if (!await checkoutBodyIsEmpty(request)) return json({ error: 'unexpected_request_body' }, 400);
  if (!checkoutOriginAllowed(request, env)) return json({ error: 'origin_not_allowed' }, 403);
  if (!env.DB || !env.STRIPE_SECRET_KEY || !['true', 'false'].includes(env.STRIPE_LIVEMODE)) {
    return json({ error: 'billing_not_configured' }, 503);
  }

  try {
    const origin = new URL(request.url).origin;
    const repository = new D1BillingRepository(env.DB);
    const stripe = new StripeBillingClient(env.STRIPE_SECRET_KEY);
    const result = await createProCheckout(repository, stripe, paidCatalog(env), {
      successUrl: `${origin}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${origin}/#pricing`,
    });
    return json({ checkout_url: result.checkoutUrl });
  } catch (error) {
    console.error('checkout_unavailable', { reason: String(error?.message || 'unknown') });
    return json({ error: 'checkout_unavailable' }, 503);
  }
}

function decodeDeliverySecret(value) {
  const text = String(value || '');
  if (!/^[A-Za-z0-9+/]{43}=$/.test(text)) throw new Error('delivery secret');
  const binary = atob(text);
  if (binary.length !== 32) throw new Error('delivery secret');
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

async function readWebhookBody(request) {
  const declaredLength = Number(request.headers.get('Content-Length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_WEBHOOK_BYTES) throw new RangeError('payload too large');
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_WEBHOOK_BYTES) {
      await reader.cancel('payload too large');
      throw new RangeError('payload too large');
    }
    chunks.push(value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder('utf-8', { fatal: true }).decode(body);
}

async function handleWebhook(request, env) {
  if (env.PAID_ACCESS_ENABLED !== 'true') return json({ error: 'paid_access_paused' }, 503);
  if (!env.DB || !env.STRIPE_WEBHOOK_SECRET || !env.STRIPE_SECRET_KEY || !['true', 'false'].includes(env.STRIPE_LIVEMODE)) {
    return json({ error: 'billing_not_configured' }, 503);
  }
  let deliverySecret;
  try { deliverySecret = decodeDeliverySecret(env.API_KEY_DELIVERY_SECRET_BASE64); }
  catch { return json({ error: 'billing_not_configured' }, 503); }

  let raw;
  try { raw = await readWebhookBody(request); }
  catch (error) { return json({ error: error instanceof RangeError ? 'payload_too_large' : 'invalid_payload' }, error instanceof RangeError ? 413 : 400); }

  const verification = await verifyStripeSignature(raw, request.headers.get('Stripe-Signature'), env.STRIPE_WEBHOOK_SECRET);
  if (!verification.valid) return json({ error: 'invalid_signature' }, 400);

  let event;
  try { event = JSON.parse(raw); }
  catch { return json({ error: 'invalid_payload' }, 400); }

  const supported = new Set([
    'checkout.session.completed', 'invoice.paid', 'invoice.payment_failed',
    'customer.subscription.updated', 'customer.subscription.deleted',
  ]);
  if (!supported.has(event?.type)) return json({ received: true, ignored: true });

  try {
    if (event.type === 'checkout.session.completed') {
      const sessionId = event.data?.object?.id;
      if (!sessionId) throw new Error('Checkout Session ID is required');
      const stripe = new StripeBillingClient(env.STRIPE_SECRET_KEY);
      event = { ...event, data: { object: await stripe.retrieveCheckoutSession(sessionId) } };
    }
    const result = await processStripeEvent(new D1BillingRepository(env.DB), event, paidCatalog(env), {
      livemode: env.STRIPE_LIVEMODE === 'true', deliverySecret,
    });
    return json({ received: true, replayed: Boolean(result.replayed), stale: Boolean(result.stale) });
  } catch {
    return json({ error: 'webhook_rejected' }, 400);
  }
}

function successPage(apiKey) {
  const content = apiKey
    ? `<h1>Your SpyderGoat API key</h1><p>This key is shown once. Save it now.</p><code>${apiKey}</code>`
    : '<h1>Key delivery unavailable</h1><p>The webhook may still be processing, or this one-time key was already viewed or expired.</p>';
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SpyderGoat key delivery</title><style>body{max-width:48rem;margin:4rem auto;padding:1rem;font:18px system-ui;background:#101114;color:#f5f5f5}code{display:block;overflow-wrap:anywhere;padding:1rem;background:#202228;border:1px solid #555;border-radius:.5rem}</style><main>${content}</main></html>`;
}

function sensitiveHtml(apiKey, status = 200) {
  return new Response(successPage(apiKey), {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store, max-age=0',
      Pragma: 'no-cache',
      'Referrer-Policy': 'no-referrer',
      'X-Robots-Tag': 'noindex, nofollow',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

async function handleSuccess(request, env) {
  if (env.PAID_ACCESS_ENABLED !== 'true') return sensitiveUnavailable();
  if (!env.DB || !env.STRIPE_SECRET_KEY || !['true', 'false'].includes(env.STRIPE_LIVEMODE)) return sensitiveUnavailable();
  let deliverySecret;
  try { deliverySecret = decodeDeliverySecret(env.API_KEY_DELIVERY_SECRET_BASE64); }
  catch { return sensitiveUnavailable(); }
  const url = new URL(request.url);
  const parameters = [...url.searchParams.entries()];
  const sessionId = parameters.length === 1 && parameters[0][0] === 'session_id' ? parameters[0][1] : '';
  if (!/^cs_[0-9a-z_]{8,255}$/i.test(sessionId)) return sensitiveHtml(null, 400);
  try {
    const stripe = new StripeBillingClient(env.STRIPE_SECRET_KEY);
    const session = await stripe.retrieveCheckoutSession(sessionId);
    const accountId = session?.metadata?.spydergoat_account_id;
    const validation = validateCheckoutSession(session, paidCatalog(env), {
      livemode: env.STRIPE_LIVEMODE === 'true', accountId,
    });
    if (!validation.ok) return sensitiveHtml(null, 409);
    const rawKey = await claimAndDecryptApiKey(new D1BillingRepository(env.DB), {
      accountId, checkoutSessionId: sessionId, secret: deliverySecret, now: Math.floor(Date.now() / 1000),
    });
    return sensitiveHtml(rawKey, rawKey ? 200 : 409);
  } catch {
    return sensitiveHtml(null, 409);
  }
}

function bearerApiKey(value) {
  const match = /^Bearer (sg_[0-9a-f]{48})$/i.exec(String(value || ''));
  return match?.[1] || null;
}

async function handlePaidApi(request, env, path, method) {
  if (env.PAID_ACCESS_ENABLED !== 'true') return json({ error: 'paid_access_paused' }, 503, API_CORS);
  if (!env.DB) return json({ error: 'billing_not_configured' }, 503, API_CORS);
  const rawKey = bearerApiKey(request.headers.get('Authorization'));
  if (!rawKey) return json({ error: 'invalid_api_key' }, 401, { 'WWW-Authenticate': 'Bearer', ...API_CORS });
  try {
    const repository = new D1BillingRepository(env.DB);
    const now = Math.floor(Date.now() / 1000);
    const account = await authenticateApiKey(repository, rawKey, now);
    if (method === 'HEAD') {
      return new Response(null, { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...API_CORS } });
    }
    const allowance = await consumePaidRequest(repository, account.id, now);
    if (!allowance.allowed) {
      return json({ error: 'paid_quota_exhausted' }, 429, { 'X-RateLimit-Limit': '5000', 'X-RateLimit-Remaining': '0', ...API_CORS });
    }
    const remaining = Math.max(0, 5000 - allowance.calls);
    return new Response(JSON.stringify(buildTimeResponse(Date.now(), path === '/jd')), {
      headers: {
        'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
        'X-RateLimit-Limit': '5000', 'X-RateLimit-Remaining': String(remaining), ...API_CORS,
      },
    });
  } catch (error) {
    if (error?.message === 'Invalid API key') {
      return json({ error: 'invalid_api_key' }, 401, { 'WWW-Authenticate': 'Bearer', ...API_CORS });
    }
    return json({ error: 'paid_access_unavailable' }, 503, API_CORS);
  }
}

async function handle(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;
  const isApi = path === '/mjd' || path === '/jd';

  if (method === 'OPTIONS') {
    if (!isApi) return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD' } });
    return new Response(null, { status: 204, headers: API_CORS });
  }
  if (path === '/checkout/pro') {
    if (method !== 'POST') return json({ error: 'method_not_allowed' }, 405, { Allow: 'POST' });
    return handleProCheckout(request, env);
  }
  if (path === '/webhook') {
    if (method !== 'POST') return json({ error: 'method_not_allowed' }, 405, { Allow: 'POST' });
    return handleWebhook(request, env);
  }
  if (path === '/success') {
    if (method !== 'GET') return json({ error: 'method_not_allowed' }, 405, { Allow: 'GET' });
    return handleSuccess(request, env);
  }
  if (!['GET', 'HEAD'].includes(method)) {
    return json({ error: 'method_not_allowed' }, 405, { Allow: isApi ? 'GET, HEAD, OPTIONS' : 'GET, HEAD' });
  }
  if ((path === '/' || path === '/index.html') && env.ASSETS) return assetHomepage(request, env);
  if (path === '/' || path === '/index.html') return htmlResponse(homepage(Date.now()), method);
  if (path === '/robots.txt') return new Response(method === 'HEAD' ? null : 'User-agent: *\nAllow: /\nSitemap: https://spydergoat.com/sitemap.xml\n', { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  if (path === '/sitemap.xml') return new Response(method === 'HEAD' ? null : '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://spydergoat.com/</loc></url></urlset>', { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
  if (isApi) {
    if (request.headers.has('Authorization')) return handlePaidApi(request, env, path, method);
    if (method === 'HEAD') return new Response(null, { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...API_CORS } });
    const limit = await checkFreeRateLimit(request, env);
    if (!limit.allowed) return json({ error: 'rate_limited', message: 'Free tier: 1 request per 30 minutes', retry_after: limit.retryAfter }, 429, { 'Retry-After': String(limit.retryAfter), ...API_CORS });
    return new Response(JSON.stringify(buildTimeResponse(Date.now(), path === '/jd')), { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...API_CORS } });
  }
  return json({ error: 'not_found', endpoints: ['/', '/mjd', '/jd'] }, 404);
}

export default { fetch: handle };
