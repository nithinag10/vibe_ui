// ─── Module-level state ───────────────────────────────────────────────────────
const pendingToolExecs   = new Map(); // execId    → { resolve, reject }
const pendingUserAnswers = new Map(); // toolUseId → { resolve, reject }

// ─── Compaction constants ─────────────────────────────────────────────────────
const COMPACT_THRESHOLD  = 100_000; // estimated tokens → trigger full compact
const MICRO_COMPACT_KEEP = 2;       // turns kept intact during micro-compact (Layer 1)
const FULL_COMPACT_KEEP  = 3;       // turns kept after Claude summary (Layer 3)

// ─── Tool definitions ─────────────────────────────────────────────────────────
const TOOL_DEFINITIONS = [
  {
    name: 'extract_dom',
    description: 'Structured DOM snapshot. Call once at session start. Returns array of {tag, id, classes, text, dataAttrs} for visible, meaningful elements. Strips scripts, styles, hidden elements.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'query_selector',
    description: 'Test a CSS selector against the live page. Returns match count + first 3 matched elements with computed styles. If count === 0 you MUST try a different selector — never call apply_changes with an unverified selector.',
    input_schema: {
      type: 'object',
      properties: { selector: { type: 'string', description: 'CSS selector to test' } },
      required: ['selector'],
    },
  },
  {
    name: 'check_dynamic',
    description: 'Watch an element for 3 seconds via MutationObserver to determine if it is SPA-rendered. Returns "static" or "dynamic". Use this before apply_changes when the site is a SPA (YouTube, Twitter, etc.).',
    input_schema: {
      type: 'object',
      properties: { selector: { type: 'string', description: 'CSS selector to observe' } },
      required: ['selector'],
    },
  },
  {
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
  {
    name: 'ask_user',
    description: 'Pause the loop and ask the user a clarifying question. Use when: selector matches >3 elements for a vague target, multiple similar elements exist, or intent is contradictory. Provide options[] when possible. Do NOT ask for well-known elements (YouTube sidebar, header, etc.).',
    input_schema: {
      type: 'object',
      properties: {
        question: { type: 'string', description: 'Clear, specific question for the user' },
        options:  { type: 'array', items: { type: 'string' }, description: 'Suggested answer options (optional)' },
      },
      required: ['question'],
    },
  },
  {
    name: 'done',
    description: 'End the session successfully. confidence MUST be >= 70 — if not, keep iterating. css and js must be the COMPLETE accumulated final state, not just the delta.',
    input_schema: {
      type: 'object',
      properties: {
        summary:    { type: 'string',  description: 'Short description of what was done' },
        confidence: { type: 'integer', minimum: 70, maximum: 100, description: 'How confident the change is correct (0-100). Must be >= 70 to call done.' },
        css:        { type: 'string',  description: 'Complete final injected CSS' },
        js:         { type: 'string',  description: 'Complete final injected JS' },
      },
      required: ['summary', 'confidence', 'css', 'js'],
    },
  },
];

const SYSTEM_PROMPT = `You are a browser page modifier agent. You modify how web pages look and behave using natural language instructions.

Follow this loop strictly:
1. extract_dom — understand the page structure (call exactly once per session start)
2. query_selector — verify your intended CSS selector actually matches elements
3. check_dynamic — if the site is a SPA (YouTube, Twitter, etc.), check if the element is dynamically rendered
4. apply_changes — inject CSS (preferred) or JS
5. query_selector again — verify the change took effect
6. done — only when confident (>= 70)

Rules:
- NEVER call apply_changes without a preceding successful query_selector (count > 0)
- confidence < 70 → do NOT call done, keep iterating and trying different approaches
- After apply_changes, always verify with query_selector or visual confirmation
- If apply_changes succeeds but element is still visible → switch to a JS approach (MutationObserver, setInterval) instead of CSS
- The css and js fields in done must be the COMPLETE accumulated final state — not just the new delta
- Use CSS !important to override page styles
- For dynamic SPAs: wrap JS in MutationObserver or setInterval to catch elements that load after paint
- Use ask_user only when genuinely ambiguous (>3 vague matches, multiple identical-looking elements, contradicting intent)
- Do NOT ask about standard well-known elements (YouTube shorts shelf, Twitter sidebar, etc.) — just attempt them`;

// ─── Entry point ──────────────────────────────────────────────────────────────
chrome.runtime.onConnect.addListener(handlePortConnect);

function handlePortConnect(port) {
  if (port.name !== 'vibe-session') return;
  console.log('[Vibe BG] Port connected');

  port.onMessage.addListener(async (msg) => {
    console.log('[Vibe BG] Message:', msg.type);

    if (msg.type === 'SESSION_START') {
      try {
        await startAgentLoop(msg, port);
      } catch (err) {
        console.error('[Vibe BG] Agent loop error:', err);
        safePostMessage(port, { type: 'SESSION_FAILED', reason: err.message });
      }
    }

    if (msg.type === 'TOOL_RESULT') {
      const pending = pendingToolExecs.get(msg.execId);
      if (pending) {
        pendingToolExecs.delete(msg.execId);
        pending.resolve(msg.result);
      }
    }

    if (msg.type === 'ASK_USER_ANSWER') {
      const pending = pendingUserAnswers.get(msg.toolUseId);
      if (pending) {
        pendingUserAnswers.delete(msg.toolUseId);
        pending.resolve(msg.answer);
      }
    }
  });

  port.onDisconnect.addListener(() => {
    console.log('[Vibe BG] Port disconnected — cleaning up pending callbacks');
    for (const [, { reject }] of pendingToolExecs) reject(new Error('Port disconnected'));
    for (const [, { reject }] of pendingUserAnswers) reject(new Error('Port disconnected'));
    pendingToolExecs.clear();
    pendingUserAnswers.clear();
  });
}

// ─── Start agent loop ─────────────────────────────────────────────────────────
async function startAgentLoop({ prompt, url, session: passedSession }, port) {
  // Load API key
  const keys = await new Promise(r => chrome.storage.local.get('apiKey', r));
  if (!keys.apiKey) throw new Error('No API key. Open the Vibe popup and save your Anthropic key.');

  const apiKey = keys.apiKey;

  // Load or initialize session
  const storedRaw = await new Promise(r => chrome.storage.local.get(`vibe::${url}`, r));
  const storedSession = storedRaw[`vibe::${url}`] || null;

  const session = storedSession || {
    url,
    css: '',
    js: '',
    applied: [],
    conversationHistory: [],
    domFingerprint: null,
  };

  // For resumed sessions with a known fingerprint, skip the full extract_dom
  // round-trip if the page hasn't changed. For fresh sessions we always need it.
  let domSnapshot = null;
  let fingerprintWarning = '';
  try {
    if (!session.domFingerprint || session.conversationHistory?.length === 0) {
      // Fresh session — must call extract_dom to prime Claude with DOM context
      domSnapshot = await dispatchToolExec('extract_dom', {}, port);
      session.domFingerprint = domSnapshot.fingerprint;
    } else {
      // Resumed session — call extract_dom only to check for DOM changes
      const check = await dispatchToolExec('extract_dom', {}, port);
      if (check.fingerprint !== session.domFingerprint) {
        fingerprintWarning = '\n\nWARNING: The page DOM structure has changed since your last session. Re-verify all selectors before applying — previously saved selectors may no longer work.';
        console.log('[Vibe BG] DOM fingerprint changed — warning Claude');
        session.domFingerprint = check.fingerprint;
      }
      // Resumed sessions don't inject extract_dom into messages, but buildInitialMessages
      // receives the snapshot in case it's needed (null is safe for the resumed path).
      domSnapshot = check;
    }

    // Feed the extract_dom result into the first tool_result
    const messages = buildInitialMessages(prompt, session, domSnapshot, fingerprintWarning);
    await agentLoop(messages, session, port, url, apiKey, prompt);
  } catch (err) {
    throw err;
  }
}

function buildInitialMessages(prompt, session, domSnapshot, fingerprintWarning) {
  // If there's existing conversation history, resume it
  if (session.conversationHistory && session.conversationHistory.length > 0) {
    const history = session.conversationHistory;
    // Append new user prompt
    const resumeContext = fingerprintWarning
      ? `${fingerprintWarning}\n\nNew request: ${prompt}`
      : `New request: ${prompt}`;
    return [...history, { role: 'user', content: resumeContext }];
  }

  // Fresh session — prime with extract_dom result already done
  // We'll send the first user message with context, then include dom as a tool result
  const recentApplied = (session.applied || []).slice(-5);
  const appliedSummary = recentApplied.length
    ? 'Previously applied on this page (most recent 5):\n' + recentApplied.map(a => `- ${a.intent} (selector: ${a.selector}, method: ${a.method})`).join('\n')
    : 'No previous changes on this page.';

  // Build a synthetic first turn: user asks, we pre-supply extract_dom result
  const syntheticExtractId = 'extract_dom_init';
  return [
    {
      role: 'user',
      content: `Page URL: ${session.url}\n\n${appliedSummary}${fingerprintWarning}\n\nUser request: "${prompt}"\n\nI have already called extract_dom for you. The result is provided below.`,
    },
    {
      role: 'assistant',
      content: [
        {
          type: 'tool_use',
          id: syntheticExtractId,
          name: 'extract_dom',
          input: {},
        },
      ],
    },
    {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: syntheticExtractId,
          content: JSON.stringify(domSnapshot),
        },
      ],
    },
  ];
}

