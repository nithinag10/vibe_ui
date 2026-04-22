import { CONFIG } from '../shared/config.js';
import { createSessionDone, createSessionFailed, createFeedUpdate } from '../shared/messages.js';
import { storageGet, sessionKey } from '../shared/storage.js';
import { callAPI } from './api.js';
import { estimateTokens, pruneOldToolResults, compactWithClaude } from './compaction.js';
import { dispatchToolExec, toolAskUser, safePostMessage } from './tool-dispatch.js';
import { persistSession } from './session.js';

// ─── Start agent loop ────────────────────────────────────────────────────────
export async function startAgentLoop({ prompt, url }, port) {
  const apiKey = await storageGet('apiKey');
  if (!apiKey) throw new Error('No API key. Open the Vibe popup and save your Anthropic key.');

  const storedSession = await storageGet(sessionKey(url));

  const session = storedSession || {
    url,
    css: '',
    js: '',
    applied: [],
    conversationHistory: [],
  };

  // Map the page at session start so the model has framework detection,
  // semantic landmarks, top-level sections, and iframes in context before
  // turn 1. The framework field also feeds the system-prompt guardrail.
  const map = await dispatchToolExec('map_page', {}, port);
  console.log(`[Vibe BG] map_page init → framework=${map?.framework} totalElements=${map?.totalElements} iframes=${Array.isArray(map?.iframes) ? map.iframes.length : 0}`);
  const messages = buildInitialMessages(prompt, session, map);
  await agentLoop(messages, session, port, url, apiKey, prompt, map?.framework);
}

function buildInitialMessages(prompt, session, map) {
  if (session.conversationHistory && session.conversationHistory.length > 0) {
    return [...session.conversationHistory, { role: 'user', content: `New request: ${prompt}` }];
  }

  const recentApplied = (session.applied || []).slice(-5);
  const appliedSummary = recentApplied.length
    ? 'Previously applied on this page (most recent 5):\n' + recentApplied.map(a => `- ${a.intent} (method: ${a.method})`).join('\n')
    : 'No previous changes on this page.';

  const syntheticId = 'map_page_init';
  return [
    {
      role: 'user',
      content: `Page URL: ${session.url}\n\n${appliedSummary}\n\nUser request: "${prompt}"\n\nI have already called map_page for you — the result is below. Use the semantic selectors as anchors, then confirm_selector before apply_changes.`,
    },
    {
      role: 'assistant',
      content: [{ type: 'tool_use', id: syntheticId, name: 'map_page', input: {} }],
    },
    {
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: syntheticId, content: JSON.stringify(map) },
      ],
    },
  ];
}

