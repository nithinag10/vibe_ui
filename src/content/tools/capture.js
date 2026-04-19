import { CONFIG } from '../../shared/config.js';
import { MSG } from '../../shared/messages.js';

export const captureTool = {
  definition: {
    name: 'capture',
    description:
      'Take a screenshot of the page. With no args, captures the visible viewport. ' +
      'With a selector, scrolls the element into view and crops to its bounds. ' +
      'Use this to see the result of a change, or to verify a selector targets the right visual element. ' +
      'Returns the image to you directly — inspect it with your vision, then decide what to do next.',
    input_schema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector to crop to. Omit for full viewport.' },
      },
      required: [],
    },
  },

  execute: async ({ selector } = {}) => {
    let rect = null;
    if (selector) {
      let el;
      try { el = document.querySelector(selector); }
      catch (e) { return textOnly(`Invalid selector: ${e.message}`); }
      if (!el) return textOnly(`No element matches "${selector}".`);
      el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
      await new Promise(r => setTimeout(r, 120));
      const r = el.getBoundingClientRect();
      rect = { x: r.x, y: r.y, w: r.width, h: r.height };
      if (rect.w <= 0 || rect.h <= 0) return textOnly(`"${selector}" has zero size (w=${rect.w}, h=${rect.h}) — may be display:none or collapsed.`);
    }

    const dpr = window.devicePixelRatio || 1;
    let response;
    try {
      response = await chrome.runtime.sendMessage({ type: MSG.CAPTURE_TAB });
    } catch (e) {
      return textOnly(`Capture failed: ${e.message}`);
    }
    if (!response?.ok) return textOnly(`Capture failed: ${response?.error || 'unknown'}`);

    const dataUrl = response.dataUrl;
    const { base64, mediaType, width, height } = rect
      ? await cropImage(dataUrl, rect, dpr)
      : await maybeDownscale(dataUrl);

    return {
      _multimodal: true,
      content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
        {
          type: 'text',
          text: selector
            ? `Screenshot of "${selector}" (${width}×${height}).`
            : `Viewport screenshot (${width}×${height}). Scroll: ${window.scrollY}.`,
        },
      ],
    };
  },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────
function textOnly(msg) {
  return { _multimodal: true, content: [{ type: 'text', text: msg }] };
}

async function cropImage(dataUrl, rect, dpr) {
  const img = await loadImage(dataUrl);
  const sx = Math.max(0, Math.floor(rect.x * dpr));
  const sy = Math.max(0, Math.floor(rect.y * dpr));
  const sw = Math.min(img.width - sx, Math.ceil(rect.w * dpr));
  const sh = Math.min(img.height - sy, Math.ceil(rect.h * dpr));
  const max = CONFIG.capture.maxEdge;
  const scale = Math.min(1, max / Math.max(sw, sh));
  const dw = Math.max(1, Math.round(sw * scale));
  const dh = Math.max(1, Math.round(sh * scale));
  const canvas = document.createElement('canvas');
  canvas.width = dw;
  canvas.height = dh;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, dw, dh);
  const out = canvas.toDataURL('image/png');
  return { base64: stripPrefix(out), mediaType: 'image/png', width: dw, height: dh };
}

async function maybeDownscale(dataUrl) {
  const img = await loadImage(dataUrl);
  const max = CONFIG.capture.maxEdge;
  const scale = Math.min(1, max / Math.max(img.width, img.height));
  if (scale === 1) {
    return { base64: stripPrefix(dataUrl), mediaType: 'image/png', width: img.width, height: img.height };
  }
  const dw = Math.round(img.width * scale);
  const dh = Math.round(img.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = dw;
  canvas.height = dh;
  canvas.getContext('2d').drawImage(img, 0, 0, dw, dh);
  return { base64: stripPrefix(canvas.toDataURL('image/png')), mediaType: 'image/png', width: dw, height: dh };
}

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = dataUrl;
  });
}

function stripPrefix(dataUrl) {
  const i = dataUrl.indexOf(',');
  return i >= 0 ? dataUrl.slice(i + 1) : dataUrl;
}
