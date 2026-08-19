import { AEO_PAGES_BY_ROUTE } from './aeo-pages.js';

const ESCAPES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ESCAPES[character]);
}

const SITE_ORIGIN = 'https://spydergoat.com';
const ASCII_CONTROL = /[\u0000-\u001f\u007f]/;

export function validateHref(href, kind) {
  if (typeof href !== 'string') throw new TypeError(`Unsafe ${kind} href`);
  if (
    kind === 'source'
    && href.startsWith('https://')
    && !href.includes('\\')
    && !ASCII_CONTROL.test(href)
    && href.trim() === href
  ) {
    try {
      const url = new URL(href);
      if (url.protocol === 'https:' && url.hostname && !url.username && !url.password) return href;
    } catch {
      // Rejected below.
    }
  } else if (
    kind === 'site'
    && href.startsWith('/')
    && !href.startsWith('//')
    && !href.includes('\\')
    && !ASCII_CONTROL.test(href)
    && href.trim() === href
  ) {
    try {
      if (new URL(href, SITE_ORIGIN).origin === SITE_ORIGIN) return href;
    } catch {
      // Rejected below.
    }
  }
  throw new TypeError(`Unsafe ${kind} href: ${href}`);
}

export function renderTable(table, heading) {
  if (!table) return '';
  const head = table.headers.map(value => `<th scope="col">${escapeHtml(value)}</th>`).join('');
  const body = table.rows.map(row => `<tr><th scope="row">${escapeHtml(row[0])}</th>${row.slice(1).map(value => `<td>${escapeHtml(value)}</td>`).join('')}</tr>`).join('');
  const escapedHeading = escapeHtml(heading);
  return `<div class="table-wrap" role="region" tabindex="0" aria-label="Scrollable table: ${escapedHeading}"><table><caption class="visually-hidden">${escapedHeading}</caption><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

export function renderList(items = []) {
  if (!items.length) return '';
  return `<ul>${items.map(value => `<li>${escapeHtml(value)}</li>`).join('')}</ul>`;
}

function renderSection(section) {
  const paragraphs = (section.paragraphs || []).map(value => `<p>${escapeHtml(value)}</p>`).join('');
  return `<section><h2>${escapeHtml(section.heading)}</h2>${paragraphs}${renderList(section.items)}${renderTable(section.table, section.heading)}</section>`;
}

export function renderExample(example) {
  const title = escapeHtml(example.title);
  return `<article class="example"><h3>${title}</h3>${example.note ? `<p class="muted">${escapeHtml(example.note)}</p>` : ''}<pre tabindex="0" aria-label="Scrollable code example: ${title}"><code class="language-${escapeHtml(example.language)}">${escapeHtml(example.code)}</code></pre></article>`;
}

export function safeJson(value) {
  return JSON.stringify(value).replace(/[<>&]/g, character => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

export function renderAeoPage(route) {
  if (!Object.hasOwn(AEO_PAGES_BY_ROUTE, route)) throw new RangeError(`Unknown AEO route: ${route}`);
  const page = AEO_PAGES_BY_ROUTE[route];

  const structuredData = safeJson({
    '@context': 'https://schema.org',
    '@type': page.schemaType,
    headline: page.h1,
    description: page.description,
    url: page.canonical,
  });
  const sections = page.sections.map(renderSection).join('');
  const examples = page.examples.map(example => renderExample(example)).join('');
  const limits = page.limits.map(limit => `<li>${escapeHtml(limit)}</li>`).join('');
  const sources = (page.sources || []).map(source => `<li><a href="${escapeHtml(validateHref(source.href, 'source'))}">${escapeHtml(source.label)}</a></li>`).join('');
  const related = page.relatedLinks.map(link => `<li><a href="${escapeHtml(validateHref(link.href, 'site'))}">${escapeHtml(link.label)}</a></li>`).join('');
  const homeHref = escapeHtml(validateHref('/', 'site'));
  const ctaHref = escapeHtml(validateHref(page.cta.href, 'site'));

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(page.title)}</title><meta name="description" content="${escapeHtml(page.description)}"><link rel="canonical" href="${escapeHtml(page.canonical)}"><meta property="og:type" content="article"><meta property="og:title" content="${escapeHtml(page.title)}"><meta property="og:description" content="${escapeHtml(page.description)}"><meta property="og:url" content="${escapeHtml(page.canonical)}"><meta name="theme-color" content="#0a0f1e"><script type="application/ld+json">${structuredData}</script><style>:root{color-scheme:dark;--ink:#0a0f1e;--panel:#121a31;--line:#2a3555;--table-line:#5f6d8e;--text:#e9edf8;--muted:#aab3ca;--accent:#f5b23f}*{box-sizing:border-box}body{margin:0;background:var(--ink);color:var(--text);font:16px/1.65 system-ui,-apple-system,sans-serif}a{color:var(--accent)}a:focus-visible{outline:3px solid var(--accent);outline-offset:3px}.skip-link{position:fixed;z-index:10;top:.75rem;left:.75rem;padding:.6rem .8rem;background:var(--accent);color:var(--ink);transform:translateY(-200%)}.skip-link:focus{transform:translateY(0)}.wrap{width:min(860px,calc(100% - 2rem));margin:auto}.site-header,.site-footer{border-block:1px solid var(--line);padding:1rem 0}.site-header a{font-weight:700;text-decoration:none}main{padding:3rem 0 5rem}h1{font-size:clamp(2rem,7vw,3.5rem);line-height:1.12;margin:.4rem 0 1rem}h2{margin-top:2.6rem;line-height:1.25}h3{line-height:1.3}.eyebrow{color:var(--accent);font:700 .75rem ui-monospace,monospace;letter-spacing:.12em;text-transform:uppercase}.answer{font-size:1.2rem;color:var(--text);border-left:4px solid var(--accent);padding-left:1rem}.muted,.provenance{color:var(--muted)}.visually-hidden{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}pre{overflow:auto;background:var(--panel);border:1px solid var(--line);border-radius:.4rem;padding:1rem}code{font-family:ui-monospace,SFMono-Regular,Consolas,monospace}.table-wrap{overflow-x:auto}.table-wrap:focus-visible,pre:focus-visible{outline:3px solid var(--accent);outline-offset:3px}table{width:100%;border-collapse:collapse;background:var(--panel)}th,td{padding:.75rem;text-align:left;border:1px solid var(--table-line);vertical-align:top}.limits{padding:1rem 1.25rem;background:var(--panel);border:1px solid var(--line)}.related{margin-top:2.5rem}.related ul{padding-left:1.2rem}.cta{display:inline-block;margin-top:1rem;padding:.7rem 1rem;background:var(--accent);color:var(--ink);font-weight:700;text-decoration:none;border-radius:.3rem}@media(max-width:560px){main{padding-top:2rem}th,td{padding:.55rem}}</style></head><body><a class="skip-link" href="#content">Skip to content</a><header class="site-header"><div class="wrap"><a href="${homeHref}">SpyderGoat</a></div></header><main id="content" class="wrap"><article><header><div class="eyebrow">Developer time reference</div><h1>${escapeHtml(page.h1)}</h1><p class="answer">${escapeHtml(page.directAnswer)}</p></header>${sections}<section class="examples" aria-labelledby="examples-heading"><h2 id="examples-heading">Examples</h2>${examples}</section><section class="limits" aria-labelledby="limits-heading"><h2 id="limits-heading">Limits and non-guarantees</h2><ul>${limits}</ul></section><section class="provenance" aria-labelledby="provenance-heading"><h2 id="provenance-heading">${escapeHtml(page.provenance.label)}</h2><p>${escapeHtml(page.provenance.text)}</p></section>${sources ? `<section class="sources"><h2>Primary sources</h2><ul>${sources}</ul></section>` : ''}<nav class="related" aria-labelledby="related-heading"><h2 id="related-heading">Related reading</h2><ul>${related}</ul></nav><a class="cta" href="${ctaHref}">${escapeHtml(page.cta.label)}</a></article></main><footer class="site-footer"><div class="wrap">SpyderGoat provides server-derived HTTP time receipts with explicit limits.</div></footer></body></html>`;
}
