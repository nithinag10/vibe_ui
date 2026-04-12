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
    // Should start from 'resp2' (index 3)
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
  it('compresses extract_dom results (elements array)', () => {
    const block = {
      type: 'tool_result',
      tool_use_id: 'abc',
      content: JSON.stringify({
        elements: [{ tag: 'div' }, { tag: 'span' }, { tag: 'p' }],
        fingerprint: 'abc123',
      }),
    };
    const result = compressToolResultBlock(block);
    const parsed = JSON.parse(result.content);
    expect(parsed._pruned).toBe('extract_dom');
    expect(parsed.elementCount).toBe(3);
    expect(parsed.fingerprint).toBe('abc123');
    expect(parsed.elements).toBeUndefined();
  });

  it('compresses apply_changes results', () => {
    const block = {
      type: 'tool_result',
      tool_use_id: 'abc',
      content: JSON.stringify({
        success: true,
        matchedSelectors: [
          { selector: '.foo', count: 2 },
          { selector: '.bar', count: 1 },
        ],
      }),
    };
    const result = compressToolResultBlock(block);
    const parsed = JSON.parse(result.content);
    expect(parsed.success).toBe(true);
    expect(parsed.matchedCount).toBe(2);
    expect(parsed.matchedSelectors).toBeUndefined();
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
      content: JSON.stringify({ result: 'dynamic' }),
    };
    expect(compressToolResultBlock(block)).toEqual(block);
  });
});

describe('pruneOldToolResults', () => {
  it('keeps recent turns intact and compresses old tool results', () => {
    const messages = [
      // Turn 1 (old — should be compressed)
      { role: 'user', content: 'request 1' },
      { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'extract_dom', input: {} }] },
      { role: 'user', content: [
        { type: 'tool_result', tool_use_id: 't1', content: JSON.stringify({ elements: [{tag:'div'},{tag:'span'}], fingerprint: 'fp1' }) },
      ]},
      // Turn 2 (old — should be compressed)
      { role: 'assistant', content: [{ type: 'tool_use', id: 't2', name: 'query_selector', input: { selector: '.foo' } }] },
      { role: 'user', content: [
        { type: 'tool_result', tool_use_id: 't2', content: JSON.stringify({ count: 2, elements: [{tag:'div'}] }) },
      ]},
      // Turn 3 (recent — keep MICRO_COMPACT_KEEP=2 means last 2 assistant turns kept)
      { role: 'assistant', content: [{ type: 'tool_use', id: 't3', name: 'apply_changes', input: { css: 'body{}', js: '' } }] },
      { role: 'user', content: [
        { type: 'tool_result', tool_use_id: 't3', content: JSON.stringify({ success: true, matchedSelectors: [{selector:'.x',count:1}] }) },
      ]},
      // Turn 4 (recent — kept intact)
      { role: 'assistant', content: [{ type: 'tool_use', id: 't4', name: 'done', input: {} }] },
      { role: 'user', content: [
        { type: 'tool_result', tool_use_id: 't4', content: JSON.stringify({ summary: 'done' }) },
      ]},
    ];

    const result = pruneOldToolResults(messages);

    // Old turn (index 2): extract_dom should be compressed
    const oldExtract = JSON.parse(result[2].content[0].content);
    expect(oldExtract._pruned).toBe('extract_dom');
    expect(oldExtract.elementCount).toBe(2);

    // Recent turns (last 2 assistant turns = indices 5+) should be intact
    const recentApply = JSON.parse(result[6].content[0].content);
    expect(recentApply.success).toBe(true);
    expect(recentApply.matchedSelectors).toBeDefined();
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
