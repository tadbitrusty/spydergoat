import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';

type TimeReceipt = {
  mjd: number;
  utc: string;
  unix: number;
  source: 'server' | 'browser';
};

type ClockState = {
  receipt: TimeReceipt;
  anchoredAt: number;
  status: string;
};

const MJD_UNIX_EPOCH = 40_587;
const MS_PER_DAY = 86_400_000;
const DOCUMENTED_RECEIPT: TimeReceipt = {
  mjd: 61_262.5,
  utc: '2026-08-10T12:00:00.000Z',
  unix: 1_786_363_200,
  source: 'server',
};

function localFallback(): TimeReceipt {
  const now = Date.now();
  return {
    mjd: now / MS_PER_DAY + MJD_UNIX_EPOCH,
    utc: new Date(now).toISOString(),
    unix: Math.floor(now / 1000),
    source: 'browser',
  };
}

function isReceipt(value: unknown): value is TimeReceipt {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<TimeReceipt>;
  return Number.isFinite(candidate.mjd)
    && typeof candidate.utc === 'string'
    && Number.isFinite(Date.parse(candidate.utc))
    && Number.isFinite(candidate.unix)
    && candidate.source === 'server';
}

function readBootstrap(): TimeReceipt {
  const node = document.getElementById('spydergoat-bootstrap');
  if (!node?.textContent) return localFallback();
  try {
    const parsed: unknown = JSON.parse(node.textContent);
    return isReceipt(parsed) ? parsed : localFallback();
  } catch {
    return localFallback();
  }
}

function useTimeReceipt() {
  const initial = useMemo(readBootstrap, []);
  const [clock, setClock] = useState<ClockState>({
    receipt: initial,
    anchoredAt: performance.now(),
    status: initial.source === 'server'
      ? 'Server receipt loaded. Display advances locally between calibrations.'
      : 'Browser preview. Calibrate once for a server-derived receipt.',
  });
  const [display, setDisplay] = useState(initial);
  const [loading, setLoading] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    const update = () => {
      const elapsed = performance.now() - clock.anchoredAt;
      const utcMs = Date.parse(clock.receipt.utc) + elapsed;
      setDisplay({
        ...clock.receipt,
        mjd: clock.receipt.mjd + elapsed / MS_PER_DAY,
        utc: new Date(utcMs).toISOString(),
        unix: Math.floor(utcMs / 1000),
      });
    };
    update();
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const interval = window.setInterval(update, reducedMotion ? 2_000 : 1_000);
    return () => window.clearInterval(interval);
  }, [clock]);

  async function calibrate() {
    setLoading(true);
    setClock(previous => ({ ...previous, status: 'Requesting a fresh server receipt…' }));
    try {
      const response = await fetch('/mjd', { headers: { Accept: 'application/json' } });
      if (!response.ok) {
        if (response.status === 429) {
          if (!mounted.current) return;
          const retrySeconds = Number(response.headers?.get('Retry-After'));
          const retryMinutes = Number.isFinite(retrySeconds) && retrySeconds > 0
            ? Math.ceil(retrySeconds / 60)
            : 30;
          setClock(previous => ({
            ...previous,
            status: `Calibration unavailable. Rate limit reached; try again in ${retryMinutes} ${retryMinutes === 1 ? 'minute' : 'minutes'}.`,
          }));
          return;
        }
        throw new Error(`HTTP ${response.status}`);
      }
      const data: unknown = await response.json();
      if (!isReceipt(data)) throw new Error('Unexpected response shape');
      if (!mounted.current) return;
      setDisplay(data);
      setClock({
        receipt: data,
        anchoredAt: performance.now(),
        status: 'Calibrated from SpyderGoat. Display advances locally; no polling.',
      });
    } catch {
      if (!mounted.current) return;
      setClock(previous => ({
        ...previous,
        status: 'Calibration unavailable. The existing receipt continues locally; try again later.',
      }));
    } finally {
      if (mounted.current) setLoading(false);
    }
  }

  return { display, status: clock.status, loading, calibrate };
}

function BrandMark() {
  return (
    <img
      className="brand-mark"
      src="/spydergoat-original.png"
      alt=""
      width="40"
      height="40"
      aria-hidden="true"
    />
  );
}

