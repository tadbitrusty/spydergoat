import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const css = await readFile(new URL('../src/web/styles.css', import.meta.url), 'utf8');
const wrangler = await readFile(new URL('../wrangler.toml', import.meta.url), 'utf8');

const AEO_PATHS = [
  '/reference/server-time-api',
  '/guides/current-timestamp',
  '/problems/untrusted-client-time',
  '/problems/server-clock-drift',
  '/comparisons/client-time-vs-server-time',
  '/reference/limits-and-non-guarantees',
];

function relativeLuminance(hex) {
  const channels = hex.match(/[0-9a-f]{2}/gi).map(value => Number.parseInt(value, 16) / 255);
  const [red, green, blue] = channels.map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrastRatio(first, second) {
  const [lighter, darker] = [relativeLuminance(first), relativeLuminance(second)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

test('navigation and copy controls provide 44px touch targets', () => {
  assert.match(css, /\.nav-links a\s*\{[^}]*min-height:\s*44px/s);
  assert.match(css, /\.copy-button\s*\{[^}]*min-height:\s*44px/s);
});

test('interactive control boundaries meet 3:1 non-text contrast', () => {
  const controlBorder = css.match(/--control-border:\s*(#[0-9a-f]{6})/i)?.[1];
  const pageBackground = css.match(/--ink:\s*(#[0-9a-f]{6})/i)?.[1];
  assert.ok(controlBorder, 'control border token must exist');
  assert.ok(pageBackground, 'page background token must exist');
  assert.ok(contrastRatio(controlBorder, pageBackground) >= 3, 'control border must have at least 3:1 contrast');
  assert.match(css, /\.button\s*\{[^}]*border:\s*1px solid var\(--control-border\)/s);
  assert.match(css, /\.copy-button\s*\{[^}]*border:\s*1px solid var\(--control-border\)/s);
});

test('static shell preserves metadata, bootstrap seam, and a current crawlable no-script fallback', () => {
  assert.match(html, /<link rel="canonical" href="https:\/\/spydergoat\.com\/"/);
  assert.match(html, /id="spydergoat-bootstrap"/);
  assert.match(html, /__SPYDERGOAT_BOOTSTRAP__/);
  assert.match(html, /<noscript>[\s\S]*A compact external time reference for software\.[\s\S]*\/mjd[\s\S]*Pro access live[\s\S]*<\/noscript>/i);
  for (const path of AEO_PATHS) {
    assert.equal((html.match(new RegExp(`href=["']${path}["']`, 'g')) || []).length, 1, path);
  }
  assert.doesNotMatch(html, /Paid access is paused|Billing and API-key access remain unavailable during the transactional rebuild/i);
  assert.doesNotMatch(html, /buy\.stripe\.com|Get API key/i);
});

test('production assets route every exact AEO path through the Worker once without losing existing routes', () => {
  const runWorkerFirst = wrangler.match(/run_worker_first\s*=\s*\[([^\]]+)\]/s)?.[1];
  assert.ok(runWorkerFirst, 'run_worker_first must exist');
  const configuredPaths = [...runWorkerFirst.matchAll(/"([^"]+)"/g)].map(match => match[1]);
  for (const path of AEO_PATHS) assert.equal(configuredPaths.filter(value => value === path).length, 1, path);
  for (const path of ['/', '/index.html', '/mjd', '/jd', '/checkout/pro', '/success', '/webhook', '/sitemap.xml', '/robots.txt']) {
    assert.equal(configuredPaths.filter(value => value === path).length, 1, path);
  }
  assert.equal(configuredPaths.some(path => path.includes('*')), false);
});
