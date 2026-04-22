// @vitest-environment jsdom
//
// DOM smoke: load sample.html (a real Hindustan Times article dump) into jsdom
// and run our DOM-facing tools against it. This exercises the actual reads
// done at runtime — framework detection, semantic landmarks, iframe collection,
// selector confirmation, layout-property sniffing — on something closer to a
// real page than handwritten fixtures.

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Strip <script> blocks so jsdom doesn't try to execute the page's analytics,
// ads, and polyfill loaders — those reach for browser APIs jsdom doesn't
// implement (matchMedia, etc.) and produce noise. DOM structure is preserved.
const SAMPLE = readFileSync(resolve(__dirname, '../../sample.html'), 'utf8')
  .replace(/<script[\s\S]*?<\/script>/gi, '');

beforeAll(() => {
  // Our tools import `chrome.*` APIs at module scope in a couple of spots.
  // Stub just enough to let the imports succeed.
  globalThis.chrome = {
    runtime: {
      sendMessage: async () => ({ ok: false, error: 'stubbed' }),
    },
    storage: { local: { get: (_k, cb) => cb({}) } },
  };
  // jsdom gives us document/window — drop sample.html in.
  document.open();
  document.write(SAMPLE);
  document.close();
});

describe('map_page on sample.html', () => {
  it('returns a full page map with framework, semantics, top-level sections, and iframes', async () => {
    const { runMapPage, detectFramework } = await import('../../src/content/tools/map-page.js');
    const map = runMapPage();

    // Structure: every field expected by the agent harness must exist.
    expect(map._kind).toBe('map_page');
    expect(map.url).toBeDefined();
    expect(map.title).toBeDefined();
    expect(map.viewport).toHaveProperty('w');
    expect(map.viewport).toHaveProperty('h');
    expect(map.framework).toBe(detectFramework());
    expect(map.semantics).toHaveProperty('header');
    expect(map.semantics).toHaveProperty('nav');
    expect(map.semantics).toHaveProperty('main');
    expect(map.semantics).toHaveProperty('footer');
    expect(Array.isArray(map.topLevel)).toBe(true);
    expect(Array.isArray(map.iframes)).toBe(true);
    expect(typeof map.totalElements).toBe('number');
    expect(map.totalElements).toBeGreaterThan(100); // real article, not empty

    // Visible snapshot for the human reading the test log.
    console.log('[smoke] map_page framework   :', map.framework);
    console.log('[smoke] map_page totalElements:', map.totalElements);
    console.log('[smoke] map_page semantics   :', JSON.stringify(map.semantics, null, 2));
    console.log('[smoke] map_page topLevel[0..4]:');
    for (const s of map.topLevel.slice(0, 5)) console.log('  ', JSON.stringify(s));
    console.log(`[smoke] map_page iframes     : ${map.iframes.length}`);
    for (const f of map.iframes.slice(0, 5)) console.log('  ', JSON.stringify(f));
  });

  it('detectFramework returns "plain" on this static HTML (no React/Vue/etc)', async () => {
    const { detectFramework } = await import('../../src/content/tools/map-page.js');
    // sample.html is a server-rendered article — no React root, no Next marker.
    expect(detectFramework()).toBe('plain');
  });
});

