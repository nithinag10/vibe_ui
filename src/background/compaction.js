import { CONFIG } from '../shared/config.js';
import { createFeedUpdate } from '../shared/messages.js';
import { COMPACT_SYSTEM } from './prompts.js';
import { safePostMessage } from './tool-dispatch.js';

// ─── Layer 2: rough token estimator ──────────────────────────────────────────
// Walks the message tree and sums text-like content by character length, while
// counting image blocks separately at a flat per-image cost. The old JSON-based
// estimator counted base64 image data as 500KB of "text", wildly overestimating
// cost after any capture call and forcing spurious compactions.
export function estimateTokens(messages) {
  const acc = { chars: 0, images: 0 };
  for (const msg of messages) {
    if (typeof msg.content === 'string') {
      acc.chars += msg.content.length;
      continue;
    }
    if (!Array.isArray(msg.content)) continue;
    for (const block of msg.content) walkBlock(block, acc);
  }
  return Math.ceil(acc.chars / CONFIG.compaction.charsPerToken) + acc.images * CONFIG.compaction.tokensPerImage;
}

function walkBlock(block, acc) {
  if (!block || typeof block !== 'object') return;
  if (block.type === 'image') { acc.images++; return; }
  if (block.type === 'text' && typeof block.text === 'string') acc.chars += block.text.length;
  if (block.type === 'tool_use') {
    if (block.name) acc.chars += block.name.length;
    if (block.input) acc.chars += JSON.stringify(block.input).length;
    return;
  }
  if (block.type === 'tool_result') {
    if (typeof block.content === 'string') acc.chars += block.content.length;
    else if (Array.isArray(block.content)) for (const sub of block.content) walkBlock(sub, acc);
  }
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
  // Multimodal blocks (images from capture) are not JSON — drop the image on compaction.
  if (Array.isArray(block.content)) {
    const textPart = block.content.find(b => b.type === 'text');
    return {
      ...block,
      content: JSON.stringify({ _pruned: 'capture', note: textPart?.text || 'screenshot dropped on compaction' }),
    };
  }
  if (!block.content) return block;
  let parsed;
  try { parsed = JSON.parse(block.content); } catch { return block; }

  // inspect result: drop full matches array, keep counts + mode
  if (parsed.mode && Array.isArray(parsed.matches)) {
    return {
      ...block,
      content: JSON.stringify({
        _pruned: 'inspect',
        mode: parsed.mode,
        query: parsed.query,
        total: parsed.total,
      }),
    };
  }

  // inspect overview: keep just summary counts
  if (parsed.mode === 'overview') {
    return {
      ...block,
      content: JSON.stringify({
        _pruned: 'inspect:overview',
        totalElements: parsed.totalElements,
        iframeCount: parsed.iframes?.length || 0,
      }),
    };
  }

  // apply_changes result: drop verified details, keep summary
  if (parsed.success !== undefined && Array.isArray(parsed.verified)) {
    return {
      ...block,
      content: JSON.stringify({
        _pruned: 'apply_changes',
        success: parsed.success,
        changedCount: parsed.verified.filter(v => v.changed).length,
        totalSelectors: parsed.verified.length,
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