const useCases = [
  {
    number: '01',
    title: 'Agent and audit receipts',
    body: 'Record when a tool run, approval, or state transition occurred using one compact external response.',
    code: '{ "mjd": 61262.50000000,\n  "source": "server" }',
  },
  {
    number: '02',
    title: 'Cross-system correlation',
    body: 'Normalize application events to a common numeric representation before sorting, querying, or comparing.',
    code: 'ORDER BY event_mjd ASC',
  },
  {
    number: '03',
    title: 'Science integrations',
    body: 'Exchange MJD and JD values with astronomy and mission-oriented tooling while documenting the time scale.',
    code: 'MJD = unix_ms / 86400000 + 40587',
  },
];

const whyCards = [
  ['Timezone-independent', 'A numeric UTC-derived representation without a local timezone offset.'],
  ['Simple arithmetic', 'Subtract values to compare nominal elapsed days; leap-second-sensitive work still needs an explicit time scale.'],
  ['Sortable', 'Useful for numeric comparisons, range queries, and cross-system event correlation.'],
  ['Documented precision', 'Eight decimal places from a millisecond-resolution server clock; digits are not an accuracy guarantee.'],
];

export default function App() {
  const { display, status, loading, calibrate } = useTimeReceipt();
  const [copied, setCopied] = useState(false);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [checkoutStatus, setCheckoutStatus] = useState('');
  const documentedReceipt = display.source === 'server' ? display : DOCUMENTED_RECEIPT;
  const responseExample = JSON.stringify({
    mjd: Number(documentedReceipt.mjd.toFixed(8)),
    utc: documentedReceipt.utc,
    unix: documentedReceipt.unix,
    source: documentedReceipt.source,
  }, null, 2);

  async function copyExample() {
    try {
      await navigator.clipboard.writeText('curl https://spydergoat.com/mjd');
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_800);
    } catch {
      setCopied(false);
    }
  }

  async function startCheckout(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (checkoutLoading) return;
    setCheckoutLoading(true);
    setCheckoutStatus('Opening secure Stripe Checkout…');
    try {
      const response = await fetch('/checkout/pro', { method: 'POST', headers: { Accept: 'application/json' } });
      const payload = await response.json();
      const checkoutUrl = new URL(payload?.checkout_url);
      if (!response.ok || checkoutUrl.protocol !== 'https:' || checkoutUrl.hostname !== 'checkout.stripe.com') {
        throw new Error('Checkout unavailable');
      }
      window.location.assign(checkoutUrl.toString());
    } catch {
      setCheckoutLoading(false);
      setCheckoutStatus('Checkout is temporarily unavailable. Please try again.');
    }
  }

  return (
    <div className="site-shell">
      <a className="skip-link" href="#content">Skip to content</a>
      <nav className="site-nav" aria-label="Primary">
        <a className="brand" href="#top" aria-label="SpyderGoat home"><BrandMark /><span>spydergoat</span><b>v1.1</b></a>
        <div className="nav-links">
          <a href="#why">Why MJD</a>
          <a href="#cases">Use cases</a>
          <a href="#docs">Docs</a>
          <a href="#pricing">Access</a>
        </div>
      </nav>

      <main id="content">
        <header id="top" className="hero section-wrap">
          <div className="hero-grid" aria-hidden="true" />
          <div className="eyebrow"><span className="signal-dot" /> Modified Julian Date · Time API</div>
          <div className="hero-copy">
            <h1>A compact external time reference for software.</h1>
            <p>Server-derived MJD, UTC, and Unix time in one small JSON response—for agents, audit trails, science tooling, and systems that need a shared temporal receipt.</p>
          </div>

          <section className="clock-panel" aria-label="Current time receipt">
            <div className="clock-heading"><span>Current MJD</span><span className="live-label">{display.source === 'server' ? 'Server anchored' : 'Browser preview'}</span></div>
            <output className="mjd-value" aria-live="off">{display.mjd.toFixed(8)}</output>
            <div className="clock-meta">
              <time dateTime={display.utc}>{display.utc}</time>
              <span>Unix {display.unix}</span>
              <span>Source {display.source}</span>
            </div>
            <p className="clock-status" aria-live="polite">{status}</p>
            <div className="hero-actions">
              <a className="button primary" href="/mjd">Open /mjd</a>
              <button className="button secondary" type="button" onClick={calibrate} disabled={loading}>
                {loading ? 'Calibrating…' : status.includes('unavailable') ? 'Try again' : 'Calibrate receipt'}
              </button>
              <a className="text-link" href="#docs">Read the response <span aria-hidden="true">↓</span></a>
            </div>
          </section>

          <figure className="epoch-ruler" aria-label="Julian and Unix time epochs">
            <div className="epoch-track">
              <div className="epoch"><i /><strong>JD 0</strong><span>4713 BCE</span></div>
              <div className="epoch"><i /><strong>MJD 0</strong><span>17 Nov 1858</span></div>
              <div className="epoch"><i /><strong>MJD 40587</strong><span>Unix epoch · 1970</span></div>
              <div className="epoch active"><i /><strong>MJD {Math.floor(display.mjd)}</strong><span>{display.source === 'server' ? 'Server-derived today' : 'Browser-derived preview'}</span></div>
            </div>
            <figcaption>MJD = JD − 2,400,000.5 <span>·</span> The fractional part represents time of day on the stated scale.</figcaption>
          </figure>
        </header>

        <section id="why" className="content-section section-wrap">
          <div className="section-heading"><div><span className="kicker">Why MJD</span><h2>Time as one comparable number</h2></div><p>MJD reduces timezone and calendar-conversion work when systems share the same stated time convention.</p></div>
          <div className="feature-grid">
            {whyCards.map(([title, body], index) => (
              <article className="feature-card" key={title}><span>0{index + 1}</span><h3>{title}</h3><p>{body}</p></article>
            ))}
          </div>
        </section>

        <section id="cases" className="content-section section-wrap">
          <div className="section-heading"><div><span className="kicker">Use cases</span><h2>Where a shared reference helps</h2></div><p>One boring number can make distributed records easier to compare, explain, and audit.</p></div>
          <div className="case-list">
            {useCases.map(item => (
              <article className="case-row" key={item.number}>
                <span className="case-number">{item.number}</span>
                <div><h3>{item.title}</h3><p>{item.body}</p></div>
                <pre><code>{item.code}</code></pre>
              </article>
            ))}
          </div>
        </section>

        <section className="content-section section-wrap">
          <span className="kicker">Runtime facts</span>
          <h2>Small and inspectable</h2>
          <div className="fact-grid">
            <div><strong>/mjd</strong><span>Public JSON endpoint</span></div>
            <div><strong>/jd</strong><span>Includes Julian Date</span></div>
            <div><strong>no-store</strong><span>Time responses are not cached</span></div>
            <div><strong>server</strong><span>Source marker in every response</span></div>
          </div>
        </section>

        <section id="docs" className="content-section docs-section section-wrap">
          <div className="docs-copy"><span className="kicker">Docs</span><h2>The whole public API fits here</h2><p>Request the current time receipt. No account, SDK, or ceremony required.</p><button className="copy-button" type="button" onClick={copyExample}>{copied ? 'Copied' : 'Copy curl'}</button></div>
          <div className="code-window">
            <div className="code-title"><span><i /><i /><i /></span><code>GET /mjd</code></div>
            <pre><code>{responseExample}</code></pre>
          </div>
          <p className="docs-note">The free endpoint currently allows one request per IP every 30 minutes. <code>/jd</code> returns the same fields plus <code>jd</code>.</p>
        </section>

        <section id="pricing" className="content-section section-wrap">
          <div className="section-heading"><div><span className="kicker">Access</span><h2>Free endpoint available. Pro access live.</h2></div><p>Subscribe through Stripe for a one-time API-key delivery and 5,000 authenticated requests each monthly billing period.</p></div>
          <div className="pricing-grid">
            <article className="price-card available"><div className="price-top"><span>Free</span><b>Available</b></div><strong>$0</strong><p>One request per IP every 30 minutes. No signup.</p><a className="button primary" href="/mjd">Use /mjd</a></article>
            <article className="price-card available"><div className="price-top"><span>Pro</span><b>Available</b></div><strong>$4.89<small>/month</small></strong><p>5,000 authenticated MJD/JD requests per monthly billing period. Your API key is shown once after payment.</p><form action="/checkout/pro" method="post" onSubmit={startCheckout}><button className="button primary" type="submit" disabled={checkoutLoading}>{checkoutLoading ? 'Opening…' : 'Get Pro'}</button></form><output className="checkout-status" aria-live="polite">{checkoutStatus}</output></article>
            <article className="price-card paused"><div className="price-top"><span>Wallet</span><b>Paused</b></div><strong>$0.001<small>/request</small></strong><p>Top-ups remain disabled until credits have deterministic account binding and ledger receipts.</p></article>
          </div>
        </section>
      </main>

      <footer className="site-footer section-wrap"><div className="brand"><BrandMark /><span>spydergoat</span></div><p>Server-derived MJD, UTC, and Unix time over HTTP.</p><a href="#top">Back to top ↑</a></footer>
    </div>
  );
}
