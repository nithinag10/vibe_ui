export const applyChangesTool = {
  definition: {
    name: 'apply_changes',
    description: 'Inject CSS and/or JS into the live page. Returns {success, matchedSelectors[]}. Always call query_selector first to confirm selector matches. After applying, verify with query_selector again.',
    input_schema: {
      type: 'object',
      properties: {
        css: { type: 'string', description: 'CSS to inject (use !important). Empty string if not needed.' },
        js:  { type: 'string', description: 'JavaScript to inject directly into page context. Empty string if not needed.' },
      },
      required: ['css', 'js'],
    },
  },

  execute: async ({ css, js }) => {
    // Inject CSS
    if (css) {
      let style = document.getElementById('__vibe_css__');
      if (!style) {
        style = document.createElement('style');
        style.id = '__vibe_css__';
        (document.head || document.documentElement).appendChild(style);
      }
      style.textContent = css;
    }

    // Inject JS — delegated to background to bypass page CSP via chrome.scripting.executeScript
    if (js) {
      await chrome.runtime.sendMessage({ type: 'EXEC_JS', js });
    }

    // Extract selectors from CSS to report match counts
    const matchedSelectors = [];
    if (css) {
      const selectorPattern = /([^{}]+)\s*\{[^}]*\}/g;
      let m;
      while ((m = selectorPattern.exec(css)) !== null) {
        const sel = m[1].trim().replace(/\s*!important/g, '');
        sel.split(',').forEach(s => {
          const trimmed = s.trim();
          try {
            const count = document.querySelectorAll(trimmed).length;
            if (count > 0) matchedSelectors.push({ selector: trimmed, count });
          } catch { /* invalid selector */ }
        });
      }
    }

    return { success: true, matchedSelectors };
  },
};