// ─── Main agentic loop ───────────────────────────────────────────────────────
async function agentLoop(messages, session, port, url, apiKey, prompt, framework) {
  let turnCount = 0;
  let selectorFailures = 0;
  // Selectors the agent has confirmed in this session with verdict === 'good'.
  // apply_changes is refused if any selector in its CSS isn't in this set.
  const confirmedSelectors = new Set();
  // Rolling window of the last N tool-call signatures (name + JSON input).
  // If the next call matches twice already seen, we force an ask_user escalation.
  let recentCalls = [];

  const keepAlive = setInterval(() => chrome.storage.local.get('_ping', () => {}), CONFIG.timeouts.keepAlivePing);

  try {
  while (turnCount < CONFIG.agent.maxTurns) {
    turnCount++;
    console.log(`[Vibe BG] Turn ${turnCount}`);

    messages = pruneOldToolResults(messages);

    const estimated = estimateTokens(messages);
    console.log(`[Vibe BG] Estimated tokens: ${estimated}`);
    if (estimated > CONFIG.compaction.tokenThreshold) {
      messages = await compactWithClaude(messages, session, apiKey, port);
    }

    safePostMessage(port, createFeedUpdate('thinking', { text: `Turn ${turnCount}…` }));

    const response = await callAPI(messages, apiKey, { framework });
    console.log('[Vibe BG] stop_reason:', response.stop_reason);

    const textBlocks = response.content.filter(b => b.type === 'text');
    if (textBlocks.length > 0) {
      const thinking = textBlocks.map(b => b.text).join(' ').slice(0, 120);
      safePostMessage(port, createFeedUpdate('thinking', { text: thinking }));
    }

    if (response.stop_reason !== 'tool_use') {
      safePostMessage(port, createSessionFailed('Agent stopped without completing (no tool_use). Last response: ' + (textBlocks[0]?.text || '(empty)')));
      return;
    }

    const toolUseBlocks = response.content.filter(b => b.type === 'tool_use');
    const toolResults = [];
    let sessionDone = false;

    for (const block of toolUseBlocks) {
      console.log(`[Vibe BG] Tool call: ${block.name}`, block.input);
      safePostMessage(port, createFeedUpdate('tool', { tool: block.name }));

      if (block.name === 'done') {
        const { summary, confidence, css, js } = block.input;
        if (session.css || session.js) {
          if (!session.history) session.history = [];
          const lastApplied = session.applied[session.applied.length - 1];
          session.history.push({
            css: session.css,
            js: session.js,
            intent: lastApplied?.intent || 'Previous version',
            timestamp: new Date().toISOString(),
          });
          if (session.history.length > CONFIG.agent.maxHistorySnapshots) session.history.shift();
        }
        session.css = css;
        session.js  = js;
        session.applied.push({ intent: prompt, method: css ? (js ? 'css+js' : 'css') : 'js' });
        session.conversationHistory = messages;
        await persistSession(url, session);
        safePostMessage(port, createFeedUpdate('done', { text: summary, confidence }));
        safePostMessage(port, createSessionDone(summary, confidence, css, js));
        sessionDone = true;
        break;
      }

      if (block.name === 'ask_user') {
        const { question, options } = block.input;
        safePostMessage(port, createFeedUpdate('question', { text: question }));
        let answer;
        try {
          answer = await toolAskUser(block.id, question, options || [], port);
        } catch {
          toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify({ error: 'User did not respond' }) });
          continue;
        }
        toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify({ answer }) });
        recentCalls = [];
        continue;
      }

      // ── Stuck-loop guard ──────────────────────────────────────────────────
      // If the model is about to repeat a call it has already made twice in
      // the last N turns, don't dispatch — force an ask_user escalation. This
      // catches dead inspection loops that would otherwise burn all 25 turns.
      const sig = block.name + ':' + stableHash(block.input);
      const repeats = recentCalls.filter(h => h === sig).length;
      if (repeats >= CONFIG.agent.stuckLoopThreshold - 1) {
        console.log(`[Vibe BG] stuck-loop: sig=${sig.slice(0, 120)} repeats=${repeats + 1} → forcing ask_user`);
        const escalation = `I've tried the same ${block.name} call ${repeats + 1} times in a row without progress. Can you help me narrow down? Right-click the element you want changed, pick "Inspect" in the browser devtools, and tell me the tag + id + a class you see.`;
        safePostMessage(port, createFeedUpdate('question', { text: escalation }));
        let answer;
        try {
          answer = await toolAskUser(block.id, escalation, [], port);
        } catch {
          toolResults.push({ type: 'tool_result', tool_use_id: block.id, is_error: true, content: 'Stuck-loop escalation timed out without a user response.' });
          recentCalls = [];
          continue;
        }
        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: JSON.stringify({ forcedEscalation: true, reason: 'repeated_identical_call', userAnswer: answer }),
        });
        recentCalls = [];
        continue;
      }
      recentCalls.push(sig);
      if (recentCalls.length > CONFIG.agent.stuckLoopWindow) recentCalls.shift();

      // ── confirm_selector hard gate before apply_changes ───────────────────
      if (block.name === 'apply_changes') {
        const missing = unconfirmedSelectors(block.input?.css || '', confirmedSelectors);
        if (missing.length > 0) {
          const hint = `Refusing apply_changes — these selectors have not been confirmed "good" yet: ${JSON.stringify(missing)}. Call confirm_selector on each before applying. If confirm_selector returns 'empty' or 'too-broad', fix the selector before retrying.`;
          console.log('[Vibe BG] apply_changes gate blocked', missing);
          toolResults.push({ type: 'tool_result', tool_use_id: block.id, is_error: true, content: hint });
          continue;
        }
      }

      let result;
      try {
        result = await dispatchToolExec(block.name, block.input, port);
      } catch (err) {
        toolResults.push({ type: 'tool_result', tool_use_id: block.id, is_error: true, content: err.message });
        continue;
      }

      // Record confirmed selectors so apply_changes can be gated against them.
      if (block.name === 'confirm_selector' && result?.verdict === 'good' && block.input?.selector) {
        const normalized = normalizeSelector(block.input.selector);
        confirmedSelectors.add(normalized);
        console.log(`[Vibe BG] confirmed selector added: "${normalized}" (matchCount=${result.matchCount}) — set size=${confirmedSelectors.size}`);
      } else if (block.name === 'confirm_selector' && result?.verdict) {
        console.log(`[Vibe BG] confirm_selector verdict=${result.verdict} selector="${block.input?.selector}" — NOT gated (need "good")`);
      }

      // Track failed inspect attempts so we can nudge toward ask_user after repeated misses.
      if (block.name === 'inspect' && result?.total === 0 && (block.input?.selector || block.input?.text || block.input?.regex)) {
        selectorFailures++;
        console.log(`[Vibe BG] Inspect zero-match count: ${selectorFailures}`);
        if (selectorFailures >= CONFIG.agent.selectorFailureHintAt) {
          result._hint = 'You have found zero matches multiple times in a row. Switch modes (text or regex), call capture to see the page, or ask_user for clarification.';
        }
      } else if (block.name === 'inspect') {
        selectorFailures = 0;
      }

      toolResults.push(buildToolResultBlock(block.id, result));
    }

    if (sessionDone) return;

    messages.push({ role: 'assistant', content: response.content });
    messages.push({ role: 'user', content: toolResults });
  }

  console.log('[Vibe BG] Max turns reached');
  safePostMessage(port, createSessionFailed(`Reached ${CONFIG.agent.maxTurns} turns without completing. Partial changes may have been applied.`));
  } finally {
    clearInterval(keepAlive);
  }
}

