import { CONFIG } from '../shared/config.js';
import { CACHED_SYSTEM, CACHED_TOOLS } from './prompts.js';

// ─── Cache breakpoint helper ──────────────────────────────────────────────────
// Stamps a cache_control marker on the second-to-last message so all prior
// conversation history (DOM snapshot + tool turns) is treated as a cached prefix.
// Only the current (last) user message is billed at full price each turn.
export function addCacheBreakpoint(messages) {
  if (messages.length < 2) return messages;
  return messages.map((msg, i) => {
    if (i !== messages.length - 2) return msg;
    const content = Array.isArray(msg.content)
      ? msg.content
      : [{ type: 'text', text: msg.content }];
    return {
      ...msg,
      content: [
        ...content.slice(0, -1),
        { ...content.at(-1), cache_control: { type: 'ephemeral' } },
      ],
    };
  });
}

// ─── Anthropic API call ───────────────────────────────────────────────────────
export async function callAPI(messages, apiKey) {
  const response = await fetch(CONFIG.api.baseUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': CONFIG.api.version,
      'anthropic-beta': CONFIG.api.beta,
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: CONFIG.models.agent,
      max_tokens: CONFIG.api.maxTokensAgent,
      system: CACHED_SYSTEM,
      tools: CACHED_TOOLS,
      messages: addCacheBreakpoint(messages),
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || `Anthropic API error ${response.status}`);
  }

  return response.json();
}
