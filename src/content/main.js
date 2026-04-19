import { createSessionStart } from '../shared/messages.js';
import { storageGet, sessionKey } from '../shared/storage.js';
import { injectVibeButton } from './button.js';
import { openModal } from './modal/modal.js';
import { appendFeedItem } from './modal/feed.js';
import { handleBackgroundMessage } from './message-handler.js';
import { setStatus } from './helpers.js';
import { execTool } from './tools/registry.js';

(async () => {
  // Don't inject into iframes
  if (window !== window.top) return;

  const pageUrl   = location.href;
  const storageKey = sessionKey(pageUrl);

  // ─── Port (active session channel to background) ───────────────────────────
  let activePort = null;

  // ─── Apply stored vibe on page load ───────────────────────────────────────
  const stored = await storageGet(storageKey);
  if (stored?.css || stored?.js) applyVibe(stored);

  // ─── Inject the floating Vibe button ──────────────────────────────────────
  waitForBody(() => injectVibeButton(() => {
    if (!chrome.runtime?.id) {
      alert('Vibe was reloaded — please refresh the page to use it.');
      return;
    }
    openModal(pageUrl, storageKey, {
      restoreVibe,
      runVibe,
      getActivePort: () => activePort,
      setActivePort: (p) => { activePort = p; },
    });
  }));

  // ─────────────────────────────────────────────────────────────────────────
  function waitForBody(fn) {
    if (document.body) { fn(); return; }
    new MutationObserver((_, obs) => {
      if (document.body) { obs.disconnect(); fn(); }
    }).observe(document.documentElement, { childList: true });
  }

  function applyVibe({ css, js }) {
    if (css) {
      let style = document.getElementById('__vibe_css__');
      if (!style) {
        style = document.createElement('style');
        style.id = '__vibe_css__';
        (document.head || document.documentElement).appendChild(style);
      }
      style.textContent = css;
    }
    if (js) {
      chrome.runtime.sendMessage({ type: 'EXEC_JS', js });
    }
  }

  function restoreVibe({ css, js }) {
    let style = document.getElementById('__vibe_css__');
    if (css) {
      if (!style) {
        style = document.createElement('style');
        style.id = '__vibe_css__';
        (document.head || document.documentElement).appendChild(style);
      }
      style.textContent = css;
    } else if (style) {
      style.remove();
    }

    if (js) {
      chrome.runtime.sendMessage({ type: 'EXEC_JS', js });
    }
  }

  // ─── Core: start the agentic session ─────────────────────────────────────
  function runVibe(overlay, existingSession) {
    const promptText = document.getElementById('__vibe_input__')?.value.trim();
    if (!promptText) return;

    // Switch modal to "running" mode
    const feedEl  = document.getElementById('__vibe_feed__');
    const inputEl = document.getElementById('__vibe_input__');
    const goBtn   = document.getElementById('__vibe_go__');
    const statusEl = document.getElementById('__vibe_status__');
    const hintEl  = inputEl?.nextElementSibling;

    feedEl.style.display  = 'block';
    inputEl.style.display = 'none';
    if (hintEl && hintEl.textContent.includes('⌘')) hintEl.style.display = 'none';
    goBtn.disabled = true;
    goBtn.style.opacity = '0.5';
    goBtn.textContent = '✦ Vibing…';
    setStatus(statusEl, '', '');

    appendFeedItem({ kind: 'thinking', text: 'Starting…' });

    // Open port to background
    activePort = chrome.runtime.connect({ name: 'vibe-session' });

    activePort.onMessage.addListener((msg) => {
      handleBackgroundMessage(msg, overlay, {
        applyVibe,
        execTool,
        getActivePort: () => activePort,
      });
    });

    activePort.onDisconnect.addListener(() => {
      activePort = null;
      const goBtn2 = document.getElementById('__vibe_go__');
      if (goBtn2 && goBtn2.disabled) {
        appendFeedItem({ kind: 'error', text: 'Connection lost' });
        if (goBtn2) { goBtn2.disabled = false; goBtn2.style.opacity = '1'; goBtn2.textContent = 'Make it vibe →'; }
      }
    });

    activePort.postMessage(createSessionStart(promptText, pageUrl, existingSession));
  }
})();
