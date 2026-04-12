import { CONFIG } from '../../shared/config.js';

export const querySelectorTool = {
  definition: {
    name: 'query_selector',
    description: 'Test a CSS selector against the live page. Returns match count + first 3 matched elements with computed styles. If count === 0 you MUST try a different selector — never call apply_changes with an unverified selector.',
    input_schema: {
      type: 'object',
      properties: { selector: { type: 'string', description: 'CSS selector to test' } },
      required: ['selector'],
    },
  },

  execute: async ({ selector }) => {
    let matches;
    try {
      matches = document.querySelectorAll(selector);
    } catch (e) {
      return { error: `Invalid selector: ${e.message}`, count: 0, elements: [] };
    }
    return {
      count: matches.length,
      elements: [...matches].slice(0, CONFIG.dom.selectorPreviewCount).map(el => ({
        tag: el.tagName.toLowerCase(),
        id: el.id || null,
        classes: [...el.classList].slice(0, 6),
        computedStyles: getRelevantStyles(el),
      })),
    };
  },
};

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
