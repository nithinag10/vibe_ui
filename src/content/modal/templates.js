import { escHtml, formatTime } from '../helpers.js';

export function renderAppliedList(applied) {
  if (!applied?.length) return '';
  return `
    <div class="__vibe_applied_section__">
      <div class="__vibe_section_label__">Applied on this page</div>
      <div class="__vibe_applied_list__">
        ${applied.map(a => `
          <div class="__vibe_applied_item__">
            <span class="__vibe_applied_check__">✓</span>${escHtml(a.intent || '')}
          </div>
        `).join('')}
      </div>
    </div>`;
}

export function renderHistorySection(history) {
  if (!history?.length) return '';
  return `
    <div class="__vibe_history_section__" id="__vibe_history_section__">
      <div class="__vibe_history_header__">
        <div class="__vibe_section_label__">Version history</div>
        <button id="__vibe_history_toggle__">Show</button>
      </div>
      <div id="__vibe_history_list__">
        ${history.slice().reverse().map((h, i) => `
          <div class="__vibe_history_item__">
            <div class="__vibe_history_label__" title="${escHtml(h.intent || '')}">
              ${escHtml(h.intent || 'Previous version')}
              <span class="__vibe_history_time__">${formatTime(h.timestamp)}</span>
            </div>
            <button class="__vibe_revert_btn__" data-index="${history.length - 1 - i}">Restore</button>
          </div>
        `).join('')}
      </div>
    </div>`;
}

export function renderQuestionPanel() {
  return `
    <div id="__vibe_question_panel__">
      <div class="__vibe_question_label__">Claude is asking</div>
      <div id="__vibe_question_text__"></div>
      <div id="__vibe_question_options__"></div>
      <input id="__vibe_question_input__" type="text" placeholder="Your answer…">
      <button id="__vibe_question_submit__">Answer →</button>
    </div>`;
}

export function renderPromptArea(_shortUrl, _fullUrlLength) {
  return `
    <textarea
      id="__vibe_input__"
      placeholder="Describe what you want to change…
e.g. hide the shorts shelf, make the sidebar dark, remove sponsored posts, increase font size"
    ></textarea>
    <div class="__vibe_hint__">⌘ + Enter to submit</div>
    <div id="__vibe_status__"></div>`;
}

export function renderActionButtons(hasVibe) {
  return `
    <div class="__vibe_actions__">
      <button id="__vibe_go__">Make it vibe →</button>
      ${hasVibe ? '<button id="__vibe_undo__">↩ Undo</button>' : ''}
      ${hasVibe ? '<button id="__vibe_reset__">Reset</button>' : ''}
    </div>`;
}

export function renderModalShell(shortUrl, fullUrlLength, innerContent) {
  return `
    <div id="__vibe_modal__">
      <div class="__vibe_header__">
        <div>
          <div class="__vibe_title__">
            <span style="font-size:18px">✦</span> Vibe this page
          </div>
          <div class="__vibe_url__">${escHtml(shortUrl)}${fullUrlLength > 60 ? '…' : ''}</div>
        </div>
        <button id="__vibe_close__">×</button>
      </div>
      ${innerContent}
      <div id="__vibe_feed__"></div>
    </div>`;
}
