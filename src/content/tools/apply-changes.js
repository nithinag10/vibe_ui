import { CONFIG } from '../../shared/config.js';
import { MSG } from '../../shared/messages.js';

export const applyChangesTool = {
  definition: {
    name: 'apply_changes',
    description:
      'Inject CSS and/or JS, then verify the effect. ' +
      'Returns {verified[], screenshots?, consoleErrors?}. For each CSS selector, reports whether computed styles actually changed. ' +
      'For visibility/layout changes (display, visibility, opacity, position, transform, size, z-index, overflow), before/after/parent screenshots are captured automatically — inspect them visually before calling done. ' +
      'Force visual verify with verify:"visual". JS runs once by default; set persistent:true only if you have observed SPA rerenders removing your change. ' +
      'confirm_selector must have been called with verdict="good" for every selector in css first — otherwise this tool is refused by the harness.',
    input_schema: {
      type: 'object',
      properties: {
        css: { type: 'string', description: 'CSS to inject (use !important when overriding). Empty string if not needed.' },
        js:  { type: 'string', description: 'JavaScript to inject into page context. Empty string if not needed.' },
        persistent: {
          type: 'boolean',
          description: 'Default false. If true, JS re-runs on DOM mutations (throttled). Only use when you have seen an SPA rerender undo a one-shot change.',
        },
        verify: {
          type: 'string',
          enum: ['style', 'visual'],
          description: 'Default: auto ("visual" when CSS touches visibility/layout, else "style"). Force "visual" for high-stakes changes; forces before/after/parent screenshots regardless of CSS content.',
        },
      },
      required: ['css', 'js'],
    },
  },

  execute: async ({ css, js, persistent, verify }) => {
    const persist = persistent === true;

    // ─── Pre-snapshot for verification ─────────────────────────────────────
    const selectors = css ? extractSelectors(css) : [];
    const preSnap = selectors.map(sel => snapshotSelector(sel));

    // Decide visual verification up front so we can capture BEFORE injection.
    const wantVisual = verify === 'visual' || (css && cssTouchesLayout(css));
    const firstSelector = selectors.find(s => {
      try { return document.querySelector(s); } catch { return false; }
    });
    const errors = startConsoleErrorCapture();

    console.log(
      `[Vibe CS] apply_changes visual=${wantVisual} reason=${verify === 'visual' ? 'forced' : wantVisual ? 'layout-css' : 'style-only'} ` +
      `selectors=${selectors.length} firstSelector="${firstSelector || '(none)'}"`
    );

    let beforeShot = null;
    let parentShot = null;
    if (wantVisual && firstSelector) {
      beforeShot = await captureSelector(firstSelector);
      parentShot = await captureSelector(parentSelectorOf(firstSelector)) || null;
      console.log(`[Vibe CS] apply_changes pre-capture: before=${!!beforeShot?.base64} parent=${!!parentShot?.base64}`);
    }

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

    let afterShot = null;
    if (wantVisual && firstSelector) {
      afterShot = await captureSelector(firstSelector);
    }

    const consoleErrors = errors.stop();

    // Return multimodal content so the model actually sees the screenshots as
    // images (not base64 strings in JSON). Fall back to text-only JSON when
    // no screenshots were captured.
    if (wantVisual && (beforeShot || afterShot)) {
      return buildVisualResult({
        verified, persistent: !!(js && persist), beforeShot, afterShot, parentShot,
        firstSelector, consoleErrors, css: !!css, js: !!js,
      });
    }

    return {
      success: true,
      css: !!css,
      js: !!js,
      persistent: !!(js && persist),
      verified,
      consoleErrors,
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

// ─── Auto-visual verify ─────────────────────────────────────────────────────
// Rules that touch visibility/layout need pixels — computed-style diff alone
// can't tell you that you hid a parent instead of the child, or that another
// element now overlaps the target. For color/font/spacing this is overkill.
export function cssTouchesLayout(css) {
  if (!css || typeof css !== 'string') return false;
  const props = CONFIG.autoCaptureProps || [];
  return props.some(p => new RegExp(`(^|[;{\\s])${escapeRe(p)}\\s*:`, 'i').test(css));
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function captureSelector(selector) {
  if (!selector) return null;
  let el;
  try { el = document.querySelector(selector); } catch { return null; }
  if (!el) return null;
  try {
    el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
    await new Promise(r => setTimeout(r, 80));
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return { selector, note: 'zero-sized element (likely display:none — showing viewport instead)' };

    const response = await chrome.runtime.sendMessage({ type: MSG.CAPTURE_TAB });
    if (!response?.ok) return null;

    const dpr = window.devicePixelRatio || 1;
    const cropped = await cropImage(response.dataUrl, { x: r.x, y: r.y, w: r.width, h: r.height }, dpr);
    return { selector, ...cropped };
  } catch {
    return null;
  }
}

function parentSelectorOf(sel) {
  // Parent of a CSS selector (best-effort). We only need a visual for
  // regression — a generic parent is fine. Strip the last compound selector.
  const trimmed = String(sel).trim();
  const parts = trimmed.split(/\s*>\s*|\s+/);
  if (parts.length <= 1) return 'body';
  return parts.slice(0, -1).join(' ');
}

function startConsoleErrorCapture() {
  const errors = [];
  const original = console.error;
  try {
    console.error = function (...args) {
      try {
        errors.push(args.map(a => typeof a === 'string' ? a : safeStringify(a)).join(' ').slice(0, 300));
      } catch {
        // swallow — logging failures must never break the caller
      }
      return original.apply(this, args);
    };
  } catch {
    // if we can't patch console.error, fall back to no capture
  }
  return {
    stop() {
      try { console.error = original; } catch { /* noop */ }
      return errors.slice(0, 10);
    },
  };
}

function safeStringify(v) {
  try { return JSON.stringify(v); } catch { return String(v); }
}

function buildVisualResult({ verified, persistent, beforeShot, afterShot, parentShot, firstSelector, consoleErrors, css, js }) {
  const summary = {
    success: true,
    css,
    js,
    persistent,
    verified,
    consoleErrors,
    visual: {
      selector: firstSelector,
      haveBefore: !!beforeShot?.base64,
      haveAfter: !!afterShot?.base64,
      haveParent: !!parentShot?.base64,
    },
  };

  const content = [];
  content.push({ type: 'text', text: `apply_changes result: ${JSON.stringify(summary)}` });
  if (beforeShot?.base64) {
    content.push({ type: 'text', text: `Before (selector: ${firstSelector}):` });
    content.push({ type: 'image', source: { type: 'base64', media_type: beforeShot.mediaType, data: beforeShot.base64 } });
  }
  if (afterShot?.base64) {
    content.push({ type: 'text', text: 'After:' });
    content.push({ type: 'image', source: { type: 'base64', media_type: afterShot.mediaType, data: afterShot.base64 } });
  }
  if (parentShot?.base64) {
    content.push({ type: 'text', text: 'Parent (regression check):' });
    content.push({ type: 'image', source: { type: 'base64', media_type: parentShot.mediaType, data: parentShot.base64 } });
  }
  return { _multimodal: true, content };
}

async function cropImage(dataUrl, rect, dpr) {
  const img = await loadImage(dataUrl);
  const sx = Math.max(0, Math.floor(rect.x * dpr));
  const sy = Math.max(0, Math.floor(rect.y * dpr));
  const sw = Math.min(img.width - sx, Math.ceil(rect.w * dpr));
  const sh = Math.min(img.height - sy, Math.ceil(rect.h * dpr));
  const max = CONFIG.capture.maxEdge;
  const scale = Math.min(1, max / Math.max(sw, sh));
  const dw = Math.max(1, Math.round(sw * scale));
  const dh = Math.max(1, Math.round(sh * scale));
  const canvas = document.createElement('canvas');
  canvas.width = dw;
  canvas.height = dh;
  canvas.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, dw, dh);
  const out = canvas.toDataURL('image/png');
  const i = out.indexOf(',');
  const base64 = i >= 0 ? out.slice(i + 1) : out;
  return { base64, mediaType: 'image/png', width: dw, height: dh };
}

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = dataUrl;
  });
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
