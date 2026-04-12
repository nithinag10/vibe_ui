import { MSG } from '../shared/messages.js';
import { startAgentLoop } from './agent-loop.js';
import { resolveToolResult, resolveUserAnswer, cleanup, safePostMessage } from './tool-dispatch.js';
import { createSessionFailed } from '../shared/messages.js';

// ─── Entry point ─────────────────────────────────────────────────────────────
chrome.runtime.onConnect.addListener(handlePortConnect);

// ─── JS execution via scripting API (bypasses page CSP) ──────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type !== MSG.EXEC_JS || !msg.js || !sender.tab?.id) return false;
  chrome.scripting.executeScript({
    target: { tabId: sender.tab.id },
    func: (code) => { try { (0, eval)(code); } catch (e) { console.error('[Vibe] JS execution error:', e); } },
    args: [msg.js],
    world: 'MAIN',
  }).then(() => sendResponse({ ok: true }))
    .catch(e => sendResponse({ ok: false, error: e.message }));
  return true; // keep channel open for async sendResponse
});

function handlePortConnect(port) {
  if (port.name !== 'vibe-session') return;
  console.log('[Vibe BG] Port connected');

  port.onMessage.addListener(async (msg) => {
    console.log('[Vibe BG] Message:', msg.type);

    if (msg.type === MSG.SESSION_START) {
      try {
        await startAgentLoop(msg, port);
      } catch (err) {
        console.error('[Vibe BG] Agent loop error:', err);
        safePostMessage(port, createSessionFailed(err.message));
      }
    }

    if (msg.type === MSG.TOOL_RESULT) {
      resolveToolResult(msg.execId, msg.result);
    }

    if (msg.type === MSG.ASK_USER_ANSWER) {
      resolveUserAnswer(msg.toolUseId, msg.answer);
    }
  });

  port.onDisconnect.addListener(() => {
    console.log('[Vibe BG] Port disconnected — cleaning up pending callbacks');
    cleanup();
  });
}
