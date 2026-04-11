(async () => {
  // Don't inject into iframes
  if (window !== window.top) return;

  const pageUrl   = location.href;
  const storageKey = `vibe::${pageUrl}`;

  // ─── Port (active session channel to background) ───────────────────────────
  let activePort = null;

  // ─── Apply stored vibe on page load ───────────────────────────────────────
  const stored = await storageGet(storageKey);
  if (stored?.css || stored?.js) applyVibe(stored);

  // ─── Inject the floating Vibe button ──────────────────────────────────────
  waitForBody(() => injectVibeButton());

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
      const old = document.getElementById('__vibe_js__');
      if (old) old.remove();
      const script = document.createElement('script');
      script.id = '__vibe_js__';
      script.textContent = js;
      (document.body || document.documentElement).appendChild(script);
    }
  }

  // Like applyVibe but always clears empty fields — used for undo/revert
  // where we need to remove old CSS/JS when the target state doesn't have them
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

    const old = document.getElementById('__vibe_js__');
    if (old) old.remove();
    if (js) {
      const script = document.createElement('script');
      script.id = '__vibe_js__';
      script.textContent = js;
      (document.body || document.documentElement).appendChild(script);
    }
  }

  function injectVibeButton() {
    if (document.getElementById('__vibe_btn__')) return;

    const btn = document.createElement('button');
    btn.id = '__vibe_btn__';
    btn.innerHTML = '<span style="font-size:15px;line-height:1">✦</span><span>Vibe</span>';
    btn.style.cssText = `
      all: initial;
      position: fixed !important;
      bottom: 24px !important;
      right: 24px !important;
      z-index: 2147483647 !important;
      display: flex !important;
      align-items: center !important;
      gap: 7px !important;
      background: #111 !important;
      color: #fff !important;
      border: none !important;
      border-radius: 100px !important;
      padding: 11px 20px !important;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important;
      font-size: 14px !important;
      font-weight: 600 !important;
      cursor: pointer !important;
      box-shadow: 0 4px 20px rgba(0,0,0,0.4), 0 1px 3px rgba(0,0,0,0.2) !important;
      letter-spacing: -0.01em !important;
      transition: transform 0.12s ease, box-shadow 0.12s ease !important;
      user-select: none !important;
    `;

    btn.onmouseenter = () => {
      btn.style.setProperty('transform', 'translateY(-2px)', 'important');
      btn.style.setProperty('box-shadow', '0 8px 28px rgba(0,0,0,0.45), 0 1px 3px rgba(0,0,0,0.2)', 'important');
    };
    btn.onmouseleave = () => {
      btn.style.setProperty('transform', 'translateY(0)', 'important');
      btn.style.setProperty('box-shadow', '0 4px 20px rgba(0,0,0,0.4), 0 1px 3px rgba(0,0,0,0.2)', 'important');
    };
    btn.onclick = openModal;

    document.body.appendChild(btn);
  }

  // ─── Modal ─────────────────────────────────────────────────────────────────
  async function openModal() {
    try {
      await _openModalInner();
    } catch (e) {
      console.error('[Vibe] openModal error:', e);
    }
  }

  async function _openModalInner() {
    if (document.getElementById('__vibe_overlay__')) return;

    const existing = await storageGet(storageKey);
    const hasVibe  = !!(existing?.css || existing?.js);

    const appliedHTML = (existing?.applied?.length) ? `
      <div style="margin-bottom:18px">
        <div style="font-size:11px;font-weight:700;color:#aaa;text-transform:uppercase;letter-spacing:0.07em;margin-bottom:8px">Applied on this page</div>
        <div style="display:flex;flex-direction:column;gap:5px">
          ${existing.applied.map(a => `
            <div style="font-size:12px;color:#555;background:#f7f7f7;border-radius:8px;padding:7px 11px;display:flex;align-items:center;gap:7px">
              <span style="color:#2a9d5c;font-size:11px">✓</span>${escHtml(a.intent || '')}
            </div>
          `).join('')}
        </div>
      </div>` : '';

    const historyHTML = (existing?.history?.length) ? `
      <div style="margin-bottom:18px" id="__vibe_history_section__">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <div style="font-size:11px;font-weight:700;color:#aaa;text-transform:uppercase;letter-spacing:0.07em">Version history</div>
          <button id="__vibe_history_toggle__" style="all:initial;font-size:11px;color:#bbb;cursor:pointer;font-family:inherit;">Show</button>
        </div>
        <div id="__vibe_history_list__" style="display:none;flex-direction:column;gap:5px">
          ${existing.history.slice().reverse().map((h, i) => `
            <div style="font-size:12px;background:#f7f7f7;border-radius:8px;padding:7px 11px;display:flex;align-items:center;justify-content:space-between;gap:8px">
              <div style="color:#555;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escHtml(h.intent || '')}">
                ${escHtml(h.intent || 'Previous version')}
                <span style="color:#bbb;font-size:10px;margin-left:5px">${formatTime(h.timestamp)}</span>
              </div>
              <button class="__vibe_revert_btn__" data-index="${existing.history.length - 1 - i}" style="
                all:initial;font-size:11px;color:#666;border:1px solid #ddd;
                border-radius:6px;padding:3px 9px;cursor:pointer;
                font-family:inherit;white-space:nowrap;
                transition:background 0.1s;
              ">Restore</button>
            </div>
          `).join('')}
        </div>
      </div>` : '';

    const shortUrl = pageUrl.replace(/^https?:\/\/(www\.)?/, '').slice(0, 60);

    const overlay = document.createElement('div');
    overlay.id = '__vibe_overlay__';
    overlay.style.cssText = `
      all: initial;
      position: fixed !important;
      inset: 0 !important;
      background: rgba(0,0,0,0.65) !important;
      backdrop-filter: blur(10px) !important;
      -webkit-backdrop-filter: blur(10px) !important;
      z-index: 2147483646 !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important;
    `;

    overlay.innerHTML = `
      <div id="__vibe_modal__" style="
        background: #fff;
        border-radius: 22px;
        padding: 28px 28px 24px;
        width: 520px;
        max-width: 92vw;
        box-shadow: 0 40px 100px rgba(0,0,0,0.45);
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        color: #1a1a1a;
        box-sizing: border-box;
      ">
        <!-- Header -->
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:22px">
          <div>
            <div style="font-size:20px;font-weight:700;letter-spacing:-0.03em;display:flex;align-items:center;gap:8px">
              <span style="font-size:18px">✦</span> Vibe this page
            </div>
            <div style="font-size:12px;color:#bbb;margin-top:4px;font-family:monospace">${escHtml(shortUrl)}${pageUrl.length > 60 ? '…' : ''}</div>
          </div>
          <button id="__vibe_close__" style="
            all:initial; cursor:pointer; font-size:24px; color:#ccc;
            line-height:1; padding:2px; font-family:inherit;
          ">×</button>
        </div>

        ${appliedHTML}
        ${historyHTML}

        <!-- Live feed (hidden until session starts) -->
        <div id="__vibe_feed__" style="
          max-height:150px;
          overflow-y:auto;
          font-size:12px;
          font-family:monospace;
          margin-bottom:14px;
          display:none;
          border:1px solid #f0f0f0;
          border-radius:10px;
          padding:10px;
          line-height:1.6;
        "></div>

        <!-- Question mode panel (hidden initially) -->
        <div id="__vibe_question_panel__" style="display:none;margin-bottom:14px">
          <div style="font-size:11px;font-weight:700;color:#d97706;text-transform:uppercase;letter-spacing:0.07em;margin-bottom:8px">Claude is asking</div>
          <div id="__vibe_question_text__" style="font-size:14px;color:#1a1a1a;margin-bottom:12px;line-height:1.5"></div>
          <div id="__vibe_question_options__" style="display:flex;flex-direction:column;gap:6px;margin-bottom:8px"></div>
          <input id="__vibe_question_input__" type="text" placeholder="Your answer…" style="
            width:100%;border:1.5px solid #d97706;border-radius:10px;
            padding:10px 14px;font-size:14px;box-sizing:border-box;
            outline:none;font-family:inherit;display:none;
          ">
          <button id="__vibe_question_submit__" style="
            margin-top:8px;background:#d97706;color:#fff;border:none;
            border-radius:10px;padding:10px 18px;font-size:13px;font-weight:600;
            cursor:pointer;font-family:inherit;display:none;
          ">Answer →</button>
        </div>

        <!-- Prompt input -->
        <textarea
          id="__vibe_input__"
          placeholder="Describe what you want to change…
e.g. hide the shorts shelf, make the sidebar dark, remove sponsored posts, increase font size"
          style="
            width: 100%;
            height: 110px;
            border: 1.5px solid #ebebeb;
            border-radius: 14px;
            padding: 14px 16px;
            font-size: 14px;
            font-family: inherit;
            color: #1a1a1a;
            resize: none;
            outline: none;
            box-sizing: border-box;
            line-height: 1.55;
            transition: border-color 0.15s;
          "
        ></textarea>

        <div style="font-size:11px;color:#ccc;margin-top:6px">⌘ + Enter to submit</div>
        <div id="__vibe_status__" style="font-size:13px;min-height:18px;margin-top:6px;"></div>

        <!-- Actions -->
        <div style="display:flex;gap:8px;margin-top:14px">
          <button id="__vibe_go__" style="
            flex:1; background:#111; color:#fff;
            border:none; border-radius:14px;
            padding:14px 20px; font-size:14px; font-weight:600;
            cursor:pointer; font-family:inherit;
            transition: background 0.1s;
          ">Make it vibe →</button>

          ${hasVibe ? `
          <button id="__vibe_undo__" style="
            background:transparent; color:#555;
            border:1.5px solid #d0d0d0; border-radius:14px;
            padding:14px 16px; font-size:13px;
            cursor:pointer; font-family:inherit;
            white-space:nowrap;
            transition: border-color 0.15s, color 0.15s;
          ">↩ Undo</button>` : ''}

          ${hasVibe ? `
          <button id="__vibe_reset__" style="
            background:transparent; color:#bbb;
            border:1.5px solid #ebebeb; border-radius:14px;
            padding:14px 16px; font-size:13px;
            cursor:pointer; font-family:inherit;
            white-space:nowrap;
            transition: border-color 0.15s, color 0.15s;
          ">Reset</button>` : ''}
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    // Wire up interactions
    const input = document.getElementById('__vibe_input__');
    if (input) {
      input.onfocus = () => input.style.borderColor = '#111';
      input.onblur  = () => input.style.borderColor = '#ebebeb';
    }

    document.getElementById('__vibe_close__')?.addEventListener('click', () => {
      overlay.remove();
      if (activePort) { try { activePort.disconnect(); } catch {} activePort = null; }
    });
    overlay.onclick = (e) => {
      if (e.target === overlay) {
        overlay.remove();
        if (activePort) { try { activePort.disconnect(); } catch {} activePort = null; }
      }
    };

    document.getElementById('__vibe_undo__')?.addEventListener('click', async () => {
      try {
        const undoBtn = document.getElementById('__vibe_undo__');
        if (undoBtn) { undoBtn.textContent = 'Undoing…'; undoBtn.disabled = true; }

        // If no history, undo the only/first change → restore to blank
        if (!existing?.history?.length) {
          restoreVibe({ css: '', js: '' });
          const updated = {
            ...existing,
            css: '',
            js: '',
            history: [],
            applied: (existing.applied || []).slice(0, -1),
          };
          await new Promise(r => chrome.storage.local.set({ [storageKey]: updated }, r));
          overlay.remove();
          return;
        }

        // Restore the most recent history snapshot and remove it from history
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

        await new Promise(r => chrome.storage.local.set({ [storageKey]: updated }, r));
        overlay.remove();
      } catch (e) {
        console.error('[Vibe] Undo error:', e);
      }
    });

    document.getElementById('__vibe_reset__')?.addEventListener('click', async () => {
      await new Promise(r => chrome.storage.local.remove(storageKey, r));
      overlay.remove();
      document.getElementById('__vibe_css__')?.remove();
      document.getElementById('__vibe_js__')?.remove();
    });

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
      btn.addEventListener('mouseenter', () => { btn.style.background = '#f0f0f0'; });
      btn.addEventListener('mouseleave', () => { btn.style.background = ''; });
      btn.addEventListener('click', async () => {
        const idx = parseInt(btn.dataset.index, 10);
        const snapshot = existing?.history?.[idx];
        if (!snapshot) return;

        btn.textContent = 'Restoring…';
        btn.disabled = true;

        // Apply the old CSS/JS to the page (restoreVibe clears empty fields properly)
        restoreVibe({ css: snapshot.css || '', js: snapshot.js || '' });

        // Save as the new current state (push current state to history first)
        const currentHistory = existing.history ? [...existing.history] : [];
        if (existing.css || existing.js) {
          const lastApplied = existing.applied?.[existing.applied.length - 1];
          currentHistory.push({
            css: existing.css,
            js: existing.js,
            intent: lastApplied?.intent || 'Before revert',
            timestamp: new Date().toISOString(),
          });
          if (currentHistory.length > 10) currentHistory.shift();
        }
        // Remove the snapshot we're restoring to from history (it's now the current state)
        currentHistory.splice(idx, 1);

        const updated = {
          ...existing,
          css: snapshot.css,
          js: snapshot.js,
          history: currentHistory,
          applied: [...(existing.applied || []), { intent: `Reverted to: ${snapshot.intent}`, selector: '(revert)', method: 'revert', dynamic: false }],
        };

        await new Promise(r => chrome.storage.local.set({ [storageKey]: updated }, r));
        overlay.remove();
      });
    });

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

  // ─── Core: start the agentic session ─────────────────────────────────────
  function runVibe(overlay, existingSession) {
    const promptText = document.getElementById('__vibe_input__')?.value.trim();
    if (!promptText) return;

    // Switch modal to "running" mode
    const feedEl  = document.getElementById('__vibe_feed__');
    const inputEl = document.getElementById('__vibe_input__');
    const goBtn   = document.getElementById('__vibe_go__');
    const statusEl = document.getElementById('__vibe_status__');
    const hintEl  = inputEl?.nextElementSibling; // The "⌘ + Enter" hint

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

    activePort.onMessage.addListener((msg) => handleBackgroundMessage(msg, overlay, existingSession));

    activePort.onDisconnect.addListener(() => {
      activePort = null;
      // Only reset if modal is still open and not already done
      const goBtn2 = document.getElementById('__vibe_go__');
      if (goBtn2 && goBtn2.disabled) {
        appendFeedItem({ kind: 'error', text: 'Connection lost' });
        if (goBtn2) { goBtn2.disabled = false; goBtn2.style.opacity = '1'; goBtn2.textContent = 'Make it vibe →'; }
      }
    });

    activePort.postMessage({
      type: 'SESSION_START',
      prompt: promptText,
      url: pageUrl,
      session: existingSession,
    });
  }

  // ─── Handle messages from background ─────────────────────────────────────
  async function handleBackgroundMessage(msg, overlay, existingSession) {
    console.log('[Vibe Content] Message from background:', msg.type);

    switch (msg.type) {
      case 'TOOL_EXEC': {
        let result;
        try {
          result = await execTool(msg.name, msg.input);
        } catch (err) {
          console.error('[Vibe Content] Tool exec error:', err);
          result = { error: err.message };
        }
        try { activePort?.postMessage({ type: 'TOOL_RESULT', execId: msg.execId, result }); } catch {}
        break;
      }

      case 'FEED_UPDATE':
        appendFeedItem(msg);
        break;

      case 'ASK_USER':
        appendFeedItem({ kind: 'question', text: msg.question });
        switchToQuestionMode(msg);
        break;

      case 'SESSION_DONE': {
        const { css, js, summary, confidence } = msg;
        applyVibe({ css, js });
        appendFeedItem({ kind: 'done', text: summary, confidence });
        setStatus(document.getElementById('__vibe_status__'), `✓ Done! Confidence: ${confidence}%`, '#2a9d5c');
        setTimeout(() => overlay?.remove(), 1800);
        const goBtn = document.getElementById('__vibe_go__');
        if (goBtn) { goBtn.disabled = false; goBtn.style.opacity = '1'; }
        break;
      }

      case 'SESSION_FAILED': {
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

  // ─── Tool executors ───────────────────────────────────────────────────────
  async function execTool(name, input) {
    switch (name) {
      case 'extract_dom':    return execExtractDom();
      case 'query_selector': return execQuerySelector(input.selector);
      case 'check_dynamic':  return execCheckDynamic(input.selector);
      case 'apply_changes':  return execApplyChanges(input);
      default: return { error: `Unknown tool: ${name}` };
    }
  }

  function execExtractDom() {
    const els = [];
    document.querySelectorAll('*').forEach(el => {
      const tag = el.tagName;
      // Skip noise
      if (/^(SCRIPT|STYLE|META|LINK|NOSCRIPT|HEAD)$/.test(tag)) return;
      const cs = window.getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') return;
      if (cs.opacity === '0') return;
      // Skip elements with no layout presence (not body/html)
      if (!el.offsetParent && tag !== 'BODY' && tag !== 'HTML') return;

      const dataAttrs = {};
      for (const attr of el.attributes) {
        if (attr.name.startsWith('data-')) dataAttrs[attr.name] = attr.value;
      }

      els.push({
        tag: tag.toLowerCase(),
        id: el.id || null,
        classes: [...el.classList].slice(0, 8), // limit class count
        text: (el.childElementCount === 0 ? el.textContent?.trim().slice(0, 80) : null) || null,
        dataAttrs,
      });
    });

    const capped = els.slice(0, 600);
    const fingerprint = djb2(
      capped.slice(0, 200).map(e => e.tag + (e.id || '') + e.classes.join('')).join('|')
    );
    return { elements: capped, fingerprint };
  }

  function execQuerySelector(selector) {
    let matches;
    try {
      matches = document.querySelectorAll(selector);
    } catch (e) {
      return { error: `Invalid selector: ${e.message}`, count: 0, elements: [] };
    }
    return {
      count: matches.length,
      elements: [...matches].slice(0, 3).map(el => ({
        tag: el.tagName.toLowerCase(),
        id: el.id || null,
        classes: [...el.classList].slice(0, 6),
        computedStyles: getRelevantStyles(el),
      })),
    };
  }

  function getRelevantStyles(el) {
    const cs = window.getComputedStyle(el);
    return {
      display:          cs.display,
      visibility:       cs.visibility,
      opacity:          cs.opacity,
      color:            cs.color,
      backgroundColor:  cs.backgroundColor,
      fontSize:         cs.fontSize,
      position:         cs.position,
      zIndex:           cs.zIndex,
    };
  }

  function execCheckDynamic(selector) {
    return new Promise(resolve => {
      let changed = false;
      const initialExists = !!document.querySelector(selector);

      const obs = new MutationObserver(() => {
        const nowExists = !!document.querySelector(selector);
        if (nowExists !== initialExists) changed = true;
      });

      obs.observe(document.body || document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
      });

      setTimeout(() => {
        obs.disconnect();
        resolve({ result: changed ? 'dynamic' : 'static' });
      }, 3000);
    });
  }

  function execApplyChanges({ css, js }) {
    applyVibe({ css, js });

    // Extract selectors from CSS to report match counts
    const matchedSelectors = [];
    if (css) {
      const selectorPattern = /([^{}]+)\s*\{[^}]*\}/g;
      let m;
      while ((m = selectorPattern.exec(css)) !== null) {
        const sel = m[1].trim().replace(/\s*!important/g, '');
        // Try each individual selector in comma-separated lists
        sel.split(',').forEach(s => {
          const trimmed = s.trim();
          try {
            const count = document.querySelectorAll(trimmed).length;
            if (count > 0) matchedSelectors.push({ selector: trimmed, count });
          } catch {}
        });
      }
    }

    return { success: true, matchedSelectors };
  }

  // ─── Feed UI ──────────────────────────────────────────────────────────────
  function appendFeedItem({ kind, text, tool, confidence }) {
    const feedEl = document.getElementById('__vibe_feed__');
    if (!feedEl) return;

    feedEl.style.display = 'block';

    const row = document.createElement('div');
    row.style.cssText = 'padding:2px 0;white-space:pre-wrap;word-break:break-word;';

    const colorMap = {
      thinking: '#999',
      tool:     '#2563eb',
      question: '#d97706',
      done:     '#16a34a',
      error:    '#dc2626',
    };

    let label;
    if (kind === 'thinking') label = `· ${(text || '').slice(0, 100)}`;
    else if (kind === 'tool') label = `→ ${tool || text}`;
    else if (kind === 'question') label = `? ${text}`;
    else if (kind === 'done') label = `✓ done  confidence: ${confidence}%  — ${text}`;
    else label = `✗ ${text}`;

    row.style.color = colorMap[kind] || '#555';
    row.textContent = label;

    feedEl.appendChild(row);
    feedEl.scrollTop = feedEl.scrollHeight;
  }

  // ─── Question mode ────────────────────────────────────────────────────────
  function switchToQuestionMode({ toolUseId, question, options }) {
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
      try { activePort?.postMessage({ type: 'ASK_USER_ANSWER', toolUseId, answer }); } catch {}
    }

    if (options && options.length > 0) {
      inputEl.style.display = 'none';
      submitEl.style.display = 'none';
      options.forEach(opt => {
        const btn = document.createElement('button');
        btn.textContent = opt;
        btn.style.cssText = `
          background:#fff;color:#1a1a1a;border:1.5px solid #d97706;
          border-radius:10px;padding:9px 14px;font-size:13px;
          cursor:pointer;font-family:inherit;text-align:left;
          transition:background 0.1s;
        `;
        btn.onmouseenter = () => btn.style.background = '#fef3c7';
        btn.onmouseleave = () => btn.style.background = '#fff';
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

  // ─── Helpers ──────────────────────────────────────────────────────────────
  function djb2(str) {
    let h = 5381;
    for (let i = 0; i < str.length; i++) h = ((h << 5) + h) ^ str.charCodeAt(i);
    return (h >>> 0).toString(16);
  }

  function storageGet(key) {
    return new Promise(r => chrome.storage.local.get(key, d => r(d[key] ?? null)));
  }

  function setStatus(el, msg, color) {
    if (!el) return;
    el.textContent = msg;
    el.style.color = color;
  }

  function escHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function formatTime(iso) {
    if (!iso) return '';
    try {
      const d = new Date(iso);
      const now = new Date();
      const diffMs = now - d;
      const diffMins = Math.floor(diffMs / 60000);
      if (diffMins < 1)  return 'just now';
      if (diffMins < 60) return `${diffMins}m ago`;
      const diffHrs = Math.floor(diffMins / 60);
      if (diffHrs < 24)  return `${diffHrs}h ago`;
      return `${Math.floor(diffHrs / 24)}d ago`;
    } catch { return ''; }
  }
})();
