import { CONFIG } from '../shared/config.js';
import { createFeedUpdate } from '../shared/messages.js';
import { COMPACT_SYSTEM } from './prompts.js';
import { safePostMessage } from './tool-dispatch.js';

// ─── Layer 2: rough token estimator ──────────────────────────────────────────
export function estimateTokens(messages) {
  return Math.ceil(JSON.stringify(messages).length / CONFIG.compaction.charsPerToken);
}

// ─── Helper: get the last N assistant turns + their following user messages ──
export function getLastNTurns(messages, n) {
  const assistantIndices = messages
    .map((m, i) => (m.role === 'assistant' ? i : -1))
    .filter(i => i >= 0);
  if (assistantIndices.length <= n) return messages;
  const startIdx = assistantIndices[assistantIndices.length - n];
  return messages.slice(startIdx);
}

// ─── Layer 1: strip bulk from old tool results (free, no API call) ───────────
export function pruneOldToolResults(messages) {
  const assistantIndices = messages
    .map((m, i) => (m.role === 'assistant' ? i : -1))
    .filter(i => i >= 0);

  const cutoff = assistantIndices.length > CONFIG.compaction.microCompactKeep
    ? assistantIndices[assistantIndices.length - CONFIG.compaction.microCompactKeep]
    : 0;

  return messages.map((msg, idx) => {
    if (idx >= cutoff) return msg;
    if (msg.role !== 'user') return msg;
    if (!Array.isArray(msg.content)) return msg;

    return {
      ...msg,
      content: msg.content.map(block => {
        if (block.type !== 'tool_result') return block;
        return compressToolResultBlock(block);
      }),
    };
  });
}

export function compressToolResultBlock(block) {
  if (!block.content) return block;
  let parsed;
  try { parsed = JSON.parse(block.content); } catch { return block; }

  // extract_dom result: huge elements array — replace with summary
  if (Array.isArray(parsed.elements)) {
    return {
      ...block,
      content: JSON.stringify({
        _pruned: 'extract_dom',
        elementCount: parsed.elements.length,
        fingerprint: parsed.fingerprint,
      }),
    };
  }

  // query_selector result: drop computed styles, keep just count
  if (parsed.count !== undefined && Array.isArray(parsed.elements)) {
    return {
      ...block,
      content: JSON.stringify({ count: parsed.count }),
    };
  }

  // apply_changes result: drop full matchedSelectors list, keep just summary
  if (parsed.success !== undefined && Array.isArray(parsed.matchedSelectors)) {
    return {
      ...block,
      content: JSON.stringify({
        success: parsed.success,
        matchedCount: parsed.matchedSelectors.length,
      }),
    };
  }

  return block;
}

// ─── Layer 3: full Claude-generated summary compact ──────────────────────────
export async function compactWithClaude(messages, session, apiKey, port) {
  safePostMessage(port, createFeedUpdate('thinking', { text: 'Context too large — compacting…' }));
  console.log('[Vibe BG] Running full compact with Claude');

  const recentTurns = getLastNTurns(messages, CONFIG.compaction.fullCompactKeep);
  const compactPrompt = buildCompactPrompt(messages, session);

  let summary;
  try {
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
        model: CONFIG.models.compactor,
        max_tokens: CONFIG.api.maxTokensCompact,
        system: COMPACT_SYSTEM,
        messages: [{ role: 'user', content: compactPrompt }],
      }),
    });

    if (!response.ok) throw new Error(`Compact API error ${response.status}`);
    const data = await response.json();
    const raw = data.content[0].text;

    const match = raw.match(/<summary>([\s\S]*?)<\/summary>/);
    summary = match ? match[1].trim() : raw.trim();
  } catch (err) {
    console.warn('[Vibe BG] Compact API call failed:', err.message);
    safePostMessage(port, createFeedUpdate('thinking', { text: 'Compact failed — truncating history.' }));
    return recentTurns;
  }

  const compacted = [
    {
      role: 'user',
      content: `[COMPACTED SESSION SUMMARY — replaces prior conversation history]\n\n${summary}`,
    },
    {
      role: 'assistant',
      content: [{ type: 'text', text: 'Understood. I have the session context. Continuing.' }],
    },
    ...recentTurns,
  ];

  safePostMessage(port, createFeedUpdate('thinking', { text: 'Context compacted.' }));
  console.log(`[Vibe BG] Compacted from ${messages.length} → ${compacted.length} messages`);
  return compacted;
}

function buildCompactPrompt(messages, session) {
  const pruned = pruneOldToolResults(messages);
  const transcript = pruned.map(m => {
    if (typeof m.content === 'string') return `[${m.role}] ${m.content}`;
    if (Array.isArray(m.content)) {
      return m.content.map(b => {
        if (b.type === 'text') return `[${m.role}] ${b.text}`;
        if (b.type === 'tool_use') return `[tool_call: ${b.name}] ${JSON.stringify(b.input)}`;
        if (b.type === 'tool_result') return `[tool_result] ${b.content}`;
        return '';
      }).filter(Boolean).join('\n');
    }
    return '';
  }).filter(Boolean).join('\n\n');

  return `Session transcript:
${transcript}

Current injected CSS:
${session.css || '(none)'}

Current injected JS:
${session.js || '(none)'}

<analysis>Think about what's important to preserve for the agent to continue working.</analysis>

<summary>
## User Requests
(list all user requests verbatim)

## Page
URL: ${session.url}

## Selectors Found (matched, count > 0)
(list confirmed selectors and what they target)

## Selectors Tried and Failed (count = 0)
(list selectors with zero matches)

## Changes Applied
(describe CSS/JS injected and what each targets)

## Dynamic Elements
(SPA-rendered elements and what observer approach was used)

## User Clarifications
(verbatim answers from ask_user calls)

## Failed Approaches
(what was tried and didn't work, why)

## Current Injected State
CSS: ${session.css || '(none)'}
JS: ${session.js || '(none)'}
</summary>`;
}
