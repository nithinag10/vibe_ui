import { CONFIG } from '../../shared/config.js';

export const checkDynamicTool = {
  definition: {
    name: 'check_dynamic',
    description: 'Watch an element for 3 seconds via MutationObserver to determine if it is SPA-rendered. Returns "static" or "dynamic". Use this before apply_changes when the site is a SPA (YouTube, Twitter, etc.).',
    input_schema: {
      type: 'object',
      properties: { selector: { type: 'string', description: 'CSS selector to observe' } },
      required: ['selector'],
    },
  },

  execute: async ({ selector }) => {
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
      }, CONFIG.timeouts.checkDynamicWatch);
    });
  },
};
