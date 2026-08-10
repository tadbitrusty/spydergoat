import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');

test('static shell preserves metadata, bootstrap seam, and a useful no-script fallback', () => {
  assert.match(html, /<link rel="canonical" href="https:\/\/spydergoat\.com\/"/);
  assert.match(html, /id="spydergoat-bootstrap"/);
  assert.match(html, /__SPYDERGOAT_BOOTSTRAP__/);
  assert.match(html, /<noscript>[\s\S]*A compact external time reference for software\.[\s\S]*\/mjd[\s\S]*Paid access is paused[\s\S]*<\/noscript>/i);
  assert.doesNotMatch(html, /buy\.stripe\.com|Get API key|Subscribe/i);
});
