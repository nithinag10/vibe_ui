import { CONFIG } from '../../shared/config.js';
import { djb2 } from '../helpers.js';

export const extractDomTool = {
  definition: {
    name: 'extract_dom',
    description: 'Structured DOM snapshot. Call once at session start. Returns array of {tag, id, classes, text, dataAttrs} for visible, meaningful elements. Strips scripts, styles, hidden elements.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },

  execute: async () => {
    const els = [];
    document.querySelectorAll('*').forEach(el => {
      const tag = el.tagName;
      if (/^(SCRIPT|STYLE|META|LINK|NOSCRIPT|HEAD)$/.test(tag)) return;
      const cs = window.getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') return;
      if (cs.opacity === '0') return;
      if (!el.offsetParent && tag !== 'BODY' && tag !== 'HTML') return;

      const dataAttrs = {};
      for (const attr of el.attributes) {
        if (attr.name.startsWith('data-')) dataAttrs[attr.name] = attr.value;
      }

      els.push({
        tag: tag.toLowerCase(),
        id: el.id || null,
        classes: [...el.classList].slice(0, CONFIG.dom.maxClassesPerElement),
        text: (el.childElementCount === 0 ? el.textContent?.trim().slice(0, CONFIG.dom.textSliceLength) : null) || null,
        dataAttrs,
      });
    });

    const capped = els.slice(0, CONFIG.dom.elementCap);
    const fingerprint = djb2(
      capped.slice(0, CONFIG.dom.fingerprintSampleSize).map(e => e.tag + (e.id || '') + e.classes.join('')).join('|')
    );
    return { elements: capped, fingerprint };
  },
};