// ─── Context compaction ───────────────────────────────────────────────────────

// Layer 2: rough token estimator (1 token ≈ 4 chars)
function estimateTokens(messages) {
  return Math.ceil(JSON.stringify(messages).length / 4);
}

// Helper: get the last N assistant turns + their following user messages
function getLastNTurns(messages, n) {
  const assistantIndices = messages
    .map((m, i) => (m.role === 'assistant' ? i : -1))
    .filter(i => i >= 0);
  if (assistantIndices.length <= n) return messages;
  const startIdx = assistantIndices[assistantIndices.length - n];
  return messages.slice(startIdx);
}

// Layer 1: strip bulk from old tool results (free, no API call)
function pruneOldToolResults(messages) {
  const assistantIndices = messages
    .map((m, i) => (m.role === 'assistant' ? i : -1))
    .filter(i => i >= 0);

  // Index of the message at the start of the Nth-from-last turn
  const cutoff = assistantIndices.length > MICRO_COMPACT_KEEP
    ? assistantIndices[assistantIndices.length - MICRO_COMPACT_KEEP]
    : 0;

  return messages.map((msg, idx) => {
    if (idx >= cutoff) return msg; // recent turns: keep intact
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

function compressToolResultBlock(block) {
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

// Layer 3: full Claude-generated summary compact
async function compactWithClaude(messages, session, apiKey, port) {
  safePostMessage(port, { type: 'FEED_UPDATE', kind: 'thinking', text: 'Context too large — compacting…' });
  console.log('[Vibe BG] Running full compact with Claude');

  const recentTurns = getLastNTurns(messages, FULL_COMPACT_KEEP);
  const compactPrompt = buildCompactPrompt(messages, session);

  let summary;
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'prompt-caching-2024-07-31',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2048,
        system: COMPACT_SYSTEM,
        messages: [{ role: 'user', content: compactPrompt }],
      }),
    });

    if (!response.ok) throw new Error(`Compact API error ${response.status}`);
    const data = await response.json();
    const raw = data.content[0].text;

    // Extract <summary>...</summary> block; fall back to full text
    const match = raw.match(/<summary>([\s\S]*?)<\/summary>/);
    summary = match ? match[1].trim() : raw.trim();
  } catch (err) {
    console.warn('[Vibe BG] Compact API call failed:', err.message);
    // Fallback: hard truncate to last N turns
    safePostMessage(port, { type: 'FEED_UPDATE', kind: 'thinking', text: 'Compact failed — truncating history.' });
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

  safePostMessage(port, { type: 'FEED_UPDATE', kind: 'thinking', text: 'Context compacted.' });
  console.log(`[Vibe BG] Compacted from ${messages.length} → ${compacted.length} messages`);
  return compacted;
}

