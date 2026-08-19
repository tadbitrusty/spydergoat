import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import worker from '../src/api/worker.js';
import { buildTimeResponse } from '../src/api/worker.js';

const CONTENT_PATHS = [
  '/reference/server-time-api',
  '/guides/current-timestamp',
  '/problems/untrusted-client-time',
  '/problems/server-clock-drift',
  '/comparisons/client-time-vs-server-time',
  '/reference/limits-and-non-guarantees',
];

const PRODUCT_CLAIM_SUBJECT = String.raw`(?:SpyderGoat|(?:this|the|our)\s+(?:API|service|receipt|timestamp)|this)`;

const UNSUPPORTED_POSITIVE_CLAIMS = [
  new RegExp(`${PRODUCT_CLAIM_SUBJECT}\\s+(?:is|offers?|provides?|returns?|delivers?)\\s+(?:an?\\s+)?(?:authoritative|certified|official|trusted)\\s+(?:time(?:\\s+source)?|timestamp)`, 'i'),
  new RegExp(`${PRODUCT_CLAIM_SUBJECT}\\s+(?:(?:is|are)|(?:offers?|provides?|returns?|delivers?)\\s+(?:an?\\s+)?)\\s*(?:guaranteed(?:\\s+to\\s+be)?|always|perfectly)\\s+(?:accurate|available|correct)`, 'i'),
  new RegExp(`${PRODUCT_CLAIM_SUBJECT}\\s+guarantees?\\s+(?:accuracy|availability|correctness|accurate|available|correct)`, 'i'),
  new RegExp(`${PRODUCT_CLAIM_SUBJECT}\\s+(?:(?:is|are)|(?:offers?|provides?|returns?|delivers?)\\s+(?:an?\\s+)?)\\s*(?:tamper-proof|cryptographically\\s+verifiable)(?:\\s+(?:receipt|timestamp))?`, 'i'),
  new RegExp(`${PRODUCT_CLAIM_SUBJECT}\\s+proves?\\s+(?:when\\s+)?(?:an?\\s+)?event(?:\\s+(?:happened|time))?`, 'i'),
  new RegExp(`${PRODUCT_CLAIM_SUBJECT}\\s+(?:is|provides?)\\s+(?:an?\\s+)?proof\\s+of\\s+(?:an?\\s+)?event(?:\\s+time)?`, 'i'),
  new RegExp(`${PRODUCT_CLAIM_SUBJECT}\\s+(?:synchronizes?|disciplines?|calibrates?)\\s+(?:(?:the|a|your)\\s+)?(?:caller\\s+)?clock`, 'i'),
  new RegExp(`${PRODUCT_CLAIM_SUBJECT}\\s+guarantees?\\s+(?:AI\\s+)?(?:indexing|ranking|traffic|citation|discovery)`, 'i'),
  new RegExp(`${PRODUCT_CLAIM_SUBJECT}\\s+(?:is|offers?|provides?)\\s+(?:AI-optimized|citation-proven|citation-ready)`, 'i'),
];

function unsupportedPositiveClaims(copy) {
  return UNSUPPORTED_POSITIVE_CLAIMS.filter(pattern => pattern.test(copy));
}

function request(path, init = {}, env = {}) {
  return worker.fetch(new Request(`https://spydergoat.test${path}`, init), env, {});
}

async function pageAt(route) {
  const { AEO_PAGES_BY_ROUTE } = await import('../src/content/aeo-pages.js');
  return AEO_PAGES_BY_ROUTE[route];
}

function pageCopy(page) {
  return JSON.stringify(page);
}

function exampleCode(page, title) {
  const example = page.examples.find(value => value.title === title);
  assert.ok(example, `missing example: ${title}`);
  return example.code;
}

const VALID_RECEIPT = {
  mjd: 61107.38011574,
  utc: '2026-03-08T09:07:22.000Z',
  unix: 1772960842,
  source: 'server',
};

