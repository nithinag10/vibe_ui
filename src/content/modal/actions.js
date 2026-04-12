import { CONFIG } from '../../shared/config.js';
import { storageSet, storageRemove } from '../../shared/storage.js';

/**
 * Wire up all modal event handlers after DOM insertion.
 * Returns a cleanup function (not currently used but available for future needs).
 */
export function wireActions(overlay, existing, storageKey, { restoreVibe, runVibe, getActivePort, setActivePort }) {
  // Close button
  document.getElementById('__vibe_close__')?.addEventListener('click', () => {
    overlay.remove();
    const port = getActivePort();
    if (port) { try { port.disconnect(); } catch { /* already closed */ } setActivePort(null); }
  });

  // Overlay click-to-close
  overlay.onclick = (e) => {
    if (e.target === overlay) {
      overlay.remove();
      const port = getActivePort();
      if (port) { try { port.disconnect(); } catch { /* already closed */ } setActivePort(null); }
    }
  };

  // Input focus/blur
  const input = document.getElementById('__vibe_input__');
  if (input) {
    input.onfocus = () => input.style.borderColor = '';
    input.onblur  = () => input.style.borderColor = '';
  }

  // Undo
  document.getElementById('__vibe_undo__')?.addEventListener('click', async () => {
    try {
      const undoBtn = document.getElementById('__vibe_undo__');
      if (undoBtn) { undoBtn.textContent = 'Undoing…'; undoBtn.disabled = true; }

      if (!existing?.history?.length) {
        restoreVibe({ css: '', js: '' });
        const updated = {
          ...existing,
          css: '',
          js: '',
          history: [],
          applied: (existing.applied || []).slice(0, -1),
        };
        await storageSet({ [storageKey]: updated });
        overlay.remove();
        return;
      }

      const newHistory = [...existing.history];
      const snapshot = newHistory.pop();
      restoreVibe({ css: snapshot.css || '', js: snapshot.js || '' });

      const updated = {
        ...existing,
        css: snapshot.css || '',
        js: snapshot.js || '',
        history: newHistory,
        applied: (existing.applied || []).slice(0, -1),
      };

      await storageSet({ [storageKey]: updated });
      overlay.remove();
    } catch (e) {
      console.error('[Vibe] Undo error:', e);
    }
  });

  // Reset
  document.getElementById('__vibe_reset__')?.addEventListener('click', async () => {
    await storageRemove(storageKey);
    overlay.remove();
    document.getElementById('__vibe_css__')?.remove();
    document.getElementById('__vibe_js__')?.remove();
  });

  // Go button
  document.getElementById('__vibe_go__')?.addEventListener('click', () => runVibe(overlay, existing));

  // Version history toggle
  document.getElementById('__vibe_history_toggle__')?.addEventListener('click', () => {
    const list = document.getElementById('__vibe_history_list__');
    const btn  = document.getElementById('__vibe_history_toggle__');
    if (!list) return;
    const isOpen = list.style.display !== 'none';
    list.style.display = isOpen ? 'none' : 'flex';
    btn.textContent = isOpen ? 'Show' : 'Hide';
  });

  // Revert buttons
  document.querySelectorAll('.__vibe_revert_btn__').forEach(btn => {
    btn.addEventListener('click', async () => {
      const idx = parseInt(btn.dataset.index, 10);
      const snapshot = existing?.history?.[idx];
      if (!snapshot) return;

      btn.textContent = 'Restoring…';
      btn.disabled = true;

      restoreVibe({ css: snapshot.css || '', js: snapshot.js || '' });

      const currentHistory = existing.history ? [...existing.history] : [];
      if (existing.css || existing.js) {
        const lastApplied = existing.applied?.[existing.applied.length - 1];
        currentHistory.push({
          css: existing.css,
          js: existing.js,
          intent: lastApplied?.intent || 'Before revert',
          timestamp: new Date().toISOString(),
        });
        if (currentHistory.length > CONFIG.agent.maxHistorySnapshots) currentHistory.shift();
      }
      currentHistory.splice(idx, 1);

      const updated = {
        ...existing,
        css: snapshot.css,
        js: snapshot.js,
        history: currentHistory,
        applied: [...(existing.applied || []), { intent: `Reverted to: ${snapshot.intent}`, selector: '(revert)', method: 'revert', dynamic: false }],
      };

      await storageSet({ [storageKey]: updated });
      overlay.remove();
    });
  });

  // Keyboard shortcut
  if (input) {
    input.onkeydown = (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        runVibe(overlay, existing);
      }
    };
  }

  setTimeout(() => input?.focus(), 60);
}