function buildCompactPrompt(messages, session) {
  // Serialize only text-readable content (skip large tool_result blobs already pruned)
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

// ─── Main agentic loop ────────────────────────────────────────────────────────
async function agentLoop(messages, session, port, url, apiKey, prompt) {
  let turnCount = 0;
  let selectorFailures = 0;
  const MAX_TURNS = 25;

  // MV3 service workers are killed after ~30s of inactivity.
  // A chrome.storage read every 20s resets the idle timer, keeping us alive
  // for the full duration of a multi-turn session.
  const keepAlive = setInterval(() => chrome.storage.local.get('_ping', () => {}), 20_000);

  try {
  while (turnCount < MAX_TURNS) {
    turnCount++;
    console.log(`[Vibe BG] Turn ${turnCount}`);

    // Layer 1: always prune old tool result bulk (free)
    messages = pruneOldToolResults(messages);

    // Layer 2+3: check token budget, compact if needed
    const estimated = estimateTokens(messages);
    console.log(`[Vibe BG] Estimated tokens: ${estimated}`);
    if (estimated > COMPACT_THRESHOLD) {
      messages = await compactWithClaude(messages, session, apiKey, port);
    }

    safePostMessage(port, { type: 'FEED_UPDATE', kind: 'thinking', text: `Turn ${turnCount}…` });

    const response = await callAPI(messages, apiKey);
    console.log('[Vibe BG] stop_reason:', response.stop_reason);

    // Extract any text thinking to show in feed
    const textBlocks = response.content.filter(b => b.type === 'text');
    if (textBlocks.length > 0) {
      const thinking = textBlocks.map(b => b.text).join(' ').slice(0, 120);
      safePostMessage(port, { type: 'FEED_UPDATE', kind: 'thinking', text: thinking });
    }

    // If Claude stopped naturally without tool use
    if (response.stop_reason !== 'tool_use') {
      safePostMessage(port, { type: 'SESSION_FAILED', reason: 'Agent stopped without completing (no tool_use). Last response: ' + (textBlocks[0]?.text || '(empty)') });
      return;
    }

    const toolUseBlocks = response.content.filter(b => b.type === 'tool_use');
    const toolResults = [];
    let sessionDone = false;

    for (const block of toolUseBlocks) {
      console.log(`[Vibe BG] Tool call: ${block.name}`, block.input);
      safePostMessage(port, { type: 'FEED_UPDATE', kind: 'tool', tool: block.name });

      // Handle 'done' — exit immediately
      if (block.name === 'done') {
        const { summary, confidence, css, js } = block.input;
        // Enforce confidence minimum
        if (confidence < 70) {
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: JSON.stringify({ error: 'confidence too low — must be >= 70. Keep iterating.' }),
          });
          continue;
        }
        // Save current state to history before overwriting
        if (session.css || session.js) {
          if (!session.history) session.history = [];
          const lastApplied = session.applied[session.applied.length - 1];
          session.history.push({
            css: session.css,
            js: session.js,
            intent: lastApplied?.intent || 'Previous version',
            timestamp: new Date().toISOString(),
          });
          if (session.history.length > 10) session.history.shift();
        }
        // Persist and report
        session.css = css;
        session.js  = js;
        session.applied.push({ intent: prompt, selector: '(see css/js)', method: css ? 'css' : 'js', dynamic: false });
        session.conversationHistory = messages;
        await persistSession(url, session);
        safePostMessage(port, { type: 'FEED_UPDATE', kind: 'done', text: summary, confidence });
        safePostMessage(port, { type: 'SESSION_DONE', summary, confidence, css, js });
        sessionDone = true;
        break;
      }

      // Handle 'ask_user'
      if (block.name === 'ask_user') {
        const { question, options } = block.input;
        safePostMessage(port, { type: 'FEED_UPDATE', kind: 'question', text: question });
        let answer;
        try {
          answer = await toolAskUser(block.id, question, options || [], port);
        } catch {
          toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify({ error: 'User did not respond' }) });
          continue;
        }
        toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify({ answer }) });
        continue;
      }

      // DOM tools — dispatch to content script
      let result;
      try {
        result = await dispatchToolExec(block.name, block.input, port);
      } catch (err) {
        toolResults.push({ type: 'tool_result', tool_use_id: block.id, is_error: true, content: err.message });
        continue;
      }

      // Track query_selector failures
      if (block.name === 'query_selector') {
        if (result.count === 0) {
          selectorFailures++;
          console.log(`[Vibe BG] Selector failures: ${selectorFailures}`);
          if (selectorFailures >= 3) {
            // Inject a hint to ask the user
            result._hint = 'You have failed to find this selector 3 times. Consider calling ask_user to get more details from the user about the target element.';
          }
        } else {
          selectorFailures = 0;
        }
      }

      toolResults.push({
        type: 'tool_result',
        tool_use_id: block.id,
        content: JSON.stringify(result),
      });
    }

    if (sessionDone) return;

    // Append this turn to message history
    messages.push({ role: 'assistant', content: response.content });
    messages.push({ role: 'user', content: toolResults });
  }

  // 25 turns exceeded
  console.log('[Vibe BG] Max turns reached');
  safePostMessage(port, { type: 'SESSION_FAILED', reason: 'Reached 25 turns without completing. Partial changes may have been applied.' });
  } finally {
    clearInterval(keepAlive);
  }
}