function runJavaScriptExample(code, scenario) {
  const harness = `
const scenario = ${JSON.stringify(scenario)};
let calls = 0;
let logged;
globalThis.fetch = async (url, init) => {
  calls += 1;
  if (url !== "https://spydergoat.com/mjd" || init.headers.Accept !== "application/json") throw new Error("unexpected request");
  if (scenario.kind === "429") return new Response(JSON.stringify({ error: "rate_limited" }), { status: 429, headers: { "Retry-After": "7" } });
  if (scenario.kind === "malformed") return new Response("{");
  return new Response(JSON.stringify(scenario.receipt));
};
console.log = value => { logged = value; };
let outcome;
try {
${code}
  outcome = { ok: true, value: logged, calls };
} catch (error) {
  outcome = { ok: false, error: String(error.message), calls };
}
process.stdout.write(JSON.stringify(outcome));
`;
  const result = spawnSync(process.execPath, ['--input-type=module'], { cwd: '/tmp', input: harness, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

function runPythonExample(code, scenario) {
  const library = code.replace(/\nprint\(get_receipt\(\)\)\s*$/, '');
  const harness = `${library}

SCENARIO = ${JSON.stringify(scenario)}
calls = 0

class FakeResponse:
    def __init__(self, body):
        self.body = body
    def __enter__(self):
        return self
    def __exit__(self, *args):
        return False
    def read(self):
        return self.body

def fake_urlopen(request, timeout):
    global calls
    calls += 1
    if request.full_url != "https://spydergoat.com/mjd" or request.headers.get("Accept") != "application/json" or timeout != 5:
        raise AssertionError("unexpected request")
    if SCENARIO["kind"] == "429":
        raise HTTPError(request.full_url, 429, "Too Many Requests", {"Retry-After": "7"}, None)
    if SCENARIO["kind"] == "malformed":
        return FakeResponse(b"{")
    return FakeResponse(json.dumps(SCENARIO["receipt"]).encode("utf-8"))

urlopen = fake_urlopen
try:
    value = get_receipt()
    outcome = {"ok": True, "value": value, "calls": calls}
except Exception as error:
    outcome = {"ok": False, "error": str(error), "calls": calls}
print(json.dumps(outcome))
`;
  const result = spawnSync('python3', ['-'], {
    cwd: '/tmp',
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
    input: harness,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test('the immutable AEO registry defines six unique, complete page identities', async () => {
  const { AEO_PAGES, AEO_PAGES_BY_ROUTE } = await import('../src/content/aeo-pages.js');
  assert.equal(AEO_PAGES.length, 6);
  assert.deepEqual(AEO_PAGES.map(page => page.route), CONTENT_PATHS);
  assert.deepEqual(Object.keys(AEO_PAGES_BY_ROUTE), CONTENT_PATHS);

  for (const field of ['route', 'title', 'description', 'h1', 'directAnswer', 'canonical']) {
    const values = AEO_PAGES.map(page => page[field]);
    assert.equal(new Set(values).size, 6, `${field} values must be unique`);
    assert.equal(values.every(value => typeof value === 'string' && value.trim()), true, `${field} values must be non-empty`);
  }

  for (const page of AEO_PAGES) {
    assert.equal(page.canonical, `https://spydergoat.com${page.route}`);
    assert.equal(['WebPage', 'TechArticle'].includes(page.schemaType), true);
    assert.equal(Array.isArray(page.sections) && page.sections.length > 0, true);
    assert.equal(Array.isArray(page.examples) && page.examples.length > 0, true);
    assert.equal(Array.isArray(page.limits) && page.limits.length > 0, true);
    assert.equal(typeof page.provenance?.text === 'string' && Boolean(page.provenance.text.trim()), true);
    assert.equal(Array.isArray(page.relatedLinks), true);
    assert.equal(page.relatedLinks.length >= 2, true);
    assert.equal(typeof page.cta?.href === 'string' && typeof page.cta?.label === 'string', true);
  }
});

test('the AEO registry is deeply immutable', async () => {
  const { AEO_PAGES, AEO_PAGES_BY_ROUTE } = await import('../src/content/aeo-pages.js');
  function assertDeeplyFrozen(value) {
    assert.equal(Object.isFrozen(value), true);
    for (const child of Object.values(value)) {
      if (child && typeof child === 'object') assertDeeplyFrozen(child);
    }
  }
  assertDeeplyFrozen(AEO_PAGES);
  assertDeeplyFrozen(AEO_PAGES_BY_ROUTE);
  assert.throws(() => { AEO_PAGES[0].title = 'mutated'; }, TypeError);
});

test('registry copy contains no unsupported authority or guarantee claims', async () => {
  const { AEO_PAGES } = await import('../src/content/aeo-pages.js');
  const copy = JSON.stringify(AEO_PAGES);
  assert.deepEqual(unsupportedPositiveClaims(copy), []);
});

test('unsupported-claim audit accepts explicit boundaries and detects affirmative overclaims', () => {
  const negativeBoundaries = [
    'SpyderGoat is not an authoritative time source.',
    'This is not a trusted timestamp.',
    'SpyderGoat does not synchronize the clock.',
    'The API is not guaranteed accurate or always available.',
    'The receipt is not tamper-proof and is not cryptographically verifiable.',
    'The receipt is not proof of an event time.',
    'The service does not guarantee indexing, ranking, traffic, citation, or discovery.',
    'The service is not AI-optimized, citation-proven, or citation-ready.',
  ];
  const affirmativeOverclaims = [
    'SpyderGoat is an authoritative time source.',
    'The API provides certified time.',
    'The service returns official time.',
    'This is a trusted timestamp.',
    'The API is guaranteed accurate.',
    'The service is always available.',
    'The receipt is perfectly correct.',
    'The receipt is tamper-proof.',
    'The timestamp is cryptographically verifiable.',
    'The receipt proves an event happened.',
    'The receipt is proof of an event time.',
    'SpyderGoat synchronizes the clock.',
    'The API disciplines the caller clock.',
    'The service calibrates a clock.',
    ...['indexing', 'ranking', 'traffic', 'citation', 'discovery'].map(outcome => `The service guarantees ${outcome}.`),
    'The service is AI-optimized.',
    'The service is citation-proven.',
    'The service is citation-ready.',
  ];

  for (const copy of negativeBoundaries) assert.deepEqual(unsupportedPositiveClaims(copy), [], copy);
  for (const copy of affirmativeOverclaims) assert.notDeepEqual(unsupportedPositiveClaims(copy), [], copy);
});

test('the renderer escapes text and attribute metacharacters and rejects unknown routes', async () => {
  const { escapeHtml, renderAeoPage } = await import('../src/content/render-aeo-page.js');
  assert.equal(escapeHtml(`<&>"'`), '&lt;&amp;&gt;&quot;&#39;');
  assert.throws(() => renderAeoPage('/guides/not-a-page'), /unknown AEO route/i);
  assert.throws(() => renderAeoPage('__proto__'), error => error instanceof RangeError && /unknown AEO route/i.test(error.message));
  assert.throws(() => renderAeoPage('constructor'), error => error instanceof RangeError && /unknown AEO route/i.test(error.message));
});

test('safe JSON-LD round-trips title and description metacharacters without literal markup', async () => {
  const { safeJson } = await import('../src/content/render-aeo-page.js');
  const structuredData = {
    title: 'Current <server> time & date',
    description: 'Compare <client> & server > safely',
  };
  const scriptContent = safeJson(structuredData);

  assert.deepEqual(JSON.parse(scriptContent), structuredData);
  assert.doesNotMatch(scriptContent, /</);
});

test('the renderer emits deterministic semantic pages with unique visible identity', async () => {
  const { AEO_PAGES } = await import('../src/content/aeo-pages.js');
  const { escapeHtml, renderAeoPage } = await import('../src/content/render-aeo-page.js');

  for (const page of AEO_PAGES) {
    const html = renderAeoPage(page.route);
    assert.equal(renderAeoPage(page.route), html, `${page.route} must be deterministic`);
    assert.match(html, /^<!doctype html><html lang="en">/i);
    assert.equal((html.match(/<h1(?:\s|>)/g) || []).length, 1, page.route);
    assert.match(html, new RegExp(`<title>${escapeHtml(page.title)}</title>`));
    assert.match(html, new RegExp(`<h1>${escapeHtml(page.h1)}</h1>`));
    assert.match(html, /<main[^>]*><article[^>]*>/);
    assert.equal(html.indexOf(escapeHtml(page.directAnswer)) < html.indexOf('<h2'), true, page.route);

    assert.equal((html.match(/<meta name="description"/g) || []).length, 1);
    assert.equal((html.match(/<link rel="canonical"/g) || []).length, 1);
    assert.equal((html.match(/<meta property="og:title"/g) || []).length, 1);
    assert.equal((html.match(/<meta property="og:description"/g) || []).length, 1);
    assert.equal((html.match(/<meta property="og:url"/g) || []).length, 1);
    assert.match(html, new RegExp(`href="${escapeHtml(page.canonical)}"`));

    assert.match(html, /<section class="examples"/);
    assert.match(html, /<section class="limits"/);
    assert.match(html, /<section class="provenance"/);
    assert.match(html, /<nav class="related"/);
    assert.match(html, /<pre[^>]*><code/);
    for (const link of page.relatedLinks) assert.match(html, new RegExp(`href="${escapeHtml(link.href)}"`));
    assert.match(html, new RegExp(`href="${escapeHtml(page.cta.href)}"`));
  }
});

test('JSON-LD matches visible page identity and no executable inline script or FAQ schema is emitted', async () => {
  const { AEO_PAGES } = await import('../src/content/aeo-pages.js');
  const { renderAeoPage } = await import('../src/content/render-aeo-page.js');

  for (const page of AEO_PAGES) {
    const html = renderAeoPage(page.route);
    const scripts = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/gi)];
    assert.equal(scripts.length, 1, page.route);
    assert.match(scripts[0][1], /type="application\/ld\+json"/);
    const structuredData = JSON.parse(scripts[0][2]);
    assert.deepEqual(structuredData, {
      '@context': 'https://schema.org',
      '@type': page.schemaType,
      headline: page.h1,
      description: page.description,
      url: page.canonical,
    });
    assert.doesNotMatch(html, /FAQPage/);
    assert.doesNotMatch(html, /<script(?![^>]*type="application\/ld\+json")/i);
  }
});

test('the shared renderer supports content tables where the registry calls for one', async () => {
  const { renderAeoPage } = await import('../src/content/render-aeo-page.js');
  const html = renderAeoPage('/comparisons/client-time-vs-server-time');
  assert.match(html, /<table>/);
  assert.match(html, /<thead>/);
  assert.match(html, /<tbody>/);
  assert.match(html, /Clock synchronization/);
});

test('P01, P03, and P05 tables expose captions plus column and row headers', async () => {
  const { escapeHtml, renderAeoPage } = await import('../src/content/render-aeo-page.js');
  const routes = [
    '/reference/server-time-api',
    '/problems/untrusted-client-time',
    '/comparisons/client-time-vs-server-time',
  ];

  for (const route of routes) {
    const page = await pageAt(route);
    const html = renderAeoPage(route);
    const tableSections = page.sections.filter(section => section.table);
    assert.ok(tableSections.length > 0, `${route} must have a representative table`);

    for (const section of tableSections) {
      const caption = `<caption class="visually-hidden">${escapeHtml(section.heading)}</caption>`;
      assert.match(html, new RegExp(`<table>${caption.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}<thead>`));
      assert.match(html, new RegExp(`<div class="table-wrap" role="region" tabindex="0" aria-label="Scrollable table: ${escapeHtml(section.heading).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}">`));

      const columnHeaders = section.table.headers.map(value => `<th scope="col">${escapeHtml(value)}</th>`).join('');
      assert.match(html, new RegExp(`<thead><tr>${columnHeaders.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}</tr></thead>`));
      for (const row of section.table.rows) {
        const cells = `<th scope="row">${escapeHtml(row[0])}</th>${row.slice(1).map(value => `<td>${escapeHtml(value)}</td>`).join('')}`;
        assert.match(html, new RegExp(`<tbody>[\\s\\S]*?<tr>${cells.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}</tr>`));
      }
    }
  }
});

test('table and code overflow controls are focusable with escaped dynamic labels', async () => {
  const { escapeHtml, renderAeoPage, renderExample, renderTable } = await import('../src/content/render-aeo-page.js');
  const heading = `Fields <mjd> & "utc"`;
  const title = `Fetch <receipt> & "inspect"`;
  assert.match(
    renderTable({ headers: ['Field'], rows: [['mjd']] }, heading),
    new RegExp(`role="region" tabindex="0" aria-label="Scrollable table: ${escapeHtml(heading)}"`),
  );
  assert.match(
    renderExample({ title, language: 'js', code: '<unsafe>' }),
    new RegExp(`<pre tabindex="0" aria-label="Scrollable code example: ${escapeHtml(title)}">`),
  );

  for (const route of CONTENT_PATHS) {
    const page = await pageAt(route);
    const html = renderAeoPage(route);
    for (const example of page.examples) {
      assert.match(html, new RegExp(`<pre tabindex="0" aria-label="Scrollable code example: ${escapeHtml(example.title).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}">`));
    }
  }
});

test('overflow focus indicators and table grid borders meet their CSS accessibility contracts', async () => {
  const { renderAeoPage } = await import('../src/content/render-aeo-page.js');
  const html = renderAeoPage('/comparisons/client-time-vs-server-time');
  const css = html.match(/<style>([\s\S]*?)<\/style>/)[1];
  assert.match(css, /\.table-wrap:focus-visible,pre:focus-visible\{outline:3px solid var\(--accent\);outline-offset:3px\}/);
  assert.match(css, /\.visually-hidden\{/);
  assert.match(css, /--table-line:#5f6d8e/);
  assert.match(css, /th,td\{[^}]*border:1px solid var\(--table-line\)/);

  const channel = hex => Number.parseInt(hex, 16) / 255;
  const luminance = hex => {
    const values = hex.match(/[0-9a-f]{2}/gi).map(channel).map(value => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
    return 0.2126 * values[0] + 0.7152 * values[1] + 0.0722 * values[2];
  };
  const lighter = luminance('5f6d8e');
  const darker = luminance('121a31');
  assert.ok((lighter + 0.05) / (darker + 0.05) >= 3);
});

test('the shared renderer escapes and renders section lists', async () => {
  const { renderList } = await import('../src/content/render-aeo-page.js');
  assert.equal(
    renderList(['Use utc', '<script>alert("x")</script>']),
    '<ul><li>Use utc</li><li>&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;</li></ul>',
  );
  const { renderAeoPage } = await import('../src/content/render-aeo-page.js');
  const html = renderAeoPage('/guides/current-timestamp');
  assert.match(html, /<section><h2>Which field should you use\?<\/h2>[\s\S]*<ul>/);
});

test('P01 documents the exact public endpoint and method matrix', async () => {
  const copy = pageCopy(await pageAt('/reference/server-time-api'));
  assert.match(copy, /GET \/mjd[\s\S]*mjd[\s\S]*utc[\s\S]*unix[\s\S]*source/i);
  assert.match(copy, /GET \/jd[\s\S]*(adds|plus)[\s\S]*jd/i);
  assert.match(copy, /HEAD[\s\S]*(bodyless|no response body)[\s\S]*(quota-neutral|not consumed)/i);
  assert.match(copy, /HEAD[\s\S]*(does not|doesn't)[\s\S]*(timestamp payload|time fields)/i);
  assert.match(copy, /OPTIONS[\s\S]*204/i);
  assert.match(copy, /Other methods[\s\S]*405[\s\S]*Allow: GET, HEAD, OPTIONS/i);
  assert.match(copy, /exact paths[\s\S]*\/mjd\/[\s\S]*404/i);
});

test('P01 defines every response field, rounding, serialization, and precision boundary', async () => {
  const copy = pageCopy(await pageAt('/reference/server-time-api'));
  for (const field of ['mjd', 'utc', 'unix', 'source', 'jd']) assert.match(copy, new RegExp(`Field[^]*${field}|${field}[^]*Type`, 'i'));
  assert.match(copy, /now \/ 86,400,000 \+ 40,587[\s\S]*eight decimal places/i);
  assert.match(copy, /new Date\(now\)\.toISOString\(\)/);
  assert.match(copy, /Math\.floor\(now \/ 1000\)/);
  assert.match(copy, /literal[\s\S]*server/i);
  assert.match(copy, /2,400,000\.5[\s\S]*eight decimal places/i);
  assert.match(copy, /JSON number serialization[\s\S]*(omit|does not preserve)[\s\S]*trailing zero/i);
  assert.match(copy, /(displayed precision|eight decimal places)[\s\S]*(not|does not)[\s\S]*(accuracy|clock accuracy)/i);
});

test('P01 fixed examples are generated by the current buildTimeResponse seam', async () => {
  const page = await pageAt('/reference/server-time-api');
  const fixedNow = Date.parse('2026-03-08T09:07:22.000Z');
  assert.deepEqual(JSON.parse(exampleCode(page, 'Fixed illustrative /mjd response')), buildTimeResponse(fixedNow));
  assert.deepEqual(JSON.parse(exampleCode(page, 'Fixed illustrative /jd response')), buildTimeResponse(fixedNow, true));
  assert.equal(exampleCode(page, 'Request /mjd'), "curl --fail-with-body --max-time 5 --header 'Accept: application/json' https://spydergoat.com/mjd");
  assert.equal(exampleCode(page, 'Request /jd'), "curl --fail-with-body --max-time 5 --header 'Accept: application/json' https://spydergoat.com/jd");
  assert.match(pageCopy(page), /fixed input time[\s\S]*not a live response/i);
});

test('P01 qualifies the current best-effort free limiter and exact illustrative 429 shape', async () => {
  const copy = pageCopy(await pageAt('/reference/server-time-api'));
  assert.match(copy, /KV binding configured[\s\S]*one unauthenticated GET[\s\S]*CF-Connecting-IP[\s\S]*30 minutes/i);
  assert.match(copy, /shared across[\s\S]*\/mjd[\s\S]*\/jd/i);
  assert.match(copy, /best-effort[\s\S]*(KV|abuse control)/i);
  assert.match(copy, /CF-Connecting-IP[\s\S]*absent[\s\S]*unknown/i);
  assert.match(copy, /no rate-limit KV binding[\s\S]*bypasses[\s\S]*not a promised service tier/i);
  const shape = exampleCode(await pageAt('/reference/server-time-api'), 'Illustrative 429 response');
  assert.match(shape, /HTTP\/1\.1 429 Too Many Requests/);
  assert.match(shape, /Retry-After: <seconds>/);
  assert.match(shape, /Content-Type: application\/json; charset=utf-8/);
  assert.match(shape, /Cache-Control: no-store/);
  assert.match(shape, /Access-Control-Allow-Origin: \*/);
  assert.match(shape, /"error": "rate_limited"/);
  assert.match(shape, /"message": "Free tier: 1 request per 30 minutes"/);
  assert.match(shape, /"retry_after": 1732/);
  assert.match(copy, /retry_after[\s\S]*Retry-After[\s\S]*runtime-calculated integer seconds/i);
});

test('P01 documents the method-specific API response header matrix', async () => {
  const cors = response => ({
    origin: response.headers.get('access-control-allow-origin'),
    methods: response.headers.get('access-control-allow-methods'),
    requestHeaders: response.headers.get('access-control-allow-headers'),
  });
  const assertJsonCache = response => {
    assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8');
    assert.equal(response.headers.get('cache-control'), 'no-store');
  };
  const expectedCors = { origin: '*', methods: 'GET, HEAD, OPTIONS', requestHeaders: 'Content-Type, Authorization' };
  const successfulJsonResponses = [];
  for (const path of ['/mjd', '/jd']) {
    successfulJsonResponses.push(await request(path));
    successfulJsonResponses.push(await request(path, { method: 'HEAD' }));
  }
  const rateLimited = await request('/mjd', {}, {
    SPYDERGOAT_KV: { async get() { return String(Date.now()); }, async put() { throw new Error('must not write'); } },
  });
  const options = await request('/mjd', { method: 'OPTIONS' });
  const post = await request('/mjd', { method: 'POST' });

  for (const response of successfulJsonResponses) {
    assert.equal(response.status, 200);
    assertJsonCache(response);
    assert.deepEqual(cors(response), expectedCors);
  }
  assert.equal(rateLimited.status, 429);
  assertJsonCache(rateLimited);
  assert.deepEqual(cors(rateLimited), expectedCors);
  assert.ok(rateLimited.headers.get('retry-after'));
  assert.equal(options.status, 204);
  assert.deepEqual(cors(options), expectedCors);
  assert.equal(options.headers.get('content-type'), null);
  assert.equal(options.headers.get('cache-control'), null);
  assert.equal(post.status, 405);
  assertJsonCache(post);
  assert.deepEqual(cors(post), { origin: null, methods: null, requestHeaders: null });

  const copy = pageCopy(await pageAt('/reference/server-time-api'));
  assert.match(copy, /successful GET and HEAD[\s\S]*Content-Type: application\/json; charset=utf-8[\s\S]*Cache-Control: no-store[\s\S]*API CORS/i);
  assert.match(copy, /429[\s\S]*Content-Type: application\/json; charset=utf-8[\s\S]*Cache-Control: no-store[\s\S]*API CORS/i);
  assert.match(copy, /OPTIONS[\s\S]*CORS[\s\S]*(does not|doesn't)[\s\S]*Content-Type[\s\S]*Cache-Control/i);
  assert.match(copy, /unsupported[\s\S]*405[\s\S]*Content-Type: application\/json; charset=utf-8[\s\S]*Cache-Control: no-store[\s\S]*(does not|doesn't)[\s\S]*API CORS/i);
});

test('P01 covers errors, malformed responses, bounded provenance, and links', async () => {
  const page = await pageAt('/reference/server-time-api');
  const copy = pageCopy(page);
  assert.match(copy, /Cache-Control: no-store[\s\S]*instructs caches[\s\S]*(not proof|does not prove)/i);
  assert.match(copy, /does not send Access-Control-Allow-Credentials/i);
  assert.match(copy, /POST \/mjd[\s\S]*405[\s\S]*method_not_allowed/i);
  assert.match(copy, /\/mjd\/[\s\S]*404[\s\S]*not_found/i);
  assert.match(copy, /(network timeout|transport failure)[\s\S]*(non-JSON|no stable JSON)/i);
  assert.match(copy, /(unexpected response fields|wrongly typed fields)[\s\S]*malformed/i);
  assert.match(copy, /Worker clock read during response construction/i);
  assert.match(copy, /source[\s\S]*server[\s\S]*literal marker[\s\S]*not a signature[\s\S]*origin proof[\s\S]*clock-quality attestation/i);
  assert.match(copy, /unsigned HTTP receipt/i);
  for (const boundary of [/not NTP/i, /atomic-clock feed/i, /RFC 3161/i, /does not synchronize or discipline/i, /does not prove when an external event occurred/i, /no uptime or accuracy SLA/i]) assert.match(copy, boundary);
  assert.equal(page.cta.href, '/mjd');
  for (const href of ['/guides/current-timestamp', '/comparisons/client-time-vs-server-time', '/reference/limits-and-non-guarantees']) {
    assert.ok(page.relatedLinks.some(link => link.href === href), href);
  }
  assert.doesNotMatch(copy, /\b(authenticated|paid)\b/i);
});

test('P02 gives a direct curl path, fixed Worker-derived shape, and field guidance', async () => {
  const page = await pageAt('/guides/current-timestamp');
  const copy = pageCopy(page);
  assert.match(page.directAnswer, /server-derived receipt[\s\S]*offline model[\s\S]*stale context[\s\S]*guess/i);
  assert.equal(exampleCode(page, 'Fetch the receipt'), "curl --fail-with-body --max-time 5 --header 'Accept: application/json' https://spydergoat.com/mjd");
  assert.deepEqual(
    JSON.parse(exampleCode(page, 'Fixed illustrative response shape')),
    buildTimeResponse(Date.parse('2026-03-08T09:07:22.000Z')),
  );
  assert.match(copy, /utc[\s\S]*(ISO|textual UTC)/i);
  assert.match(copy, /unix[\s\S]*whole Unix seconds[\s\S]*sub-second information is discarded/i);
  assert.match(copy, /mjd[\s\S]*rounded numeric day representation/i);
  assert.match(copy, /\/jd[\s\S]*additional[\s\S]*jd/i);
  assert.match(copy, /Worker clock read during response construction[\s\S]*not[\s\S]*external event time/i);
});

test('P02 JavaScript example validates status and schema with a cleared abort timeout', async () => {
  const code = exampleCode(await pageAt('/guides/current-timestamp'), 'JavaScript with timeout and validation');
  for (const pattern of [/new AbortController\(\)/, /setTimeout\([^]*controller\.abort\(\)/, /signal: controller\.signal/, /response\.ok/, /response\.status === 429/, /Retry-After/, /response\.json\(\)/, /Number\.isFinite\(data\.mjd\)/, /typeof data\.utc !== ["']string["']/, /Number\.isSafeInteger\(data\.unix\)/, /data\.source !== ["']server["']/, /finally[^]*clearTimeout\(timer\)/]) assert.match(code, pattern);
  const checked = spawnSync(process.execPath, ['--check', '--input-type=module'], { input: code, encoding: 'utf8' });
  assert.equal(checked.status, 0, checked.stderr);
});

test('P02 JavaScript example behavior rejects non-canonical receipts without external requests', async () => {
  const code = exampleCode(await pageAt('/guides/current-timestamp'), 'JavaScript with timeout and validation');
  const cases = [
    ['valid', { kind: 'receipt', receipt: VALID_RECEIPT }, true, ''],
    ['invalid date text', { kind: 'receipt', receipt: { ...VALID_RECEIPT, utc: '03/08/2026' } }, false, 'Unexpected SpyderGoat response'],
    ['non-UTC offset', { kind: 'receipt', receipt: { ...VALID_RECEIPT, utc: '2026-03-08T14:07:22.000+05:00' } }, false, 'Unexpected SpyderGoat response'],
    ['wrong fractional precision', { kind: 'receipt', receipt: { ...VALID_RECEIPT, utc: '2026-03-08T09:07:22Z' } }, false, 'Unexpected SpyderGoat response'],
    ['invalid calendar date', { kind: 'receipt', receipt: { ...VALID_RECEIPT, utc: '2026-02-30T09:07:22.000Z' } }, false, 'Unexpected SpyderGoat response'],
    ['429', { kind: '429' }, false, 'Retry-After=7'],
    ['malformed JSON', { kind: 'malformed' }, false, 'JSON'],
  ];
  for (const [label, scenario, ok, error] of cases) {
    const outcome = runJavaScriptExample(code, scenario);
    assert.equal(outcome.calls, 1, label);
    assert.equal(outcome.ok, ok, label);
    if (ok) assert.deepEqual(outcome.value, VALID_RECEIPT, label);
    else assert.match(outcome.error, new RegExp(error, 'i'), label);
  }
});

test('P02 Python stdlib example handles HTTP, network, timeout, JSON, and schema failures', async () => {
  const code = exampleCode(await pageAt('/guides/current-timestamp'), 'Python standard library with timeout and validation');
  for (const pattern of [/from urllib\.error import HTTPError, URLError/, /urlopen\(request, timeout=5\)/, /Retry-After/, /except HTTPError/, /URLError, TimeoutError/, /UnicodeDecodeError, json\.JSONDecodeError/, /math\.isfinite/, /type\(data\["unix"\]\) is int/, /data\["source"\] == "server"/, /Unexpected SpyderGoat response/]) assert.match(code, pattern);
  const checked = spawnSync('python3', ['-c', 'import sys; compile(sys.stdin.read(), "<embedded-spydergoat-example>", "exec")'], { input: code, encoding: 'utf8' });
  assert.equal(checked.status, 0, checked.stderr);
});

test('P02 Python example behavior rejects non-canonical receipts without external requests or bytecode', async () => {
  const code = exampleCode(await pageAt('/guides/current-timestamp'), 'Python standard library with timeout and validation');
  const cases = [
    ['valid', { kind: 'receipt', receipt: VALID_RECEIPT }, true, ''],
    ['invalid date text', { kind: 'receipt', receipt: { ...VALID_RECEIPT, utc: '03/08/2026' } }, false, 'Unexpected SpyderGoat response'],
    ['non-UTC offset', { kind: 'receipt', receipt: { ...VALID_RECEIPT, utc: '2026-03-08T14:07:22.000+05:00' } }, false, 'Unexpected SpyderGoat response'],
    ['wrong fractional precision', { kind: 'receipt', receipt: { ...VALID_RECEIPT, utc: '2026-03-08T09:07:22Z' } }, false, 'Unexpected SpyderGoat response'],
    ['invalid calendar date', { kind: 'receipt', receipt: { ...VALID_RECEIPT, utc: '2026-02-30T09:07:22.000Z' } }, false, 'Unexpected SpyderGoat response'],
    ['429', { kind: '429' }, false, 'HTTP 429; Retry-After=7'],
    ['malformed JSON', { kind: 'malformed' }, false, 'malformed JSON'],
  ];
  for (const [label, scenario, ok, error] of cases) {
    const outcome = runPythonExample(code, scenario);
    assert.equal(outcome.calls, 1, label);
    assert.equal(outcome.ok, ok, label);
    if (ok) assert.deepEqual(outcome.value, VALID_RECEIPT, label);
    else assert.match(outcome.error, new RegExp(error, 'i'), label);
  }
});

test('P02 makes every failure and receipt boundary explicit', async () => {
  const page = await pageAt('/guides/current-timestamp');
  const copy = pageCopy(page);
  assert.match(copy, /429[\s\S]*Retry-After[\s\S]*do not immediately repeat/i);
  assert.match(copy, /(aborts|timeout)[\s\S]*DNS failures[\s\S]*connection failures[\s\S]*unavailable service[\s\S]*missing external data/i);
  assert.match(copy, /Reject malformed JSON[\s\S]*missing or wrongly typed fields/i);
  assert.match(copy, /do not silently substitute the local clock/i);
  assert.match(copy, /source[\s\S]*local-fallback/i);
  assert.match(copy, /source[\s\S]*server[\s\S]*literal marker[\s\S]*not[\s\S]*authenticity/i);
  for (const boundary of [/unsigned HTTP receipt/i, /not NTP/i, /atomic-clock feed/i, /RFC 3161/i, /does not synchronize or discipline/i, /does not prove when an external event occurred/i, /Displayed precision is not an accuracy guarantee/i, /HTTP and network latency affect comparisons/i, /no uptime or accuracy SLA/i]) assert.match(copy, boundary);
  assert.equal(page.cta.href, '/reference/server-time-api');
  for (const href of ['/reference/server-time-api', '/problems/untrusted-client-time', '/comparisons/client-time-vs-server-time']) {
    assert.ok(page.relatedLinks.some(link => link.href === href), href);
  }
});

function runTimedJavaScriptExample(code, scenario, timings = [100, 140]) {
  const harness = `
const scenario = ${JSON.stringify(scenario)};
const timings = ${JSON.stringify(timings)};
let timingIndex = 0;
let calls = 0;
let logged;
let timerCreated = false;
let timerCleared = false;
let timerPending = false;
let timeoutCallback;
globalThis.performance = { now: () => timings[timingIndex++] };
globalThis.setTimeout = (callback, delay) => {
  if (delay !== 5000) throw new Error("unexpected timeout");
  timerCreated = true;
  timerPending = true;
  timeoutCallback = callback;
  return 73;
};
globalThis.clearTimeout = value => {
  if (value !== 73) throw new Error("unexpected timer");
  timerCleared = true;
  timerPending = false;
  timeoutCallback = undefined;
};
globalThis.fetch = async (url, init) => {
  calls += 1;
  if (url !== "https://spydergoat.com/mjd" || init.headers.Accept !== "application/json" || !(init.signal instanceof AbortSignal)) throw new Error("unexpected request");
  if (scenario.kind === "timeout") {
    return new Promise((resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(new DOMException("SpyderGoat request timed out", "AbortError")), { once: true });
      timeoutCallback();
    });
  }
  if (scenario.kind === "network-unavailable") throw new TypeError("network/service unavailable");
  if (scenario.kind === "429") return new Response(JSON.stringify({ error: "rate_limited" }), { status: 429, headers: { "Retry-After": "7" } });
  if (scenario.kind === "malformed") return new Response("{");
  return new Response(JSON.stringify(scenario.receipt));
};
console.log = value => { logged = value; };
let outcome;
try {
${code}
  outcome = { ok: true, value: logged, calls, timerCreated, timerCleared, timerPending };
} catch (error) {
  outcome = { ok: false, error: String(error.message), errorName: error.name, calls, timerCreated, timerCleared, timerPending };
}
process.stdout.write(JSON.stringify(outcome));
`;
  const result = spawnSync(process.execPath, ['--input-type=module'], { cwd: '/tmp', input: harness, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test('P03 separates all five time meanings and the bounded client-clock threat model', async () => {
  const page = await pageAt('/problems/untrusted-client-time');
  const copy = pageCopy(page);
  assert.match(page.directAnswer, /external comparison point[\s\S]*client time[\s\S]*(manipulated|misconfigured)[\s\S]*not[\s\S]*signed evidence/i);
  for (const meaning of ['event time', 'client-claimed time', 'application receipt time', 'response-construction time', 'receipt time at the caller']) assert.match(copy, new RegExp(meaning, 'i'));
  assert.match(copy, /client-controlled wall clock[\s\S]*(changed|misconfigured|stale|unavailable)/i);
  assert.match(copy, /does not capture request-arrival time/i);
  const table = page.sections.find(section => section.heading === 'Keep three time meanings separate')?.table;
  assert.deepEqual(table?.headers, ['Field', 'Meaning', 'What it does not establish']);
  assert.deepEqual(table?.rows.map(row => row[0]), ['client_claimed_at', 'application_received_at', 'external_receipt']);
});

test('P03 includes unsafe and corrected JavaScript plus a schema-only stored shape', async () => {
  const page = await pageAt('/problems/untrusted-client-time');
  const unsafe = exampleCode(page, 'Unsafe client-only timestamp');
  assert.match(unsafe, /new Date\(\)\.toISOString\(\)/);
  const corrected = exampleCode(page, 'Corrected request pattern');
  for (const pattern of [/new AbortController\(\)/, /signal: controller\.signal/, /response\.ok/, /response\.status === 429/, /Retry-After/, /Number\.isFinite\(externalReceipt\.mjd\)/, /toISOString\(\) !== externalReceipt\.utc/, /Number\.isSafeInteger\(externalReceipt\.unix\)/, /externalReceipt\.source !== "server"/, /client_claimed_at/, /application_received_at/, /external_receipt/, /finally[^]*clearTimeout\(timer\)/]) assert.match(corrected, pattern);
  const checked = spawnSync(process.execPath, ['--check', '--input-type=module'], { input: corrected, encoding: 'utf8' });
  assert.equal(checked.status, 0, checked.stderr);
  const stored = page.examples.find(example => example.title === 'Illustrative stored schema');
  assert.ok(stored);
  assert.match(stored.note || '', /schema illustration[\s\S]*not evidence of a real event/i);
  assert.doesNotThrow(() => JSON.parse(stored.code));
});

test('P03 corrected example behavior validates canonical data, status, malformed JSON, and timeout cleanup', async () => {
  const code = exampleCode(await pageAt('/problems/untrusted-client-time'), 'Corrected request pattern');
  const cases = [
    ['valid', { kind: 'receipt', receipt: VALID_RECEIPT }, true, '', null],
    ['invalid utc', { kind: 'receipt', receipt: { ...VALID_RECEIPT, utc: '2026-03-08T09:07:22Z' } }, false, 'Unexpected SpyderGoat response'],
    ['wrong source', { kind: 'receipt', receipt: { ...VALID_RECEIPT, source: 'client' } }, false, 'Unexpected SpyderGoat response'],
    ['429', { kind: '429' }, false, 'Retry-After=7'],
    ['malformed', { kind: 'malformed' }, false, 'JSON'],
    ['timeout abort', { kind: 'timeout' }, false, 'timed out', 'AbortError'],
    ['network unavailable', { kind: 'network-unavailable' }, false, 'network/service unavailable', 'TypeError'],
  ];
  for (const [label, scenario, ok, error, errorName] of cases) {
    const outcome = runTimedJavaScriptExample(code, scenario);
    assert.equal(outcome.calls, 1, label);
    assert.equal(outcome.ok, ok, label);
    assert.equal(outcome.timerCreated, true, label);
    assert.equal(outcome.timerCleared, true, label);
    assert.equal(outcome.timerPending, false, label);
    if (ok) {
      assert.equal(outcome.value.client_claimed_at, '2026-03-08T09:07:18.000Z');
      assert.deepEqual(outcome.value.external_receipt, VALID_RECEIPT);
    } else {
      assert.match(outcome.error, new RegExp(error, 'i'), label);
      if (errorName) assert.equal(outcome.errorName, errorName, label);
    }
  }
});

test('P03 makes replay, binding, failure-state, and event-proof limits explicit', async () => {
  const page = await pageAt('/problems/untrusted-client-time');
  const copy = pageCopy(page);
  for (const boundary of [/copied/i, /replayed/i, /network delay/i, /offline/i, /timeout/i, /429/i, /malformed/i, /service unavailable/i, /explicit unavailable state/i, /not request-bound/i, /not nonce-bound/i, /not event-bound/i, /not signed/i, /not tamper-proof/i, /does not prove[\s\S]*external event/i]) assert.match(copy, boundary);
  assert.match(copy, /free[\s\S]*30-minute[\s\S]*unsuitable[\s\S]*(rapid|high-frequency)/i);
  assert.ok(page.relatedLinks.some(link => link.href === '/reference/server-time-api'));
  assert.ok(page.relatedLinks.some(link => link.href === '/comparisons/client-time-vs-server-time'));
});

test('P04 defines an estimated midpoint offset with assumptions, never exact drift', async () => {
  const page = await pageAt('/problems/server-clock-drift');
  const copy = pageCopy(page);
  assert.match(page.directAnswer, /surface disagreement[\s\S]*does not discipline or synchronize/i);
  assert.match(copy, /estimated_offset_ms\s*=\s*server_utc_ms\s*-\s*\(\(client_send_wall_ms\s*\+\s*client_receive_wall_ms\)\s*\/\s*2\)/i);
  assert.match(copy, /round_trip_ms\s*=\s*client_receive_monotonic_ms\s*-\s*client_send_monotonic_ms/i);
  assert.match(copy, /stable client wall clock/i);
  assert.match(copy, /approximately symmetric[\s\S]*(network|processing)/i);
  assert.match(copy, /estimated|observed disagreement/i);
  assert.doesNotMatch(copy, /\btrue offset\b|\bexact drift\b/i);
});

test('P04 JavaScript behavior uses monotonic RTT and validates every failure with timeout cleanup', async () => {
  const code = exampleCode(await pageAt('/problems/server-clock-drift'), 'Working JavaScript comparison');
  for (const pattern of [/performance\.now\(\)/, /clientReceiveWallMs = clientSendWallMs \+ roundTripMs/, /response\.ok/, /response\.status === 429/, /Retry-After/, /Number\.isFinite\(receipt\.mjd\)/, /toISOString\(\) !== receipt\.utc/, /Number\.isSafeInteger\(receipt\.unix\)/, /receipt\.source !== "server"/, /finally[^]*clearTimeout\(timer\)/]) assert.match(code, pattern);
  const checked = spawnSync(process.execPath, ['--check', '--input-type=module'], { input: code, encoding: 'utf8' });
  assert.equal(checked.status, 0, checked.stderr);
  const valid = runTimedJavaScriptExample(code, { kind: 'receipt', receipt: VALID_RECEIPT }, [100, 140]);
  assert.equal(valid.ok, true);
  assert.equal(valid.value.roundTripMs, 40);
  assert.equal(valid.timerCleared, true);
  assert.equal(typeof valid.value.estimatedOffsetMs, 'number');
  for (const [kind, scenario, error, errorName] of [
    ['invalid utc', { kind: 'receipt', receipt: { ...VALID_RECEIPT, utc: 'not-utc' } }, 'Unexpected SpyderGoat response'],
    ['429', { kind: '429' }, 'Retry-After=7'],
    ['malformed', { kind: 'malformed' }, 'JSON'],
    ['timeout abort', { kind: 'timeout' }, 'timed out', 'AbortError'],
    ['network unavailable', { kind: 'network-unavailable' }, 'network/service unavailable', 'TypeError'],
  ]) {
    const outcome = runTimedJavaScriptExample(code, scenario);
    assert.equal(outcome.calls, 1, kind);
    assert.equal(outcome.ok, false, kind);
    assert.equal(outcome.timerCreated, true, kind);
    assert.equal(outcome.timerCleared, true, kind);
    assert.equal(outcome.timerPending, false, kind);
    assert.match(outcome.error, new RegExp(error, 'i'), kind);
    if (errorName) assert.equal(outcome.errorName, errorName, kind);
  }
});

test('P04 expected output is placeholder-only and interpretation preserves uncertainty', async () => {
  const page = await pageAt('/problems/server-clock-drift');
  const copy = pageCopy(page);
  const output = exampleCode(page, 'Expected runtime output shape');
  assert.match(output, /<ISO string measured at runtime>/);
  assert.match(output, /<number measured at runtime>/);
  assert.match(output, /<non-negative number measured at runtime>/);
  assert.match(copy, /positive[\s\S]*later[\s\S]*negative[\s\S]*earlier/i);
  assert.match(copy, /asymmetric[\s\S]*(latency|delay)/i);
  assert.match(copy, /(Worker processing|server processing)[\s\S]*scheduling/i);
  assert.match(copy, /one sample[\s\S]*(cannot|does not)[\s\S]*which clock is wrong/i);
  assert.match(copy, /repeated samples[\s\S]*raw[\s\S]*(RTT|round-trip)/i);
  assert.match(copy, /(application-specific|no universal)[\s\S]*threshold/i);
  assert.match(copy, /free[\s\S]*(does not permit rapid|unsuitable for rapid)[\s\S]*sampling/i);
  assert.match(copy, /NTP[\s\S]*clock-synchronization protocol[\s\S]*HTTP comparison point/i);
  assert.match(copy, /no accuracy SLA/i);
});

test('P05 compares six mechanisms fairly and structurally recommends non-SpyderGoat options', async () => {
  const page = await pageAt('/comparisons/client-time-vs-server-time');
  const table = page.sections.find(section => section.heading === 'Choose by job')?.table;
  assert.ok(table);
  const mechanisms = table.rows.map(row => row[0]);
  for (const mechanism of ['Client wall clock', 'Monotonic clock', 'Application server clock/log', 'SpyderGoat HTTP receipt', 'NTP', 'RFC 3161 timestamp token']) assert.ok(mechanisms.includes(mechanism), mechanism);
  const spyderGoatRecommendations = table.rows.filter(row => /SpyderGoat/i.test(row[1])).length;
  assert.equal(table.rows.length >= 6, true);
  assert.equal(spyderGoatRecommendations <= Math.floor(table.rows.length / 2), true);
  const copy = pageCopy(page);
  for (const decision of [/local[\s\S]*display/i, /elapsed duration/i, /application receipt/i, /external clock comparison/i, /signed datum timestamping/i]) assert.match(copy, decision);
  assert.match(copy, /digest[\s\S]*TSA/i);
  assert.match(copy, /RFC 3161[\s\S]*(does not|doesn't)[\s\S]*prove[\s\S]*real-world event/i);
});

test('P05 renders escaped visible primary sources with exact URLs', async () => {
  const page = await pageAt('/comparisons/client-time-vs-server-time');
  assert.deepEqual(page.sources.map(source => source.href), [
    'https://www.w3.org/TR/hr-time-3',
    'https://www.rfc-editor.org/rfc/rfc5905.txt',
    'https://www.rfc-editor.org/rfc/rfc3161.txt',
  ]);
  assert.equal(page.sources.every(source => !/[<>]/.test(source.label)), true);
  const html = (await import('../src/content/render-aeo-page.js')).renderAeoPage(page.route);
  assert.match(html, /<section class="sources"><h2>Primary sources<\/h2>/);
  for (const source of page.sources) {
    assert.match(html, new RegExp(`href="${source.href.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`));
    assert.match(html, new RegExp(source.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.doesNotMatch(html, /target="_blank"/);
});

test('P04 and P06 cite the exact primary standards beside external mechanism claims', async () => {
  const expectations = [
    ['/problems/server-clock-drift', ['https://www.rfc-editor.org/rfc/rfc5905.txt']],
    ['/reference/limits-and-non-guarantees', [
      'https://www.rfc-editor.org/rfc/rfc5905.txt',
      'https://www.rfc-editor.org/rfc/rfc3161.txt',
    ]],
  ];
  const { renderAeoPage } = await import('../src/content/render-aeo-page.js');
  for (const [route, urls] of expectations) {
    const page = await pageAt(route);
    assert.deepEqual(page.sources.map(source => source.href), urls, route);
    const html = renderAeoPage(route);
    assert.match(html, /<section class="sources"><h2>Primary sources<\/h2>/, route);
    for (const url of urls) assert.match(html, new RegExp(`href="${url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`), route);
  }
});

test('P06 is a complete field-by-field and transport limit reference', async () => {
  const page = await pageAt('/reference/limits-and-non-guarantees');
  const copy = pageCopy(page);
  for (const boundary of [/utc[\s\S]*milliseconds/i, /unix[\s\S]*(whole|floored)[\s\S]*seconds/i, /(MJD|JD)[\s\S]*rounded[\s\S]*trailing[\s\S]*zero/i, /precision[\s\S]*(not|does not)[\s\S]*accuracy/i, /Worker clock read during response construction/i, /not request-arrival time/i, /not caller-receipt time/i, /not external-event time/i, /unsigned[\s\S]*(copied|replayed)/i, /not request-bound/i, /not nonce-bound/i, /not data-bound/i, /not event-bound/i, /not an RFC 3161 timestamp token/i, /NTP disciplines clocks[\s\S]*does not/i, /no-store[\s\S]*instruction[\s\S]*not proof/i, /no uptime[\s\S]*SLA/i, /no accuracy SLA/i, /no maximum-error bound/i, /best-effort[\s\S]*(rate|abuse control)/i]) assert.match(copy, boundary);
  assert.match(copy, /KV binding configured[\s\S]*shared[\s\S]*\/mjd[\s\S]*\/jd[\s\S]*30 minutes/i);
  assert.match(page.provenance.text, /buildTimeResponse\(\)[\s\S]*checkFreeRateLimit\(\)[\s\S]*src\/api\/worker\.js[\s\S]*test\/worker\.test\.js[\s\S]*do not establish independent Cloudflare clock accuracy/i);
});

test('P06 includes all concrete failure counterexamples and cannot-prove outcomes', async () => {
  const page = await pageAt('/reference/limits-and-non-guarantees');
  const copy = pageCopy(page);
  for (const counterexample of [/client[\s\S]*event[\s\S]*requests SpyderGoat later/i, /queued for minutes/i, /JSON[\s\S]*copied into another record/i, /response[\s\S]*replayed/i, /network delay[\s\S]*asymmetric/i, /service[\s\S]*unavailable/i, /two clocks disagree[\s\S]*which is correct/i]) assert.match(copy, counterexample);
  const cannotProve = page.sections.find(section => section.heading === 'What the API cannot prove');
  assert.ok(cannotProve);
  assert.equal(cannotProve.items.length >= 10, true);
  for (const outcome of [/client clock was correct/i, /external event occurred/i, /copied receipt belongs/i, /not replayed/i, /causal order/i, /clock became synchronized/i, /Worker clock met/i, /uptime or latency target/i]) assert.match(JSON.stringify(cannotProve.items), outcome);
});

test('the Worker serves exactly the six AEO content route contracts', async () => {
  for (const path of CONTENT_PATHS) {
    const response = await request(path);
    assert.equal(response.status, 200, path);
    assert.match(response.headers.get('content-type') || '', /^text\/html; charset=utf-8$/i, path);
  }
});

test('content GET responses apply page security headers without API CORS', async () => {
  for (const path of CONTENT_PATHS) {
    const response = await request(path);
    assert.equal(response.status, 200, path);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
    assert.match(response.headers.get('content-security-policy') || '', /frame-ancestors 'none'/);
    assert.equal(response.headers.get('access-control-allow-origin'), null);
  }
});

test('content HEAD is bodyless and quota-neutral', async () => {
  let quotaTouches = 0;
  const bindings = {
    SPYDERGOAT_KV: {
      async get() { quotaTouches++; return null; },
      async put() { quotaTouches++; },
    },
  };
  for (const path of CONTENT_PATHS) {
    const response = await request(path, { method: 'HEAD' }, bindings);
    assert.equal(response.status, 200, path);
    assert.equal(await response.text(), '');
    assert.match(response.headers.get('content-type') || '', /^text\/html; charset=utf-8$/i);
  }
  assert.equal(quotaTouches, 0);
});

test('content routes reject methods other than GET and HEAD', async () => {
  for (const path of CONTENT_PATHS) {
    const response = await request(path, { method: 'POST' });
    assert.equal(response.status, 405, path);
    assert.equal(response.headers.get('allow'), 'GET, HEAD');
    assert.deepEqual(await response.json(), { error: 'method_not_allowed' });
  }
});

test('an unknown content route remains not found', async () => {
  const response = await request('/guides/not-a-page');
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: 'not_found', endpoints: ['/', '/mjd', '/jd'] });
});

test('public time API route contracts remain unchanged', async () => {
  const mjdResponse = await request('/mjd');
  const mjd = await mjdResponse.json();
  assert.equal(mjdResponse.status, 200);
  assert.deepEqual(Object.keys(mjd).sort(), ['mjd', 'source', 'unix', 'utc']);
  assert.equal(mjd.source, 'server');

  const jdResponse = await request('/jd');
  const jd = await jdResponse.json();
  assert.equal(jdResponse.status, 200);
  assert.deepEqual(Object.keys(jd).sort(), ['jd', 'mjd', 'source', 'unix', 'utc']);
  assert.equal(jd.source, 'server');
});

test('protected paid route contracts remain ahead of public content routing', async () => {
  const checkout = await request('/checkout/pro', { method: 'POST' });
  assert.equal(checkout.status, 503);
  assert.deepEqual(await checkout.json(), { error: 'paid_access_paused' });

  const webhook = await request('/webhook', { method: 'POST', body: '{}' });
  assert.equal(webhook.status, 503);
  assert.deepEqual(await webhook.json(), { error: 'paid_access_paused' });

  const success = await request('/success?session_id=cs_test_123456');
  assert.equal(success.status, 503);
  assert.match(await success.text(), /Paid access is paused/);
});

test('the renderer preserves canonical absolute HTTPS source hrefs', async () => {
  const { validateHref } = await import('../src/content/render-aeo-page.js');
  assert.equal(validateHref('https://www.rfc-editor.org/rfc/rfc5905.txt', 'source'), 'https://www.rfc-editor.org/rfc/rfc5905.txt');
  assert.equal(validateHref('https://www.w3.org/TR/hr-time-3', 'source'), 'https://www.w3.org/TR/hr-time-3');
  assert.equal(validateHref('https://example.com/reference?kind=clock#source', 'source'), 'https://example.com/reference?kind=clock#source');
});

test('the renderer rejects noncanonical or unsafe source hrefs before URL normalization', async () => {
  const { validateHref } = await import('../src/content/render-aeo-page.js');
  for (const href of [
    String.raw`https:\\evil.example/reference`,
    String.raw`https:/\evil.example/reference`,
    String.raw`https://evil.example\reference`,
    '//example.com/source',
    'http://example.com/source',
    'HTTPS://example.com/source',
    'https://',
    'https://user:password@example.com/source',
    ' https://example.com/source',
    'https://example.com/source ',
    'https://example.com/\nsource',
    'https://example.com/\tsource',
    'https://example.com/\0source',
    'https://example.com/\x7fsource',
    '/reference/source',
    'javascript:alert(1)',
    'data:text/html,unsafe',
  ]) {
    assert.throws(() => validateHref(href, 'source'), /unsafe source href/i, href);
  }
});

test('the renderer preserves safe root-relative site hrefs and keeps site policy unchanged', async () => {
  const { validateHref } = await import('../src/content/render-aeo-page.js');
  for (const href of ['/', '/mjd', '/reference/server-time-api', '/guides/current-timestamp?from=home#example']) {
    assert.equal(validateHref(href, 'site'), href);
  }
  for (const href of ['//example.com/path', 'https://example.com/path', 'javascript:alert(1)', 'data:text/html,unsafe', 'reference/server-time-api', ' /mjd']) {
    assert.throws(() => validateHref(href, 'site'), /unsafe site href/i, href);
  }
});

test('the renderer rejects browser network-path site hrefs containing backslashes', async () => {
  const { validateHref } = await import('../src/content/render-aeo-page.js');
  for (const href of [
    '/\\example.com/path',
    '/\\/example.com/path',
    '/\\\\example.com/path',
    '//\\example.com/path',
    '\\/example.com/path',
  ]) {
    assert.throws(() => validateHref(href, 'site'), /unsafe site href/i, href);
  }
});

test('the renderer rejects site href controls and edge whitespace that browsers normalize', async () => {
  const { validateHref } = await import('../src/content/render-aeo-page.js');
  for (const href of [
    '/\n/example.com/path',
    '/\r/example.com/path',
    '/\t/example.com/path',
    '/mjd\n',
    '/mjd\t',
    '/mjd ',
    '/\0mjd',
    '/\x7fmjd',
  ]) {
    assert.throws(() => validateHref(href, 'site'), /unsafe site href/i, JSON.stringify(href));
  }
});

test('content pages provide a visible-on-focus skip link to main content', async () => {
  const { renderAeoPage } = await import('../src/content/render-aeo-page.js');
  const html = renderAeoPage('/reference/server-time-api');
  assert.match(html, /<a class="skip-link" href="#content">Skip to content<\/a>/);
  assert.match(html, /<main id="content"/);
  assert.match(html, /\.skip-link\{[^}]*position:fixed[^}]*transform:translateY\(-200%\)[^}]*\}/);
  assert.match(html, /\.skip-link:focus\{[^}]*transform:translateY\(0\)[^}]*\}/);
});

test('P05 bounds application ordering claims to receipt timestamps and operational logs', async () => {
  const page = await pageAt('/comparisons/client-time-vs-server-time');
  const row = page.sections.find(section => section.heading === 'Choose by job')?.table?.rows
    .find(value => value[0] === 'Application server clock/log');
  assert.ok(row);
  assert.match(row[2], /application receipt timestamps and operational logs/i);
  assert.doesNotMatch(row[2], /server-side ordering/i);
});

test('sitemap is valid escaped XML containing home and every canonical exactly once', async () => {
  const { AEO_PAGES } = await import('../src/content/aeo-pages.js');
  const expected = ['https://spydergoat.com/', ...AEO_PAGES.map(page => page.canonical)];
  const response = await request('/sitemap.xml');
  const xml = await response.text();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'application/xml; charset=utf-8');
  assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  assert.match(xml, /<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
  assert.doesNotMatch(xml, /&(?!amp;|lt;|gt;|quot;|apos;)/);
  assert.equal((xml.match(/<url><loc>/g) || []).length, expected.length);
  for (const canonical of expected) {
    assert.equal(xml.split(`<loc>${canonical}</loc>`).length - 1, 1, canonical);
  }
  assert.equal(new Set([...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1])).size, expected.length);
});

test('sitemap HEAD is bodyless and robots points to its exact canonical URL', async () => {
  const head = await request('/sitemap.xml', { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('content-type'), 'application/xml; charset=utf-8');
  assert.equal(await head.text(), '');
  const robots = await request('/robots.txt');
  assert.equal(robots.status, 200);
  assert.equal(await robots.text(), 'User-agent: *\nAllow: /\nSitemap: https://spydergoat.com/sitemap.xml\n');
});
