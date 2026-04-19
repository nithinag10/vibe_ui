import { CONFIG } from '../../shared/config.js';

// ─── Public tool ─────────────────────────────────────────────────────────────
export const inspectTool = {
  definition: {
    name: 'inspect',
    description:
      'Inspect the DOM. Four modes:\n' +
      '  • overview (no args): page title, viewport, key landmarks, iframes, suggested selectors.\n' +
      '  • selector: full info for a CSS selector.\n' +
      '  • text: find elements whose textContent contains the string (leaf-most matches).\n' +
      '  • regex: search attrs (class, id, src, href, onclick, role, aria-*, alt, title) with a regex.\n' +
      'Returns parent path, full attrs, computed styles, bounding rect, truncated outerHTML, children count. ' +
      'Paginate with {page, limit}. Always use this before apply_changes — never guess selectors.',
    input_schema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector (mode: selector)' },
        text:     { type: 'string', description: 'Substring to find in textContent (mode: text)' },
        regex:    { type: 'string', description: 'Regex pattern to match against element attributes (mode: regex)' },
        page:     { type: 'integer', minimum: 0, description: 'Page index for pagination (default 0)' },
        limit:    { type: 'integer', minimum: 1, maximum: 50, description: 'Max matches per page (default 15)' },
      },
      required: [],
    },
  },

  execute: async (input = {}) => {
    const { selector, text, regex } = input;
    const page = Number.isFinite(input.page) ? input.page : 0;
    const limit = Math.min(input.limit || CONFIG.dom.defaultLimit, CONFIG.dom.maxLimit);

    if (selector) return runSelector(selector, page, limit);
    if (text)     return runText(text, page, limit);
    if (regex)    return runRegex(regex, page, limit);
    return runOverview();
  },
};

// ─── Mode implementations ────────────────────────────────────────────────────
function runSelector(selector, page, limit) {
  let all;
  try { all = [...document.querySelectorAll(selector)]; }
  catch (e) { return { mode: 'selector', error: `Invalid selector: ${e.message}`, total: 0, matches: [] }; }
  const total = all.length;
  const slice = all.slice(page * limit, page * limit + limit);
  return {
    mode: 'selector',
    query: selector,
    total,
    page,
    hasMore: (page + 1) * limit < total,
    matches: slice.map(describe),
    ...(total === 0 ? { hint: 'No matches. Try inspect with text/regex or broaden the selector.' } : {}),
  };
}

function runText(text, page, limit) {
  const needle = text.toLowerCase();
  const all = [];
  for (const el of document.querySelectorAll('body, body *')) {
    if (!el.textContent) continue;
    if (!el.textContent.toLowerCase().includes(needle)) continue;
    const childHas = [...el.children].some(c => c.textContent?.toLowerCase().includes(needle));
    if (!childHas) all.push(el);
  }
  const total = all.length;
  const slice = all.slice(page * limit, page * limit + limit);
  return {
    mode: 'text',
    query: text,
    total,
    page,
    hasMore: (page + 1) * limit < total,
    matches: slice.map(describe),
  };
}

function runRegex(pattern, page, limit) {
  let rx;
  try { rx = new RegExp(pattern, 'i'); }
  catch (e) { return { mode: 'regex', error: `Invalid regex: ${e.message}`, total: 0, matches: [] }; }
  const all = [];
  for (const el of document.querySelectorAll('body, body *')) {
    if (regexHitsAttrs(el, rx)) all.push(el);
  }
  const total = all.length;
  const slice = all.slice(page * limit, page * limit + limit);
  return {
    mode: 'regex',
    query: pattern,
    total,
    page,
    hasMore: (page + 1) * limit < total,
    matches: slice.map(describe),
  };
}

