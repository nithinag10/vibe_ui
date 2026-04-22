import { CONFIG } from '../../shared/config.js';

// confirm_selector — the gate before apply_changes.
//
// The agent harness (background/agent-loop.js) refuses apply_changes for any
// CSS selector that hasn't been confirmed with verdict === 'good' in this
// session. This tool is the only way to clear that gate.
//
// verdicts:
//   'empty'     → 0 matches. Selector is wrong.
//   'good'      → 1..tooBroadAt-1 matches. Safe to use.
//   'too-broad' → tooBroadAt+ matches. Likely to nuke unrelated elements.

export const confirmSelectorTool = {
  definition: {
    name: 'confirm_selector',
    description:
      'Confirm that a CSS selector matches real, sensible elements. Returns {verdict, matchCount, elements[], snapshot[]}. ' +
      'Required before apply_changes — the harness blocks any CSS rule whose selector has not been confirmed "good" this session. ' +
      'Verdict: "empty" (0 matches), "good" (safe), "too-broad" (too many matches — narrow it).',
    input_schema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'The CSS selector to confirm' },
      },
      required: ['selector'],
    },
  },

  execute: async ({ selector }) => runConfirm(selector),
};

export function runConfirm(selector) {
  if (!selector || typeof selector !== 'string') {
    return { _kind: 'confirm_selector', selector: String(selector || ''), verdict: 'empty', matchCount: 0, error: 'Selector is required' };
  }
  let all;
  try {
    all = [...document.querySelectorAll(selector)];
  } catch (e) {
    return { _kind: 'confirm_selector', selector, verdict: 'empty', matchCount: 0, error: `Invalid selector: ${e.message}` };
  }

  const matchCount = all.length;
  const tooBroadAt = CONFIG.confirm?.tooBroadAt ?? 21;
  const verdict = matchCount === 0 ? 'empty' : matchCount >= tooBroadAt ? 'too-broad' : 'good';

  const sampleSize = CONFIG.confirm?.sampleSize ?? 5;
  const elements = all.slice(0, sampleSize).map(describe);
  const snapshot = all.slice(0, sampleSize).map(snapshotOne);

  const hints = [];
  if (verdict === 'empty') hints.push('No matches. The selector does not apply to any current element. Inspect with text or regex to find the target, or try an attribute-based selector.');
  if (verdict === 'too-broad') hints.push(`${matchCount} matches is likely too broad — apply_changes will affect all of them. Narrow by combining with an ancestor selector, or use attributes (data-*, aria-*, role) or an [id^=""] pattern.`);

  console.log(`[Vibe CS] confirm_selector("${selector}") → verdict=${verdict} matchCount=${matchCount}`);

  return {
    _kind: 'confirm_selector',
    selector,
    matchCount,
    verdict,
    elements,
    snapshot,
    ...(hints.length ? { hints } : {}),
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────────
function describe(el) {
  const cs = window.getComputedStyle(el);
  const rect = el.getBoundingClientRect();
  return {
    path: getPath(el),
    tag: el.tagName.toLowerCase(),
    id: el.id || null,
    classes: [...el.classList].slice(0, CONFIG.dom.maxClassesPerElement),
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
    },
    text: leafText(el),
    outerHTML: truncate(el.outerHTML, CONFIG.dom.outerHTMLLimit),
  };
}

function snapshotOne(el) {
  return {
    path: getPath(el),
    outerHTML: truncate(el.outerHTML, CONFIG.dom.outerHTMLLimit),
    inlineStyle: el.getAttribute('style') || '',
  };
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

function leafText(el) {
  if (el.childElementCount !== 0) return null;
  const t = el.textContent?.trim();
  return t ? truncate(t, CONFIG.dom.textSliceLength) : null;
}

function truncate(s, n) {
  if (!s) return s;
  return s.length > n ? s.slice(0, n) + '…' : s;
}
