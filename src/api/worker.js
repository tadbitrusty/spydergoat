/**
 * Spydergoat - Real-Time MJD Clock
 *
 * Billing tiers:
 * - Free: 1 call per 30 min (IP-based)
 * - Paid ($4.89/mo): Unlimited up to 5000 calls
 * - Over 5k: $0.001/call from wallet
 * - Wallet empty: Reverts to free tier
 */

const RATE_LIMIT_MS = 1800000; // 30 minutes

/**
 * Calculate Modified Julian Date from Unix milliseconds
 * MJD = (unix_ms / 86400000) + 40587
 */
function getMJD(unixMs) {
  return (unixMs / 86400000) + 40587;
}

/**
 * Calculate Julian Date from MJD
 * JD = MJD + 2400000.5
 */
function getJD(mjd) {
  return mjd + 2400000.5;
}

/**
 * Get client IP from request
 */
function getClientIP(request) {
  return request.headers.get('CF-Connecting-IP') ||
         request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ||
         'unknown';
}

/**
 * Check rate limit for free tier (IP-based)
 * Returns: { allowed: boolean, retryAfter: number (seconds) }
 */
async function checkFreeRateLimit(ip, env) {
  if (!env.SPYDERGOAT_KV) {
    // KV not configured - allow (dev mode)
    return { allowed: true, retryAfter: 0 };
  }

  const key = `rate:free:${ip}`;
  const now = Date.now();

  const lastCall = await env.SPYDERGOAT_KV.get(key);

  if (lastCall) {
    const elapsed = now - parseInt(lastCall, 10);
    if (elapsed < RATE_LIMIT_MS) {
      const retryAfter = Math.ceil((RATE_LIMIT_MS - elapsed) / 1000);
      return { allowed: false, retryAfter };
    }
  }

  // Record this call
  await env.SPYDERGOAT_KV.put(key, now.toString(), { expirationTtl: 1800 });

  return { allowed: true, retryAfter: 0 };
}

/**
 * Check rate limit for paid tier (API key based)
 * Billing logic:
 * - Active subscription: 5000 calls/month included
 * - Over 5000: deduct from wallet at $0.001/call
 * - Wallet empty: fall back to free tier (1/30min)
 */
async function checkPaidRateLimit(apiKey, ip, env) {
  if (!env.SPYDERGOAT_KV) {
    return { allowed: true, tier: 'paid' };
  }

  // Look up user by API key
  const customerId = await env.SPYDERGOAT_KV.get(`apikey:${apiKey}`);
  if (!customerId) {
    // Invalid API key - fall back to free tier
    return { allowed: false, invalid_key: true };
  }

  const userDataRaw = await env.SPYDERGOAT_KV.get(`user:${customerId}`);
  if (!userDataRaw) {
    return { allowed: false, invalid_key: true };
  }

  const userData = JSON.parse(userDataRaw);

  // Admin bypass - unlimited access
  if (userData.admin === true) {
    return { allowed: true, tier: 'admin' };
  }

  // Check subscription status
  if (userData.subscription_status !== 'active') {
    // Canceled/inactive - fall back to free tier
    return { allowed: false, inactive_subscription: true };
  }

  // Check if within 5000 included calls
  if (userData.current_period_calls < 5000) {
    // Increment call count
    userData.current_period_calls += 1;
    await env.SPYDERGOAT_KV.put(`user:${customerId}`, JSON.stringify(userData));
    return {
      allowed: true,
      tier: 'paid',
      calls_used: userData.current_period_calls,
      calls_remaining: 5000 - userData.current_period_calls
    };
  }

  // Over 5000 - check wallet
  if (userData.wallet_balance > 0) {
    // Deduct from wallet
    userData.wallet_balance -= 1;
    userData.current_period_calls += 1;
    await env.SPYDERGOAT_KV.put(`user:${customerId}`, JSON.stringify(userData));
    return {
      allowed: true,
      tier: 'wallet',
      wallet_balance: userData.wallet_balance
    };
  }

  // Wallet empty - fall back to free tier rate limit
  return { allowed: false, wallet_empty: true };
}

/**
 * Main rate limit check - routes to free or paid
 */