// Tool results are normally JSON-stringified. If a tool returns a multimodal
// payload (e.g. capture), pass its pre-built content-block array through so
// the model receives an actual image block.
function buildToolResultBlock(toolUseId, result) {
  if (result && result._multimodal && Array.isArray(result.content)) {
    return { type: 'tool_result', tool_use_id: toolUseId, content: result.content };
  }
  return { type: 'tool_result', tool_use_id: toolUseId, content: JSON.stringify(result) };
}

// ─── Helpers: selector gate + stuck-loop hashing ────────────────────────────
// Selectors are normalized before set membership so trivial whitespace diffs
// don't bypass the gate. Stable hash on tool input is a sorted-key JSON string.
export function normalizeSelector(sel) {
  return String(sel).trim().replace(/\s+/g, ' ').replace(/\s*!important/gi, '');
}

export function extractCssSelectors(css) {
  if (!css || typeof css !== 'string') return [];
  const out = new Set();
  const rulePattern = /([^{}]+)\{[^}]*\}/g;
  let m;
  while ((m = rulePattern.exec(css)) !== null) {
    const selectorList = m[1].trim();
    if (!selectorList || selectorList.startsWith('@')) continue;
    for (const raw of selectorList.split(',')) {
      const cleaned = normalizeSelector(raw);
      if (cleaned) out.add(cleaned);
    }
  }
  return [...out];
}

export function unconfirmedSelectors(css, confirmedSet) {
  return extractCssSelectors(css).filter(s => !confirmedSet.has(s));
}

function stableHash(obj) {
  try {
    if (obj === undefined || obj === null) return '';
    if (typeof obj !== 'object') return JSON.stringify(obj);
    const keys = Object.keys(obj).sort();
    const shallow = {};
    for (const k of keys) shallow[k] = obj[k];
    return JSON.stringify(shallow);
  } catch {
    return '';
  }
}