function runOverview() {
  const total = document.querySelectorAll('body *').length;
  const iframes = [...document.querySelectorAll('iframe')].slice(0, 20).map(f => ({
    src: f.src || null,
    host: safeHost(f.src),
    id: f.id || null,
    classes: [...f.classList].slice(0, 4),
    rect: rectOf(f),
  }));
  const landmarks = [
    'header', 'nav', 'main', 'article', 'aside', 'footer',
    '[role="banner"]', '[role="navigation"]', '[role="main"]', '[role="complementary"]', '[role="contentinfo"]',
  ].flatMap(sel => {
    const els = [...document.querySelectorAll(sel)];
    return els.slice(0, 2).map(el => ({ landmark: sel, path: getPath(el), rect: rectOf(el) }));
  });
  return {
    mode: 'overview',
    url: location.href,
    title: document.title,
    viewport: { w: window.innerWidth, h: window.innerHeight, scrollY: window.scrollY },
    totalElements: total,
    iframes,
    landmarks,
    hint: 'Use inspect with selector, text, or regex to drill in. apply_changes verifies its effect.',
  };
}

// ─── Element description ─────────────────────────────────────────────────────
function describe(el) {
  const cs = window.getComputedStyle(el);
  const rect = el.getBoundingClientRect();
  return {
    path: getPath(el),
    tag: el.tagName.toLowerCase(),
    id: el.id || null,
    classes: [...el.classList].slice(0, CONFIG.dom.maxClassesPerElement),
    attrs: pickAttrs(el),
    text: leafText(el),
    rect: {
      x: Math.round(rect.x), y: Math.round(rect.y),
      w: Math.round(rect.width), h: Math.round(rect.height),
      inViewport: rect.bottom > 0 && rect.top < window.innerHeight && rect.right > 0 && rect.left < window.innerWidth,
      rendered: rect.width > 0 && rect.height > 0,
    },
    styles: {
      display: cs.display,
      visibility: cs.visibility,
      opacity: cs.opacity,
      position: cs.position,
      zIndex: cs.zIndex,
      backgroundColor: cs.backgroundColor,
      color: cs.color,
    },
    childrenCount: el.childElementCount,
    outerHTML: truncate(el.outerHTML, CONFIG.dom.outerHTMLLimit),
  };
}

function pickAttrs(el) {
  const out = {};
  for (const a of el.attributes) {
    const n = a.name;
    if (n === 'id' || n === 'class' || n === 'style') continue;
    if (
      n === 'src' || n === 'href' || n === 'onclick' ||
      n === 'role' || n === 'alt' || n === 'title' || n === 'name' || n === 'type' || n === 'value' ||
      n.startsWith('aria-') || n.startsWith('data-')
    ) {
      out[n] = a.value.length > 160 ? a.value.slice(0, 160) + '…' : a.value;
    }
  }
  return out;
}

function leafText(el) {
  if (el.childElementCount !== 0) return null;
  const t = el.textContent?.trim();
  return t ? truncate(t, CONFIG.dom.textSliceLength) : null;
}

function getPath(el) {
  const parts = [];
  let cur = el;
  while (cur && cur.nodeType === 1 && parts.length < 5 && cur !== document.documentElement) {
    let p = cur.tagName.toLowerCase();
    if (cur.id) { p += '#' + cur.id; parts.unshift(p); break; }
    if (cur.classList.length) p += '.' + [...cur.classList].slice(0, 2).join('.');
    parts.unshift(p);
    cur = cur.parentElement;
  }
  return parts.join(' > ');
}

function rectOf(el) {
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
}

function safeHost(src) {
  if (!src) return null;
  try { return new URL(src, location.href).host; } catch { return null; }
}

function truncate(s, n) {
  if (!s) return s;
  return s.length > n ? s.slice(0, n) + '…' : s;
}

function regexHitsAttrs(el, rx) {
  if (el.id && rx.test(el.id)) return true;
  if (el.className && typeof el.className === 'string' && rx.test(el.className)) return true;
  for (const a of el.attributes) {
    if (a.name === 'class' || a.name === 'id') continue;
    if (rx.test(a.value)) return true;
  }
  return false;
}
