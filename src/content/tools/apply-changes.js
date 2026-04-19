import { CONFIG } from '../../shared/config.js';

export const applyChangesTool = {
  definition: {
    name: 'apply_changes',
    description:
      'Inject CSS and/or JS, then verify the effect. ' +
      'Returns {verified[], matched[]}: for each CSS selector, reports whether computed styles actually changed for the targeted elements. ' +
      'JS runs once by default. Set persistent:true only if you have observed SPA rerenders removing your change. ' +
      'Always inspect before calling this.',
    input_schema: {
      type: 'object',
      properties: {
        css: { type: 'string', description: 'CSS to inject (use !important when overriding). Empty string if not needed.' },
        js:  { type: 'string', description: 'JavaScript to inject into page context. Empty string if not needed.' },
        persistent: {
          type: 'boolean',
          description: 'Default false. If true, JS re-runs on DOM mutations (throttled). Only use when you have seen an SPA rerender undo a one-shot change — persistent JS on dynamic pages can jank the main thread.',
        },
      },
      required: ['css', 'js'],
    },
  },

  execute: async ({ css, js, persistent }) => {
    const persist = persistent === true;

    // ─── Pre-snapshot for verification ─────────────────────────────────────
    const selectors = css ? extractSelectors(css) : [];
    const preSnap = selectors.map(sel => snapshotSelector(sel));

    // ─── Inject CSS ────────────────────────────────────────────────────────
    if (css) {
      let style = document.getElementById('__vibe_css__');
      if (!style) {
        style = document.createElement('style');
        style.id = '__vibe_css__';
        (document.head || document.documentElement).appendChild(style);
      }
      style.textContent = css;
    }

    // ─── Inject JS (wrapped in persistent observer unless opted out) ──────
    if (js) {
      const code = persist ? wrapPersistent(js) : js;
      await chrome.runtime.sendMessage({ type: 'EXEC_JS', js: code });
    }

    // ─── Wait a frame for styles/JS to apply, then post-snapshot ──────────
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

    const verified = preSnap.map((before, i) => {
      const sel = selectors[i];
      const after = snapshotSelector(sel);
      return {
        selector: sel,
        matched: after.count,
        changed: diffSnapshot(before, after),
        sample: after.sample,
      };
    });

    return {
      success: true,
      css: !!css,
      js: !!js,
      persistent: !!(js && persist),
      verified,
    };
  },
};

// ─── CSS selector extraction ─────────────────────────────────────────────────
function extractSelectors(css) {
  const out = [];
  const rulePattern = /([^{}]+)\{[^}]*\}/g;
  let m;
  while ((m = rulePattern.exec(css)) !== null) {
    const selectorList = m[1].trim();
    if (!selectorList || selectorList.startsWith('@')) continue;
    for (const raw of selectorList.split(',')) {
      const cleaned = raw.trim().replace(/\s*!important/g, '');
      if (cleaned) out.push(cleaned);
    }
  }
  return [...new Set(out)];
}

function snapshotSelector(sel) {
  let els;
  try { els = [...document.querySelectorAll(sel)]; } catch { return { count: 0, sample: null, invalid: true }; }
  const first = els[0];
  return {
    count: els.length,
    sample: first ? relevantStyles(first) : null,
  };
}

function relevantStyles(el) {
  const cs = window.getComputedStyle(el);
  const r = el.getBoundingClientRect();
  return {
    display: cs.display,
    visibility: cs.visibility,
    opacity: cs.opacity,
    color: cs.color,
    backgroundColor: cs.backgroundColor,
    fontSize: cs.fontSize,
    height: Math.round(r.height),
    width: Math.round(r.width),
  };
}

function diffSnapshot(before, after) {
  if (!before?.sample || !after?.sample) return before?.count !== after?.count;
  const keys = Object.keys(after.sample);
  return keys.some(k => before.sample[k] !== after.sample[k]) || before.count !== after.count;
}

// ─── Persistent JS wrapper ───────────────────────────────────────────────────
// Re-runs user JS on DOM mutations (throttled). Includes a runaway guard: if the
// observer fires faster than ~5 Hz sustained over 10 s, we assume the user JS is
// causing the mutations it's reacting to and give up. This prevents the worst
// foot-gun — a persistent rule that jam-packs the main thread on dynamic pages.
function wrapPersistent(userJs) {
  const throttleMs = CONFIG.apply?.persistentThrottleMs ?? 300;
  return `
(() => {
  const TAG = '__vibe_persist__';
  const prev = window[TAG];
  if (prev && prev.disconnect) { try { prev.disconnect(); } catch {} }
  let last = 0, pending = false, runs = 0, windowStart = Date.now();
  const run = () => {
    last = Date.now();
    pending = false;
    runs++;
    if (Date.now() - windowStart > 10_000) { runs = 1; windowStart = Date.now(); }
    if (runs > 50) {
      console.warn('[Vibe persist] runaway detected, disconnecting');
      try { window[TAG]?.disconnect(); } catch {}
      return;
    }
    try { ${userJs} } catch (e) { console.error('[Vibe persist]', e); }
  };
  const schedule = () => {
    if (pending) return;
    const since = Date.now() - last;
    const wait = Math.max(0, ${throttleMs} - since);
    pending = true;
    setTimeout(run, wait);
  };
  run();
  const obs = new MutationObserver(schedule);
  obs.observe(document.body || document.documentElement, { childList: true, subtree: true });
  window[TAG] = obs;
})();
`;
}
