import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const css = await readFile(new URL('../src/web/styles.css', import.meta.url), 'utf8');

function relativeLuminance(hex) {
  const channels = hex.match(/[0-9a-f]{2}/gi).map(value => Number.parseInt(value, 16) / 255);
  const [red, green, blue] = channels.map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrastRatio(first, second) {
  const [lighter, darker] = [relativeLuminance(first), relativeLuminance(second)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

test('interactive control boundaries meet 3:1 non-text contrast', () => {
  const controlBorder = css.match(/--control-border:\s*(#[0-9a-f]{6})/i)?.[1];
  const pageBackground = css.match(/--ink:\s*(#[0-9a-f]{6})/i)?.[1];
  assert.ok(controlBorder, 'control border token must exist');
  assert.ok(pageBackground, 'page background token must exist');
  assert.ok(contrastRatio(controlBorder, pageBackground) >= 3, 'control border must have at least 3:1 contrast');
  assert.match(css, /\.button\s*\{[^}]*border:\s*1px solid var\(--control-border\)/s);
  assert.match(css, /\.copy-button\s*\{[^}]*border:\s*1px solid var\(--control-border\)/s);
});

test('static shell preserves metadata, bootstrap seam, and a useful no-script fallback', () => {
  assert.match(html, /<link rel="canonical" href="https:\/\/spydergoat\.com\/"/);
  assert.match(html, /id="spydergoat-bootstrap"/);
  assert.match(html, /__SPYDERGOAT_BOOTSTRAP__/);
  assert.match(html, /<noscript>[\s\S]*A compact external time reference for software\.[\s\S]*\/mjd[\s\S]*Paid access is paused[\s\S]*<\/noscript>/i);
  assert.doesNotMatch(html, /buy\.stripe\.com|Get API key|Subscribe/i);
});
