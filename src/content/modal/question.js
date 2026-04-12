import { createAskUserAnswer } from '../../shared/messages.js';
import { appendFeedItem } from './feed.js';

export function switchToQuestionMode({ toolUseId, question, options }, activePort) {
  const panel   = document.getElementById('__vibe_question_panel__');
  const textEl  = document.getElementById('__vibe_question_text__');
  const optsEl  = document.getElementById('__vibe_question_options__');
  const inputEl = document.getElementById('__vibe_question_input__');
  const submitEl = document.getElementById('__vibe_question_submit__');
  const mainInput = document.getElementById('__vibe_input__');
  const goBtn   = document.getElementById('__vibe_go__');

  if (!panel) return;

  textEl.textContent = question;
  optsEl.innerHTML = '';

  panel.style.display = 'block';
  if (mainInput) mainInput.style.display = 'none';
  if (goBtn) goBtn.style.display = 'none';

  function sendAnswer(answer) {
    panel.style.display = 'none';
    if (goBtn) goBtn.style.display = '';
    appendFeedItem({ kind: 'thinking', text: `You: ${answer}` });
    try { activePort?.postMessage(createAskUserAnswer(toolUseId, answer)); } catch { /* port closed */ }
  }

  if (options && options.length > 0) {
    inputEl.style.display = 'none';
    submitEl.style.display = 'none';
    options.forEach(opt => {
      const btn = document.createElement('button');
      btn.textContent = opt;
      btn.className = '__vibe_question_option__';
      btn.onclick = () => sendAnswer(opt);
      optsEl.appendChild(btn);
    });
  } else {
    inputEl.style.display = 'block';
    submitEl.style.display = 'block';
    submitEl.onclick = () => {
      const val = inputEl.value.trim();
      if (!val) return;
      sendAnswer(val);
    };
    inputEl.onkeydown = (e) => {
      if (e.key === 'Enter') { e.preventDefault(); submitEl.click(); }
    };
    setTimeout(() => inputEl.focus(), 60);
  }
}