describe('confirm_selector on sample.html', () => {
  it('returns "good" verdict for a selector that matches a reasonable number of elements', async () => {
    const { runConfirm } = await import('../../src/content/tools/confirm-selector.js');

    // Find any class that actually exists in the document to guarantee the
    // test is signal-bearing even if markup details shift over time.
    const probe = document.querySelector('[class]');
    if (!probe) throw new Error('sample.html has no classed elements');
    const firstClass = probe.classList[0];
    const result = runConfirm(`.${firstClass}`);

    expect(result._kind).toBe('confirm_selector');
    expect(result.selector).toBe(`.${firstClass}`);
    expect(result.matchCount).toBeGreaterThan(0);
    expect(['good', 'too-broad']).toContain(result.verdict);
    expect(Array.isArray(result.elements)).toBe(true);
    expect(Array.isArray(result.snapshot)).toBe(true);

    console.log(`[smoke] confirm_selector(.${firstClass}) → verdict=${result.verdict} matchCount=${result.matchCount}`);
    if (result.elements[0]) console.log('  sample:', JSON.stringify({
      path: result.elements[0].path,
      tag: result.elements[0].tag,
      id: result.elements[0].id,
      rect: result.elements[0].rect,
    }));
  });

  it('returns "empty" verdict for a selector that matches nothing', async () => {
    const { runConfirm } = await import('../../src/content/tools/confirm-selector.js');
    const result = runConfirm('.definitely-not-real-class-xyz-12345');
    expect(result.verdict).toBe('empty');
    expect(result.matchCount).toBe(0);
  });

  it('returns "empty" with an error for invalid CSS syntax', async () => {
    const { runConfirm } = await import('../../src/content/tools/confirm-selector.js');
    const result = runConfirm(':::not-a-selector');
    expect(result.verdict).toBe('empty');
    expect(result.error).toMatch(/Invalid selector/);
  });

  it('targets the actual ad wrappers in this article (real-world scenario)', async () => {
    const { runConfirm } = await import('../../src/content/tools/confirm-selector.js');
    // The user's real use case: hide ad containers. We probe a few common
    // patterns the article uses and report whatever lands.
    const probes = [
      'iframe[src*="googleads"]',
      'iframe[src*="doubleclick"]',
      '[id*="google_ads"]',
      '[class*="ad"]',
      '.adHeight270',
    ];
    console.log('[smoke] ad-probe confirm_selector verdicts:');
    for (const sel of probes) {
      const r = runConfirm(sel);
      console.log(`  ${sel.padEnd(35)} → ${r.verdict.padEnd(9)} matchCount=${r.matchCount}`);
      expect(['empty', 'good', 'too-broad']).toContain(r.verdict);
    }
  });
});

describe('cssTouchesLayout heuristic', () => {
  it('triggers on visibility/layout properties (auto-capture in apply_changes)', async () => {
    const { cssTouchesLayout } = await import('../../src/content/tools/apply-changes.js');
    expect(cssTouchesLayout('.foo { display: none; }')).toBe(true);
    expect(cssTouchesLayout('.foo { visibility: hidden; }')).toBe(true);
    expect(cssTouchesLayout('.foo { opacity: 0; }')).toBe(true);
    expect(cssTouchesLayout('.foo { position: absolute; top: 0; }')).toBe(true);
    expect(cssTouchesLayout('.foo { transform: translateY(-100%); }')).toBe(true);
    expect(cssTouchesLayout('.foo { width: 0; height: 0; }')).toBe(true);
    expect(cssTouchesLayout('.foo { z-index: -1; }')).toBe(true);
  });

  it('does NOT trigger on color/font/spacing (cheap style-diff only)', async () => {
    const { cssTouchesLayout } = await import('../../src/content/tools/apply-changes.js');
    expect(cssTouchesLayout('.foo { color: red; }')).toBe(false);
    expect(cssTouchesLayout('.foo { background-color: blue; }')).toBe(false);
    expect(cssTouchesLayout('.foo { font-size: 20px; font-weight: bold; }')).toBe(false);
    expect(cssTouchesLayout('.foo { margin: 10px; padding: 5px; }')).toBe(false);
    expect(cssTouchesLayout('')).toBe(false);
  });

  it('is not fooled by substrings inside property values', async () => {
    const { cssTouchesLayout } = await import('../../src/content/tools/apply-changes.js');
    // "display" appears inside a comment-like value, not as a property name.
    expect(cssTouchesLayout('.foo { color: /* display hint */ red; }')).toBe(false);
  });
});
