// map_page — one-shot page orientation for the agent.
//
// Runs automatically at session start (agent-loop.js) as a synthetic first
// tool_use, so the model sees a rich structural map before turn 1. Replaces
// the old inspect(overview) synthetic call — returns the same kind of data
// plus framework detection, semantic landmarks with selectors, and the
// largest top-level body children (the sections the user is most likely
// referring to).

export const mapPageTool = {
  definition: {
    name: 'map_page',
    description:
      'Page orientation — framework, semantic landmarks, top-level sections, iframes. ' +
      'Runs automatically at session start; you rarely call it yourself. ' +
      'Use the returned selectors as stable anchors when drilling in with inspect.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },

  execute: async () => runMapPage(),
};

export function runMapPage() {
  const framework = detectFramework();
  const semantics = collectSemantics();
  const topLevel = collectTopLevel();
  const iframes = collectIframes();
  const totalElements = document.querySelectorAll('body *').length;
  const present = Object.entries(semantics).filter(([, v]) => v).map(([k]) => k);
  console.log(
    `[Vibe CS] map_page: framework=${framework} totalElements=${totalElements} ` +
    `semantics=[${present.join(',')}] topLevel=${topLevel.length} iframes=${iframes.length}`
  );
  return {
    _kind: 'map_page',
    url: location.href,
    title: document.title,
    viewport: { w: window.innerWidth, h: window.innerHeight, scrollY: window.scrollY },
    framework,
    semantics,
    topLevel,
    iframes,
    totalElements,
    hint:
      'Use the selectors here as anchors. Call inspect for deeper detail, ' +
      'then confirm_selector before apply_changes. Never guess selectors.',
  };
}

// ─── Framework detection ─────────────────────────────────────────────────────
// Cheap heuristics — a false "plain" is better than a false "react". Used only
// to augment the system prompt with a no-innerHTML guardrail; all other logic
// is framework-agnostic.
export function detectFramework() {
  try {
    if (typeof window === 'undefined') return 'plain';
    if (window.__NEXT_DATA__ || document.getElementById('__next')) return 'next';
    if (window.__REACT_DEVTOOLS_GLOBAL_HOOK__) return 'react';
    if (document.querySelector('[data-reactroot], [data-reactid]')) return 'react';
    if (window.__VUE__ || document.querySelector('[data-v-app]')) return 'vue';
    if (window.angular || document.querySelector('[ng-version]')) return 'angular';
    if (window.Polymer) return 'polymer';
  } catch {
    return 'plain';
  }
  return 'plain';
}

// ─── Semantics: header / nav / main / aside / footer ─────────────────────────
function collectSemantics() {
  const roles = {
    header: ['header', '[role="banner"]'],
    nav:    ['nav', '[role="navigation"]'],
    main:   ['main', '[role="main"]'],
    aside:  ['aside', '[role="complementary"]'],
    footer: ['footer', '[role="contentinfo"]'],
  };
  const out = {};
  for (const [key, sels] of Object.entries(roles)) {
    let el = null;
    for (const s of sels) {
      try {
        el = document.querySelector(s);
        if (el) break;
      } catch {
        // invalid selector — skip this fallback
      }
    }
    out[key] = el ? { selector: stableSelector(el), rect: rectOf(el) } : null;
  }
  return out;
}

// ─── Top-level body children (largest ~12 by area) ───────────────────────────
function collectTopLevel() {
  if (!document.body) return [];
  const kids = [...document.body.children].map(el => {
    const r = el.getBoundingClientRect();
    return {
      tag: el.tagName.toLowerCase(),
      id: el.id || null,
      classes: [...el.classList].slice(0, 4),
      rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      childCount: el.childElementCount,
      area: r.width * r.height,
    };
  });
  kids.sort((a, b) => b.area - a.area);
  return kids.slice(0, 12).map(({ area: _area, ...rest }) => rest);
}

// ─── Iframes (all, annotated) ────────────────────────────────────────────────
function collectIframes() {
  return [...document.querySelectorAll('iframe')].slice(0, 30).map(f => ({
    id: f.id || null,
    src: f.src || null,
    host: safeHost(f.src),
    classes: [...f.classList].slice(0, 4),
    rect: rectOf(f),
  }));
}

// ─── Helpers ────────────────────────────────────────────────────────────────
function stableSelector(el) {
  if (el.id) return `#${el.id}`;
  const tag = el.tagName.toLowerCase();
  if (['header','nav','main','aside','footer'].includes(tag)) return tag;
  const role = el.getAttribute('role');
  if (role) return `[role="${role}"]`;
  const cls = [...el.classList].slice(0, 2);
  return cls.length ? `${tag}.${cls.join('.')}` : tag;
}

function rectOf(el) {
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
}

function safeHost(src) {
  if (!src) return null;
  try { return new URL(src, location.href).host; } catch { return null; }
}
