import { CONFIG } from '../shared/config.js';
import { MSG, createToolResult } from '../shared/messages.js';
import { appendFeedItem } from './modal/feed.js';
import { switchToQuestionMode } from './modal/question.js';
import { setStatus } from './helpers.js';

export function handleBackgroundMessage(msg, overlay, { applyVibe, execTool, getActivePort }) {
  console.log('[Vibe Content] Message from background:', msg.type);

  switch (msg.type) {
    case MSG.TOOL_EXEC: {
      (async () => {
        let result;
        try {
          result = await execTool(msg.name, msg.input);
        } catch (err) {
          console.error('[Vibe Content] Tool exec error:', err);
          result = { error: err.message };
        }
        try { getActivePort()?.postMessage(createToolResult(msg.execId, result)); } catch { /* port closed */ }
      })();
      break;
    }

    case MSG.FEED_UPDATE:
      appendFeedItem(msg);
      break;

    case MSG.ASK_USER:
      appendFeedItem({ kind: 'question', text: msg.question });
      switchToQuestionMode(msg, getActivePort());
      break;

    case MSG.SESSION_DONE: {
      const { css, js, summary, confidence } = msg;
      applyVibe({ css, js });
      appendFeedItem({ kind: 'done', text: summary, confidence });
      setStatus(document.getElementById('__vibe_status__'), `✓ Done! Confidence: ${confidence}%`, '#2a9d5c');
      setTimeout(() => overlay?.remove(), CONFIG.timeouts.modalAutoClose);
      const goBtn = document.getElementById('__vibe_go__');
      if (goBtn) { goBtn.disabled = false; goBtn.style.opacity = '1'; }
      break;
    }

    case MSG.SESSION_FAILED: {
      appendFeedItem({ kind: 'error', text: msg.reason });
      setStatus(document.getElementById('__vibe_status__'), '✗ ' + msg.reason, '#dc2626');
      const goBtn = document.getElementById('__vibe_go__');
      if (goBtn) { goBtn.disabled = false; goBtn.style.opacity = '1'; goBtn.textContent = 'Make it vibe →'; }
      const inputEl = document.getElementById('__vibe_input__');
      if (inputEl) inputEl.style.display = 'block';
      break;
    }
  }
}