// ─── Cached system prompt and tools (built once, reused every call) ──────────
const CACHED_SYSTEM = [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }];
const CACHED_TOOLS = [
  ...TOOL_DEFINITIONS.slice(0, -1),
  { ...TOOL_DEFINITIONS.at(-1), cache_control: { type: 'ephemeral' } },
];

// ─── Cached compaction system prompt (static instructions for Haiku summarizer) ─
const COMPACT_SYSTEM = [{
  type: 'text',
  text: 'You are summarizing a browser page modification agent session. First think inside <analysis> tags, then write your summary inside <summary> tags. The summary REPLACES the full conversation — make it complete enough for the agent to continue. Do not use tool calls. Text only.',
  cache_control: { type: 'ephemeral' },
}];

// ─── Cache breakpoint helper ──────────────────────────────────────────────────
// Stamps a cache_control marker on the second-to-last message so all prior
// conversation history (DOM snapshot + tool turns) is treated as a cached prefix.
// Only the current (last) user message is billed at full price each turn.
function addCacheBreakpoint(messages) {
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
async function callAPI(messages, apiKey) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'prompt-caching-2024-07-31',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
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

// ─── DOM tool RPC (dispatches to content.js) ──────────────────────────────────
function dispatchToolExec(name, input, port) {
  const execId = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    pendingToolExecs.set(execId, { resolve, reject });
    safePostMessage(port, { type: 'TOOL_EXEC', execId, name, input });
    // Timeout for check_dynamic (3s watch + buffer)
    const timeout = name === 'check_dynamic' ? 8000 : 10000;
    setTimeout(() => {
      if (pendingToolExecs.has(execId)) {
        pendingToolExecs.delete(execId);
        reject(new Error(`Tool exec timed out: ${name}`));
      }
    }, timeout);
  });
}

// ─── ask_user — pauses loop until user answers ────────────────────────────────
function toolAskUser(toolUseId, question, options, port) {
  return new Promise((resolve, reject) => {
    pendingUserAnswers.set(toolUseId, { resolve, reject });
    safePostMessage(port, { type: 'ASK_USER', toolUseId, question, options });
    // Timeout after 5 minutes
    setTimeout(() => {
      if (pendingUserAnswers.has(toolUseId)) {
        pendingUserAnswers.delete(toolUseId);
        reject(new Error('ask_user timed out — no response from user'));
      }
    }, 300000);
  });
}

// ─── Persist session ──────────────────────────────────────────────────────────
async function persistSession(url, session) {
  // Prune bulk tool results before writing to local storage
  const toPersist = {
    ...session,
    conversationHistory: pruneOldToolResults(session.conversationHistory || []),
  };
  await new Promise(r => chrome.storage.local.set({ [`vibe::${url}`]: toPersist }, r));
  console.log('[Vibe BG] Session persisted for:', url);
}

// ─── Safe port post ───────────────────────────────────────────────────────────
function safePostMessage(port, msg) {
  try {
    port.postMessage(msg);
  } catch (e) {
    console.warn('[Vibe BG] Could not post message (port closed):', e.message);
  }
}
