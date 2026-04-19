import { describe, it, expect } from 'vitest';
import { estimateTokens, getLastNTurns, pruneOldToolResults, compressToolResultBlock } from '../../src/background/compaction.js';

describe('estimateTokens', () => {
  it('estimates token count based on character length', () => {
    const messages = [{ role: 'user', content: 'Hello world' }];
    const result = estimateTokens(messages);
    expect(result).toBeGreaterThan(0);
    expect(typeof result).toBe('number');
  });

  it('returns higher count for longer messages', () => {
    const short = [{ role: 'user', content: 'hi' }];
    const long = [{ role: 'user', content: 'x'.repeat(10000) }];
    expect(estimateTokens(long)).toBeGreaterThan(estimateTokens(short));
  });

  it('treats image blocks as flat-cost, not base64-char-count', () => {
    // 500KB of base64 would look like ~125k tokens under a naive JSON estimator.
    // With the flat image cost we should see far less.
    const bigBase64 = 'A'.repeat(500_000);
    const messages = [{
      role: 'user',
      content: [{
        type: 'tool_result',
        tool_use_id: 'x',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: bigBase64 } },
          { type: 'text', text: 'Viewport capture.' },
        ],
      }],
    }];
    const tokens = estimateTokens(messages);
    // One image ≈ 1600 tokens + a few for the text. Must be well under 10k.
    expect(tokens).toBeGreaterThan(1000);
    expect(tokens).toBeLessThan(5000);
  });

  it('counts nested tool_result text content', () => {
    const messages = [{
      role: 'user',
      content: [{
        type: 'tool_result',
        tool_use_id: 'x',
        content: 'x'.repeat(4000),
      }],
    }];
    expect(estimateTokens(messages)).toBe(1000);
  });
});

describe('getLastNTurns', () => {
  const messages = [
    { role: 'user', content: 'msg1' },
    { role: 'assistant', content: 'resp1' },
    { role: 'user', content: 'msg2' },
    { role: 'assistant', content: 'resp2' },
    { role: 'user', content: 'msg3' },
    { role: 'assistant', content: 'resp3' },
    { role: 'user', content: 'msg4' },
  ];

  it('returns all messages when n >= assistant turns', () => {
    expect(getLastNTurns(messages, 5)).toEqual(messages);
    expect(getLastNTurns(messages, 3)).toEqual(messages);
  });

  it('returns last N turns starting from nth-from-last assistant message', () => {
    const result = getLastNTurns(messages, 2);
    expect(result[0]).toEqual({ role: 'assistant', content: 'resp2' });
    expect(result.length).toBe(4);
  });

  it('returns last 1 turn', () => {
    const result = getLastNTurns(messages, 1);
    expect(result[0]).toEqual({ role: 'assistant', content: 'resp3' });
    expect(result.length).toBe(2);
  });
});

describe('compressToolResultBlock', () => {
  it('compresses inspect (selector/text/regex) results', () => {
    const block = {
      type: 'tool_result',
      tool_use_id: 'abc',
      content: JSON.stringify({
        mode: 'selector',
        query: '.foo',
        total: 3,
        page: 0,
        matches: [{ path: 'div.foo', tag: 'div' }, { path: 'span.foo', tag: 'span' }],
      }),
    };
    const result = compressToolResultBlock(block);
    const parsed = JSON.parse(result.content);
    expect(parsed._pruned).toBe('inspect');
    expect(parsed.mode).toBe('selector');
    expect(parsed.query).toBe('.foo');
    expect(parsed.total).toBe(3);
    expect(parsed.matches).toBeUndefined();
  });

  it('compresses apply_changes results', () => {
    const block = {
      type: 'tool_result',
      tool_use_id: 'abc',
      content: JSON.stringify({
        success: true,
        verified: [
          { selector: '.foo', matched: 2, changed: true },
          { selector: '.bar', matched: 1, changed: false },
        ],
      }),
    };
    const result = compressToolResultBlock(block);
    const parsed = JSON.parse(result.content);
    expect(parsed._pruned).toBe('apply_changes');
    expect(parsed.changedCount).toBe(1);
    expect(parsed.totalSelectors).toBe(2);
  });

  it('compresses multimodal (capture) blocks to text-only reference', () => {
    const block = {
      type: 'tool_result',
      tool_use_id: 'abc',
      content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } },
        { type: 'text', text: 'Screenshot of ".header" (480×200).' },
      ],
    };
    const result = compressToolResultBlock(block);
    const parsed = JSON.parse(result.content);
    expect(parsed._pruned).toBe('capture');
    expect(parsed.note).toContain('Screenshot');
  });

  it('returns block unchanged if content is not parseable JSON', () => {
    const block = { type: 'tool_result', tool_use_id: 'abc', content: 'not json' };
    expect(compressToolResultBlock(block)).toEqual(block);
  });

  it('returns block unchanged if no content', () => {
    const block = { type: 'tool_result', tool_use_id: 'abc' };
    expect(compressToolResultBlock(block)).toEqual(block);
  });

  it('returns block unchanged for unrecognized JSON shapes', () => {
    const block = {
      type: 'tool_result',
      tool_use_id: 'abc',
      content: JSON.stringify({ foo: 'bar' }),
    };
    expect(compressToolResultBlock(block)).toEqual(block);
  });
});

describe('pruneOldToolResults', () => {
  it('keeps recent turns intact and compresses old tool results', () => {
    const messages = [
      // Turn 1 (old — should be compressed)
      { role: 'user', content: 'request 1' },
      { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'inspect', input: {} }] },
      { role: 'user', content: [
        { type: 'tool_result', tool_use_id: 't1', content: JSON.stringify({ mode: 'selector', query: '.a', total: 2, matches: [{tag:'div'},{tag:'span'}] }) },
      ]},
      // Turn 2 (old — should be compressed)
      { role: 'assistant', content: [{ type: 'tool_use', id: 't2', name: 'inspect', input: { selector: '.foo' } }] },
      { role: 'user', content: [
        { type: 'tool_result', tool_use_id: 't2', content: JSON.stringify({ mode: 'selector', query: '.foo', total: 1, matches: [{tag:'div'}] }) },
      ]},
      // Turn 3 (recent — MICRO_COMPACT_KEEP=2 means last 2 assistant turns kept)
      { role: 'assistant', content: [{ type: 'tool_use', id: 't3', name: 'apply_changes', input: { css: 'body{}', js: '' } }] },
      { role: 'user', content: [
        { type: 'tool_result', tool_use_id: 't3', content: JSON.stringify({ success: true, verified: [{selector:'.x',matched:1,changed:true}] }) },
      ]},
      // Turn 4 (recent — kept intact)
      { role: 'assistant', content: [{ type: 'tool_use', id: 't4', name: 'done', input: {} }] },
      { role: 'user', content: [
        { type: 'tool_result', tool_use_id: 't4', content: JSON.stringify({ summary: 'done' }) },
      ]},
    ];

    const result = pruneOldToolResults(messages);

    const oldInspect = JSON.parse(result[2].content[0].content);
    expect(oldInspect._pruned).toBe('inspect');
    expect(oldInspect.total).toBe(2);

    const recentApply = JSON.parse(result[6].content[0].content);
    expect(recentApply.success).toBe(true);
    expect(recentApply.verified).toBeDefined();
  });

  it('handles empty messages array', () => {
    expect(pruneOldToolResults([])).toEqual([]);
  });

  it('handles messages with string content (not tool results)', () => {
    const messages = [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi' },
    ];
    expect(pruneOldToolResults(messages)).toEqual(messages);
  });
});
