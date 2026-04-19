import { describe, it, expect } from 'vitest';
import {
  MSG,
  createSessionStart,
  createSessionDone,
  createSessionFailed,
  createToolExec,
  createToolResult,
  createAskUser,
  createAskUserAnswer,
  createFeedUpdate,
} from '../../src/shared/messages.js';

describe('MSG constants', () => {
  it('has all message types', () => {
    expect(MSG.SESSION_START).toBe('SESSION_START');
    expect(MSG.SESSION_DONE).toBe('SESSION_DONE');
    expect(MSG.SESSION_FAILED).toBe('SESSION_FAILED');
    expect(MSG.TOOL_EXEC).toBe('TOOL_EXEC');
    expect(MSG.TOOL_RESULT).toBe('TOOL_RESULT');
    expect(MSG.ASK_USER).toBe('ASK_USER');
    expect(MSG.ASK_USER_ANSWER).toBe('ASK_USER_ANSWER');
    expect(MSG.FEED_UPDATE).toBe('FEED_UPDATE');
    expect(MSG.EXEC_JS).toBe('EXEC_JS');
    expect(MSG.CAPTURE_TAB).toBe('CAPTURE_TAB');
  });

  it('is frozen', () => {
    expect(Object.isFrozen(MSG)).toBe(true);
  });
});

describe('message factories', () => {
  it('createSessionStart', () => {
    const msg = createSessionStart('hide sidebar', 'https://example.com', null);
    expect(msg).toEqual({
      type: 'SESSION_START',
      prompt: 'hide sidebar',
      url: 'https://example.com',
      session: null,
    });
  });

  it('createSessionDone', () => {
    const msg = createSessionDone('Hidden sidebar', 85, 'body { color: red; }', '');
    expect(msg).toEqual({
      type: 'SESSION_DONE',
      summary: 'Hidden sidebar',
      confidence: 85,
      css: 'body { color: red; }',
      js: '',
    });
  });

  it('createSessionFailed', () => {
    const msg = createSessionFailed('No API key');
    expect(msg).toEqual({
      type: 'SESSION_FAILED',
      reason: 'No API key',
    });
  });

  it('createToolExec', () => {
    const msg = createToolExec('abc-123', 'inspect', {});
    expect(msg).toEqual({
      type: 'TOOL_EXEC',
      execId: 'abc-123',
      name: 'inspect',
      input: {},
    });
  });

  it('createToolResult', () => {
    const msg = createToolResult('abc-123', { count: 5 });
    expect(msg).toEqual({
      type: 'TOOL_RESULT',
      execId: 'abc-123',
      result: { count: 5 },
    });
  });

  it('createAskUser', () => {
    const msg = createAskUser('tool-1', 'Which sidebar?', ['left', 'right']);
    expect(msg).toEqual({
      type: 'ASK_USER',
      toolUseId: 'tool-1',
      question: 'Which sidebar?',
      options: ['left', 'right'],
    });
  });

  it('createAskUserAnswer', () => {
    const msg = createAskUserAnswer('tool-1', 'left');
    expect(msg).toEqual({
      type: 'ASK_USER_ANSWER',
      toolUseId: 'tool-1',
      answer: 'left',
    });
  });

  it('createFeedUpdate', () => {
    const msg = createFeedUpdate('thinking', { text: 'Turn 1…' });
    expect(msg).toEqual({
      type: 'FEED_UPDATE',
      kind: 'thinking',
      text: 'Turn 1…',
    });
  });

  it('createFeedUpdate with tool kind', () => {
    const msg = createFeedUpdate('tool', { tool: 'inspect' });
    expect(msg).toEqual({
      type: 'FEED_UPDATE',
      kind: 'tool',
      tool: 'inspect',
    });
  });
});