async function checkRateLimit(request, env) {
  const authHeader = request.headers.get('Authorization');
  const ip = getClientIP(request);

  if (authHeader && authHeader.startsWith('Bearer ')) {
    const apiKey = authHeader.slice(7);
    const paidResult = await checkPaidRateLimit(apiKey, ip, env);

    if (paidResult.allowed) {
      return paidResult;
    }

    // Invalid key, inactive subscription, or wallet empty - fall back to free tier
    if (paidResult.invalid_key || paidResult.inactive_subscription || paidResult.wallet_empty) {
      return await checkFreeRateLimit(ip, env);
    }

    return paidResult;
  }

  // No API key - free tier by IP
  return await checkFreeRateLimit(ip, env);
}

/**
 * Build time response object
 */
function buildTimeResponse(now, includeJD = false) {
  const mjd = getMJD(now);

  const response = {
    mjd: parseFloat(mjd.toFixed(8)),
    utc: new Date(now).toISOString(),
    unix: Math.floor(now / 1000),
    source: 'server'
  };

  if (includeJD) {
    response.jd = parseFloat(getJD(mjd).toFixed(8));
  }

  return response;
}

/**
 * Generate HTML page
 */
function generateHTML(mjd, utc, env) {
  const checkoutUrl = env.STRIPE_CHECKOUT_URL || '#';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Spydergoat - MJD Clock</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      min-height: 100vh;
      font-family: 'SF Mono', 'Monaco', 'Inconsolata', 'Roboto Mono', monospace;
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);
      color: #e8e8e8;
    }
    .container { max-width: 800px; margin: 0 auto; padding: 2rem; }
    .hero { display: flex; align-items: center; justify-content: center; gap: 3rem; padding: 4rem 2rem; flex-wrap: wrap; }
    .hero-goat { width: 250px; height: auto; flex-shrink: 0; }
    .hero-content { text-align: center; }
    h1 { font-size: 2.5rem; font-weight: 300; margin-bottom: 0.5rem; color: #00d9ff; }
    h2 { font-size: 1.5rem; font-weight: 300; margin-bottom: 1rem; color: #00d9ff; }
    .tagline { font-size: 1rem; color: #888; margin-bottom: 2rem; }
    .ticker-box {
      background: rgba(0, 217, 255, 0.1);
      border: 2px solid #00d9ff;
      border-radius: 12px;
      padding: 2rem 3rem;
      margin: 2rem auto;
      display: inline-block;
    }
    .mjd-label { font-size: 0.875rem; color: #888; text-transform: uppercase; letter-spacing: 2px; margin-bottom: 0.5rem; }
    .mjd-value { font-size: 3rem; font-weight: 700; color: #00d9ff; font-variant-numeric: tabular-nums; }
    .utc-time { font-size: 1rem; color: #666; margin-top: 1rem; }

    .section { padding: 3rem 2rem; border-top: 1px solid rgba(255,255,255,0.1); }
    .section-title { text-align: center; margin-bottom: 2rem; }

    .pricing { display: flex; gap: 1rem; justify-content: center; flex-wrap: wrap; }
    .price-card {
      background: rgba(255,255,255,0.05);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 12px;
      padding: 2rem;
      width: 220px;
      text-align: center;
    }
    .price-card.featured { border-color: #00d9ff; }
    .price-name { font-size: 1.25rem; margin-bottom: 0.5rem; }
    .price-amount { font-size: 2rem; color: #00d9ff; margin-bottom: 0.5rem; }
    .price-period { font-size: 0.875rem; color: #666; margin-bottom: 1rem; }
    .price-feature { font-size: 0.875rem; color: #888; margin-bottom: 0.5rem; }

    .btn {
      display: inline-block;
      background: #00d9ff;
      color: #1a1a2e;
      padding: 0.75rem 2rem;
      border-radius: 8px;
      text-decoration: none;
      font-weight: 600;
      margin-top: 1rem;
      transition: opacity 0.2s;
    }
    .btn:hover { opacity: 0.9; }
    .btn-small { padding: 0.5rem 1.5rem; font-size: 0.875rem; }

    .code-block {
      background: rgba(0,0,0,0.3);
      border-radius: 8px;
      padding: 1.5rem;
      overflow-x: auto;
      text-align: left;
      margin: 1rem 0;
    }
    .code-block code { color: #00d9ff; }
    .code-comment { color: #666; }

    .footer { text-align: center; padding: 2rem; color: #666; font-size: 0.875rem; }

    .how-it-works { max-width: 500px; margin: 0 auto; }
    .step { display: flex; gap: 1rem; margin-bottom: 1.5rem; align-items: flex-start; }
    .step-num {
      background: #00d9ff;
      color: #1a1a2e;
      width: 28px;
      height: 28px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 700;
      flex-shrink: 0;
    }
    .step-content { flex: 1; }
    .step-content strong { color: #00d9ff; }
    .step-content p { color: #888; margin-top: 0.25rem; font-size: 0.875rem; }
  </style>
</head>
<body>
  <div class="container">
    <div class="hero">
      <img src="https://pub-972f1410bb404f91bce6fb7c715b72e4.r2.dev/assets/spydergoat.png" alt="Spydergoat" class="hero-goat">
      <div class="hero-content">
        <h1>Spydergoat</h1>
        <p class="tagline">Accurate time for anything.<br>One API call.</p>
        <div class="ticker-box">
          <div class="mjd-label">Modified Julian Date</div>
          <div class="mjd-value" id="mjd">${mjd.toFixed(8)}</div>
          <div class="utc-time" id="utc">${utc}</div>
        </div>
      </div>
    </div>

    <div class="section">
      <div class="section-title"><h2>How It Works</h2></div>
      <div class="how-it-works">
        <div class="step">
          <div class="step-num">1</div>
          <div class="step-content">
            <strong>Free</strong>
            <p>No signup. Hit /mjd directly. 1 request per 30 minutes.</p>
          </div>
        </div>
        <div class="step">
          <div class="step-num">2</div>
          <div class="step-content">
            <strong>Pro ($4.89/mo)</strong>
            <p>Get an API key. 5,000 requests/month. No rate limit.</p>
          </div>
        </div>
        <div class="step">
          <div class="step-num">3</div>
          <div class="step-content">
            <strong>Over 5,000?</strong>
            <p>Pulls from your wallet at $0.001/request. Wallet empty? Back to free tier.</p>
          </div>
        </div>
        <div class="step">
          <div class="step-num">4</div>
          <div class="step-content">
            <strong>Wallet</strong>
            <p>Prepaid credits. Never expires. Top up anytime.</p>
          </div>
        </div>
      </div>
    </div>

    <div class="section">
      <div class="section-title"><h2>Pricing</h2></div>
      <div class="pricing">
        <div class="price-card">
          <div class="price-name">Free</div>
          <div class="price-amount">$0</div>
          <div class="price-period">forever</div>
          <div class="price-feature">1 request / 30 min</div>
          <div class="price-feature">No API key needed</div>
        </div>
        <div class="price-card featured">
          <div class="price-name">Pro</div>
          <div class="price-amount">$4.89</div>
          <div class="price-period">/ month</div>
          <div class="price-feature">5,000 requests included</div>
          <div class="price-feature">No rate limit</div>
          <a href="${checkoutUrl}" class="btn">Get API Key</a>
        </div>
      </div>
    </div>

    <div class="section">
      <div class="section-title"><h2>Wallet Top-Up</h2></div>
      <p style="text-align: center; color: #888; margin-bottom: 1.5rem;">Need more than 5,000/month? Add credits at $0.001 per request.</p>
      <div class="pricing">
        <div class="price-card">
          <div class="price-name">1K</div>
          <div class="price-amount">$1</div>
          <div class="price-feature">1,000 requests</div>
          <a href="https://buy.stripe.com/7sY5kEfewg4ogSJ5uD7Re05" class="btn btn-small">Buy</a>
        </div>
        <div class="price-card">
          <div class="price-name">10K</div>
          <div class="price-amount">$10</div>
          <div class="price-feature">10,000 requests</div>
          <a href="https://buy.stripe.com/dRmeVeaYgg4o45X8GP7Re04" class="btn btn-small">Buy</a>
        </div>
        <div class="price-card">
          <div class="price-name">100K</div>
          <div class="price-amount">$100</div>
          <div class="price-feature">100,000 requests</div>
          <a href="https://buy.stripe.com/00w28saYgf0k7i93mv7Re03" class="btn btn-small">Buy</a>
        </div>
      </div>
      <p style="text-align: center; color: #666; margin-top: 1.5rem; font-size: 0.875rem;">Need more? <a href="mailto:contact@spydergoat.com" style="color: #00d9ff;">contact@spydergoat.com</a> for volume pricing.</p>
    </div>

    <div class="section">
      <div class="section-title"><h2>API</h2></div>
      <div class="code-block">
        <code><span class="code-comment"># Get current MJD</span>
curl https://spydergoat.com/mjd

<span class="code-comment"># With API key (no rate limit)</span>
curl -H "Authorization: Bearer sg_your_key" https://spydergoat.com/mjd</code>
      </div>
    </div>

    <div class="footer">
      Accurate time for everything.
    </div>
  </div>
  <script>
    function update() {
      const mjd = (Date.now() / 86400000) + 40587;
      document.getElementById('mjd').textContent = mjd.toFixed(8);
      document.getElementById('utc').textContent = new Date().toISOString();
    }
    setInterval(update, 100);
  </script>
</body>
</html>`;
}

/**
 * Generate success page HTML
 */
function generateSuccessHTML(apiKey) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Spydergoat - API Key</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: 'SF Mono', 'Monaco', 'Inconsolata', 'Roboto Mono', monospace;
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);
      color: #e8e8e8;
    }
    .card {
      background: rgba(255,255,255,0.05);
      border: 2px solid #00d9ff;
      border-radius: 12px;
      padding: 3rem;
      max-width: 600px;
      text-align: center;
    }
    h1 { font-size: 1.5rem; font-weight: 300; margin-bottom: 1rem; color: #00d9ff; }
    .warning { color: #ff6b6b; font-size: 0.875rem; margin-bottom: 2rem; }
    .key-box {
      background: rgba(0,0,0,0.3);
      border-radius: 8px;
      padding: 1rem;
      margin: 1rem 0;
      word-break: break-all;
      font-size: 1.1rem;
      color: #00d9ff;
      cursor: pointer;
    }
    .key-box:hover { background: rgba(0,0,0,0.5); }
    .hint { color: #888; font-size: 0.875rem; margin-top: 1rem; }
    .copied { color: #4ade80; }
    .example {
      background: rgba(0,0,0,0.3);
      border-radius: 8px;
      padding: 1rem;
      margin-top: 2rem;
      text-align: left;
      font-size: 0.875rem;
    }
    .example code { color: #00d9ff; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Your API Key</h1>
    <p class="warning">Copy this now. We won't show it again.</p>
    <div class="key-box" onclick="copyKey()" id="keyBox">${apiKey}</div>
    <p class="hint" id="hint">Click to copy</p>
    <div class="example">
      <code>curl -H "Authorization: Bearer ${apiKey}" \\
  https://spydergoat.com/mjd</code>
    </div>
  </div>
  <script>
    function copyKey() {
      navigator.clipboard.writeText('${apiKey}');
      document.getElementById('hint').textContent = 'Copied!';
      document.getElementById('hint').classList.add('copied');
    }
  </script>
</body>
</html>`;
}

/**
 * Generate error page HTML
 */
function generateErrorHTML(message) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Spydergoat - Error</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: 'SF Mono', 'Monaco', 'Inconsolata', 'Roboto Mono', monospace;
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);
      color: #e8e8e8;
    }
    .card {
      background: rgba(255,255,255,0.05);
      border: 2px solid #ff6b6b;
      border-radius: 12px;
      padding: 3rem;
      max-width: 500px;
      text-align: center;
    }
    h1 { font-size: 1.5rem; font-weight: 300; margin-bottom: 1rem; color: #ff6b6b; }
    p { color: #888; }
    a { color: #00d9ff; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Error</h1>
    <p>${message}</p>
    <p style="margin-top: 1rem;"><a href="/">Back to home</a></p>
  </div>
</body>
</html>`;
}

/**
 * Handle success page - look up API key from Stripe session
 */
async function handleSuccess(request, env) {
  const url = new URL(request.url);
  const sessionId = url.searchParams.get('session_id');

  if (!sessionId) {
    return new Response(generateErrorHTML('Missing session ID'), {
      status: 400,
      headers: { 'Content-Type': 'text/html' }
    });
  }

  // Call Stripe API to get session details
  const stripeResponse = await fetch(
    `https://api.stripe.com/v1/checkout/sessions/${sessionId}`,
    {
      headers: {
        'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}`,
      }
    }
  );

  if (!stripeResponse.ok) {
    return new Response(generateErrorHTML('Invalid session'), {
      status: 400,
      headers: { 'Content-Type': 'text/html' }
    });
  }

  const session = await stripeResponse.json();
  const customerId = session.customer;

  if (!customerId) {
    return new Response(generateErrorHTML('No customer found'), {
      status: 400,
      headers: { 'Content-Type': 'text/html' }
    });
  }

  // Look up user in KV
  const userDataRaw = await env.SPYDERGOAT_KV.get(`user:${customerId}`);

  if (!userDataRaw) {
    // Webhook might not have fired yet - wait briefly and retry
    await new Promise(resolve => setTimeout(resolve, 2000));
    const retryData = await env.SPYDERGOAT_KV.get(`user:${customerId}`);

    if (!retryData) {
      return new Response(generateErrorHTML('Account not ready. Please refresh in a moment.'), {
        status: 202,
        headers: { 'Content-Type': 'text/html' }
      });
    }

    const userData = JSON.parse(retryData);
    return new Response(generateSuccessHTML(userData.api_key), {
      headers: { 'Content-Type': 'text/html' }
    });
  }

  const userData = JSON.parse(userDataRaw);
  return new Response(generateSuccessHTML(userData.api_key), {
    headers: { 'Content-Type': 'text/html' }
  });
}

/**
 * Verify Stripe webhook signature
 */
async function verifyStripeSignature(payload, signature, secret) {
  const encoder = new TextEncoder();
  const parts = signature.split(',').reduce((acc, part) => {
    const [key, value] = part.split('=');
    acc[key] = value;
    return acc;
  }, {});

  const timestamp = parts['t'];
  const expectedSig = parts['v1'];

  if (!timestamp || !expectedSig) {
    return { valid: false, error: 'Missing signature components' };
  }

  // Check timestamp is within 5 minutes
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - parseInt(timestamp)) > 300) {
    return { valid: false, error: 'Timestamp outside tolerance' };
  }

  // Compute expected signature
  const signedPayload = `${timestamp}.${payload}`;
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(signedPayload));
  const computedSig = Array.from(new Uint8Array(sig))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  if (computedSig !== expectedSig) {
    return { valid: false, error: 'Signature mismatch' };
  }

  return { valid: true, timestamp };
}

/**
 * Generate API key
 */
function generateApiKey() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return 'sg_' + Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Handle Stripe webhook events
 */
async function handleStripeWebhook(request, env) {
  const signature = request.headers.get('stripe-signature');
  if (!signature) {
    return new Response(JSON.stringify({ error: 'Missing signature' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const payload = await request.text();
  const verification = await verifyStripeSignature(payload, signature, env.STRIPE_WEBHOOK_SECRET);

  if (!verification.valid) {
    return new Response(JSON.stringify({ error: verification.error }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const event = JSON.parse(payload);

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      const customerId = session.customer;
      const customerEmail = session.customer_email || session.customer_details?.email;
      const mode = session.mode; // 'subscription' or 'payment'

      if (mode === 'subscription') {
        // New subscription - create user with API key
        const apiKey = generateApiKey();
        const userData = {
          stripe_customer_id: customerId,
          email: customerEmail,
          api_key: apiKey,
          wallet_balance: 0,
          current_period_calls: 0,
          period_start: Date.now(),
          subscription_status: 'active',
          created_at: Date.now()
        };

        // Store user by customer ID and API key
        await env.SPYDERGOAT_KV.put(`user:${customerId}`, JSON.stringify(userData));
        await env.SPYDERGOAT_KV.put(`apikey:${apiKey}`, customerId);

        console.log(`New subscription: ${customerId}, API key: ${apiKey}`);
      } else if (mode === 'payment') {
        // Wallet top-up
        const amountPaid = session.amount_total / 100; // cents to dollars
        const unitsAdded = Math.floor(amountPaid / 0.001); // $0.001 per unit

        const existingUser = await env.SPYDERGOAT_KV.get(`user:${customerId}`);
        if (existingUser) {
          const userData = JSON.parse(existingUser);
          userData.wallet_balance = (userData.wallet_balance || 0) + unitsAdded;
          await env.SPYDERGOAT_KV.put(`user:${customerId}`, JSON.stringify(userData));
          console.log(`Wallet top-up: ${customerId}, +${unitsAdded} units`);
        }
      }
      break;
    }

    case 'customer.subscription.updated': {
      const subscription = event.data.object;
      const customerId = subscription.customer;
      const status = subscription.status;

      const existingUser = await env.SPYDERGOAT_KV.get(`user:${customerId}`);
      if (existingUser) {
        const userData = JSON.parse(existingUser);
        userData.subscription_status = status;
        await env.SPYDERGOAT_KV.put(`user:${customerId}`, JSON.stringify(userData));
        console.log(`Subscription updated: ${customerId}, status: ${status}`);
      }
      break;
    }

    case 'customer.subscription.deleted': {
      const subscription = event.data.object;
      const customerId = subscription.customer;

      const existingUser = await env.SPYDERGOAT_KV.get(`user:${customerId}`);
      if (existingUser) {
        const userData = JSON.parse(existingUser);
        userData.subscription_status = 'canceled';
        await env.SPYDERGOAT_KV.put(`user:${customerId}`, JSON.stringify(userData));
        console.log(`Subscription canceled: ${customerId}`);
      }
      break;
    }

    case 'invoice.paid': {
      const invoice = event.data.object;
      const customerId = invoice.customer;

      // Reset monthly call count on successful payment
      const existingUser = await env.SPYDERGOAT_KV.get(`user:${customerId}`);
      if (existingUser) {
        const userData = JSON.parse(existingUser);
        userData.current_period_calls = 0;
        userData.period_start = Date.now();
        await env.SPYDERGOAT_KV.put(`user:${customerId}`, JSON.stringify(userData));
        console.log(`Invoice paid, reset calls: ${customerId}`);
      }
      break;
    }

    default:
      console.log(`Unhandled event type: ${event.type}`);
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}

/**
 * CORS headers
 */
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization'
};

/**
 * Request handler
 */
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // Stripe webhook - POST only, no CORS
    if (path === '/webhook' && request.method === 'POST') {
      return handleStripeWebhook(request, env);
    }

    // Only GET allowed for other routes
    if (request.method !== 'GET') {
      return new Response(JSON.stringify({ error: 'method_not_allowed' }), {
        status: 405,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

    // HTML page - no rate limit (for browser access)
    if (path === '/' || path === '/index.html') {
      const now = Date.now();
      const mjd = getMJD(now);
      const utc = new Date(now).toISOString();
      return new Response(generateHTML(mjd, utc, env), {
        headers: { 'Content-Type': 'text/html', 'Cache-Control': 'no-store', ...corsHeaders }
      });
    }

    // Success page - show API key after checkout
    if (path === '/success') {
      return handleSuccess(request, env);
    }

    // API endpoints - rate limited
    if (path === '/mjd' || path === '/jd') {
      const rateCheck = await checkRateLimit(request, env);

      if (!rateCheck.allowed) {
        return new Response(JSON.stringify({
          error: 'rate_limited',
          message: 'Free tier: 1 request per 30 minutes',
          retry_after: rateCheck.retryAfter
        }), {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            'Retry-After': rateCheck.retryAfter.toString(),
            ...corsHeaders
          }
        });
      }

      const now = Date.now();
      const includeJD = path === '/jd';

      return new Response(JSON.stringify(buildTimeResponse(now, includeJD)), {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...corsHeaders }
      });
    }

    // 404
    return new Response(JSON.stringify({
      error: 'not_found',
      endpoints: ['/', '/mjd', '/jd']
    }), {
      status: 404,
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
  }
};
