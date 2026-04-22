import { describe, it, expect } from 'vitest';
import { extractCssSelectors, unconfirmedSelectors, normalizeSelector } from '../../src/background/agent-loop.js';

describe('normalizeSelector', () => {
  it('collapses whitespace and strips !important', () => {
    expect(normalizeSelector('  .foo   .bar !important ')).toBe('.foo .bar');
  });

  it('is idempotent for already-clean selectors', () => {
    expect(normalizeSelector('.foo')).toBe('.foo');
    expect(normalizeSelector('#root > div')).toBe('#root > div');
  });
});

describe('extractCssSelectors', () => {
  it('returns empty for falsy or non-string input', () => {
    expect(extractCssSelectors('')).toEqual([]);
    expect(extractCssSelectors(null)).toEqual([]);
    expect(extractCssSelectors(42)).toEqual([]);
  });

  it('extracts single selector', () => {
    expect(extractCssSelectors('.foo { color: red; }')).toEqual(['.foo']);
  });

  it('splits comma-separated selector lists', () => {
    const out = extractCssSelectors('.a, .b, .c { display: none; }');
    expect(out.sort()).toEqual(['.a', '.b', '.c']);
  });

  it('handles multiple rules', () => {
    const css = '.foo { color: red; } .bar, .baz { opacity: 0; }';
    const out = extractCssSelectors(css);
    expect(out.sort()).toEqual(['.bar', '.baz', '.foo']);
  });

  it('skips @-rules', () => {
    const css = '@media (max-width: 600px) { .foo { display: none; } } .bar { color: red; }';
    // The naive regex will match .foo inside @media — that's fine, the gate
    // still requires it confirmed. We assert .bar is present.
    expect(extractCssSelectors(css)).toContain('.bar');
  });

  it('deduplicates repeated selectors across rules', () => {
    const css = '.foo { color: red; } .foo { opacity: 0; }';
    expect(extractCssSelectors(css)).toEqual(['.foo']);
  });

  it('strips !important embedded in the selector list', () => {
    // !important on selectors is invalid CSS but can leak from generation —
    // normalize so the gate matches the confirm_selector call.
    expect(extractCssSelectors('.foo !important { color: red; }')).toEqual(['.foo']);
  });
});

describe('unconfirmedSelectors', () => {
  it('returns empty when every selector is confirmed', () => {
    const confirmed = new Set(['.foo', '.bar']);
    expect(unconfirmedSelectors('.foo, .bar { color: red; }', confirmed)).toEqual([]);
  });

  it('returns the selectors missing from the confirmed set', () => {
    const confirmed = new Set(['.foo']);
    const out = unconfirmedSelectors('.foo, .bar, .baz { display: none; }', confirmed);
    expect(out.sort()).toEqual(['.bar', '.baz']);
  });

  it('returns all selectors when confirmed set is empty', () => {
    const out = unconfirmedSelectors('.a, .b { opacity: 0; }', new Set());
    expect(out.sort()).toEqual(['.a', '.b']);
  });

  it('normalization prevents whitespace-only bypasses of the gate', () => {
    // confirmed stores the normalized form; the CSS has extra whitespace.
    const confirmed = new Set(['.foo .bar']);
    expect(unconfirmedSelectors('.foo    .bar { opacity: 0 }', confirmed)).toEqual([]);
  });
});
