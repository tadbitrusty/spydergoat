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
 * TODO: Phase 2 - Implement with user lookup, wallet balance, call counting
 */
async function checkPaidRateLimit(apiKey, env) {
  // Phase 2: Look up user by API key
  // - Check calls_this_period vs 5000 limit
  // - If over, check wallet balance
  // - If wallet empty, defer to free tier logic
  return { allowed: true, retryAfter: 0, tier: 'paid' };
}

/**
 * Main rate limit check - routes to free or paid
 */
async function checkRateLimit(request, env) {
  const authHeader = request.headers.get('Authorization');

  if (authHeader && authHeader.startsWith('Bearer ')) {
    const apiKey = authHeader.slice(7);
    // TODO Phase 2: Validate API key and check paid limits
    // For now, treat as free tier
  }

  // Free tier - rate limit by IP
  const ip = getClientIP(request);
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
function generateHTML(mjd, utc) {
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
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      font-family: 'SF Mono', 'Monaco', 'Inconsolata', 'Roboto Mono', monospace;
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);
      color: #e8e8e8;
    }
    .hero { text-align: center; padding: 2rem; }
    h1 {
      font-size: 2.5rem;
      font-weight: 300;
      margin-bottom: 0.5rem;
      color: #00d9ff;
    }
    .tagline {
      font-size: 1rem;
      color: #888;
      margin-bottom: 2rem;
    }
    .ticker-box {
      background: rgba(0, 217, 255, 0.1);
      border: 2px solid #00d9ff;
      border-radius: 12px;
      padding: 2rem 3rem;
      margin: 2rem 0;
    }
    .mjd-label {
      font-size: 0.875rem;
      color: #888;
      text-transform: uppercase;
      letter-spacing: 2px;
      margin-bottom: 0.5rem;
    }
    .mjd-value {
      font-size: 3rem;
      font-weight: 700;
      color: #00d9ff;
      font-variant-numeric: tabular-nums;
    }
    .utc-time {
      font-size: 1rem;
      color: #666;
      margin-top: 1rem;
    }
    .api-hint {
      margin-top: 2rem;
      font-size: 0.875rem;
      color: #666;
    }
    .api-hint code {
      background: rgba(255,255,255,0.1);
      padding: 0.25rem 0.5rem;
      border-radius: 4px;
      color: #00d9ff;
    }
  </style>
</head>
<body>
  <div class="hero">
    <h1>Spydergoat</h1>
    <p class="tagline">One number. Always right. Solve temporal drift.</p>
    <div class="ticker-box">
      <div class="mjd-label">Modified Julian Date</div>
      <div class="mjd-value" id="mjd">${mjd.toFixed(8)}</div>
      <div class="utc-time" id="utc">${utc}</div>
    </div>
    <p class="api-hint"><code>GET /mjd</code></p>
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

    // Only GET allowed
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
      return new Response(generateHTML(mjd, utc), {
        headers: { 'Content-Type': 'text/html', 'Cache-Control': 'no-store', ...corsHeaders }
      });
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
