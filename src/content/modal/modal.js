import { storageGet } from '../../shared/storage.js';
import {
  renderAppliedList,
  renderHistorySection,
  renderQuestionPanel,
  renderPromptArea,
  renderActionButtons,
  renderModalShell,
} from './templates.js';
import { wireActions } from './actions.js';

/**
 * Open the Vibe modal. Orchestrates template rendering and event wiring.
 */
export async function openModal(pageUrl, storageKey, { restoreVibe, runVibe, getActivePort, setActivePort }) {
  try {
    if (document.getElementById('__vibe_overlay__')) return;

    const existing = await storageGet(storageKey);
    const hasVibe  = !!(existing?.css || existing?.js);
    const shortUrl = pageUrl.replace(/^https?:\/\/(www\.)?/, '').slice(0, 60);

    // Build inner content from template functions
    const innerContent = [
      renderAppliedList(existing?.applied),
      renderHistorySection(existing?.history),
      renderQuestionPanel(),
      renderPromptArea(shortUrl, pageUrl.length),
      renderActionButtons(hasVibe),
    ].join('');

    // Create overlay
    const overlay = document.createElement('div');
    overlay.id = '__vibe_overlay__';
    overlay.innerHTML = renderModalShell(shortUrl, pageUrl.length, innerContent);

    document.body.appendChild(overlay);

    // Wire up all event handlers
    wireActions(overlay, existing, storageKey, { restoreVibe, runVibe, getActivePort, setActivePort });
  } catch (e) {
    console.error('[Vibe] openModal error:', e);
  }
}
