import { CONFIG } from '../shared/config.js';
import { createToolExec, createAskUser } from '../shared/messages.js';

// ─── Pending operation maps ──────────────────────────────────────────────────
const pendingToolExecs   = new Map(); // execId    → { resolve, reject }
const pendingUserAnswers = new Map(); // toolUseId → { resolve, reject }

// ─── Safe port post ──────────────────────────────────────────────────────────
export function safePostMessage(port, msg) {
  try {
    port.postMessage(msg);
  } catch (e) {
    console.warn('[Vibe BG] Could not post message (port closed):', e.message);
  }
}

// ─── DOM tool RPC (dispatches to content.js) ─────────────────────────────────
export function dispatchToolExec(name, input, port) {
  const execId = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    pendingToolExecs.set(execId, { resolve, reject });
    safePostMessage(port, createToolExec(execId, name, input));
    const timeout = name === 'check_dynamic' ? CONFIG.timeouts.toolExecCheckDynamic : CONFIG.timeouts.toolExecDefault;
    setTimeout(() => {
      if (pendingToolExecs.has(execId)) {
        pendingToolExecs.delete(execId);
        reject(new Error(`Tool exec timed out: ${name}`));
      }
    }, timeout);
  });
}

// ─── ask_user — pauses loop until user answers ──────────────────────────────
export function toolAskUser(toolUseId, question, options, port) {
  return new Promise((resolve, reject) => {
    pendingUserAnswers.set(toolUseId, { resolve, reject });
    safePostMessage(port, createAskUser(toolUseId, question, options));
    setTimeout(() => {
      if (pendingUserAnswers.has(toolUseId)) {
        pendingUserAnswers.delete(toolUseId);
        reject(new Error('ask_user timed out — no response from user'));
      }
    }, CONFIG.timeouts.askUser);
  });
}

// ─── Resolve pending operations from content.js replies ──────────────────────
export function resolveToolResult(execId, result) {
  const pending = pendingToolExecs.get(execId);
  if (pending) {
    pendingToolExecs.delete(execId);
    pending.resolve(result);
  }
}

export function resolveUserAnswer(toolUseId, answer) {
  const pending = pendingUserAnswers.get(toolUseId);
  if (pending) {
    pendingUserAnswers.delete(toolUseId);
    pending.resolve(answer);
  }
}

// ─── Cleanup on port disconnect ──────────────────────────────────────────────
export function cleanup() {
  for (const [, { reject }] of pendingToolExecs) reject(new Error('Port disconnected'));
  for (const [, { reject }] of pendingUserAnswers) reject(new Error('Port disconnected'));
  pendingToolExecs.clear();
  pendingUserAnswers.clear();
}
