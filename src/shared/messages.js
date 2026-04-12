// ─── Message type constants ─────────────────────────────────────────────────
// Single source of truth for the content ↔ background message protocol.

export const MSG = Object.freeze({
  SESSION_START:    'SESSION_START',
  SESSION_DONE:     'SESSION_DONE',
  SESSION_FAILED:   'SESSION_FAILED',
  TOOL_EXEC:        'TOOL_EXEC',
  TOOL_RESULT:      'TOOL_RESULT',
  ASK_USER:         'ASK_USER',
  ASK_USER_ANSWER:  'ASK_USER_ANSWER',
  FEED_UPDATE:      'FEED_UPDATE',
  EXEC_JS:          'EXEC_JS',
});

// ─── Factory functions ──────────────────────────────────────────────────────
// Each factory documents the message shape — living protocol documentation.

/** Content → Background: start a new agentic session */
export function createSessionStart(prompt, url, session) {
  return { type: MSG.SESSION_START, prompt, url, session };
}

/** Background → Content: session completed successfully */
export function createSessionDone(summary, confidence, css, js) {
  return { type: MSG.SESSION_DONE, summary, confidence, css, js };
}

/** Background → Content: session failed */
export function createSessionFailed(reason) {
  return { type: MSG.SESSION_FAILED, reason };
}

/** Background → Content: execute a tool in page context */
export function createToolExec(execId, name, input) {
  return { type: MSG.TOOL_EXEC, execId, name, input };
}

/** Content → Background: return tool execution result */
export function createToolResult(execId, result) {
  return { type: MSG.TOOL_RESULT, execId, result };
}

/** Background → Content: ask the user a clarifying question */
export function createAskUser(toolUseId, question, options) {
  return { type: MSG.ASK_USER, toolUseId, question, options };
}

/** Content → Background: user's answer to a clarifying question */
export function createAskUserAnswer(toolUseId, answer) {
  return { type: MSG.ASK_USER_ANSWER, toolUseId, answer };
}

/** Background → Content: update the live feed display */
export function createFeedUpdate(kind, data) {
  return { type: MSG.FEED_UPDATE, kind, ...data };
}
