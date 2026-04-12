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
    domFingerprint: null,
  };

  let domSnapshot;
  let fingerprintWarning = '';

  if (!session.domFingerprint || session.conversationHistory?.length === 0) {
    domSnapshot = await dispatchToolExec('extract_dom', {}, port);
    session.domFingerprint = domSnapshot.fingerprint;
  } else {
    const check = await dispatchToolExec('extract_dom', {}, port);
    if (check.fingerprint !== session.domFingerprint) {
      fingerprintWarning = '\n\nWARNING: The page DOM structure has changed since your last session. Re-verify all selectors before applying — previously saved selectors may no longer work.';
      console.log('[Vibe BG] DOM fingerprint changed — warning Claude');
      session.domFingerprint = check.fingerprint;
    }
    domSnapshot = check;
  }

  const messages = buildInitialMessages(prompt, session, domSnapshot, fingerprintWarning);
  await agentLoop(messages, session, port, url, apiKey, prompt);
}

function buildInitialMessages(prompt, session, domSnapshot, fingerprintWarning) {
  if (session.conversationHistory && session.conversationHistory.length > 0) {
    const history = session.conversationHistory;
    const resumeContext = fingerprintWarning
      ? `${fingerprintWarning}\n\nNew request: ${prompt}`
      : `New request: ${prompt}`;
    return [...history, { role: 'user', content: resumeContext }];
  }

  const recentApplied = (session.applied || []).slice(-5);
  const appliedSummary = recentApplied.length
    ? 'Previously applied on this page (most recent 5):\n' + recentApplied.map(a => `- ${a.intent} (selector: ${a.selector}, method: ${a.method})`).join('\n')
    : 'No previous changes on this page.';

  const syntheticExtractId = 'extract_dom_init';
  return [
    {
      role: 'user',
      content: `Page URL: ${session.url}\n\n${appliedSummary}${fingerprintWarning}\n\nUser request: "${prompt}"\n\nI have already called extract_dom for you. The result is provided below.`,
    },
    {
      role: 'assistant',
      content: [
        { type: 'tool_use', id: syntheticExtractId, name: 'extract_dom', input: {} },
      ],
    },
    {
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: syntheticExtractId, content: JSON.stringify(domSnapshot) },
      ],
    },
  ];
}

// ─── Main agentic loop ───────────────────────────────────────────────────────
async function agentLoop(messages, session, port, url, apiKey, prompt) {
  let turnCount = 0;
  let selectorFailures = 0;

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

    const response = await callAPI(messages, apiKey);
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
        if (confidence < CONFIG.agent.confidenceThreshold) {
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: JSON.stringify({ error: `confidence too low — must be >= ${CONFIG.agent.confidenceThreshold}. Keep iterating.` }),
          });
          continue;
        }
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
        session.applied.push({ intent: prompt, selector: '(see css/js)', method: css ? 'css' : 'js', dynamic: false });
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
        continue;
      }

      let result;
      try {
        result = await dispatchToolExec(block.name, block.input, port);
      } catch (err) {
        toolResults.push({ type: 'tool_result', tool_use_id: block.id, is_error: true, content: err.message });
        continue;
      }

      if (block.name === 'query_selector') {
        if (result.count === 0) {
          selectorFailures++;
          console.log(`[Vibe BG] Selector failures: ${selectorFailures}`);
          if (selectorFailures >= CONFIG.agent.selectorFailureHintAt) {
            result._hint = 'You have failed to find this selector multiple times. Consider calling ask_user to get more details from the user about the target element.';
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

    messages.push({ role: 'assistant', content: response.content });
    messages.push({ role: 'user', content: toolResults });
  }

  console.log('[Vibe BG] Max turns reached');
  safePostMessage(port, createSessionFailed(`Reached ${CONFIG.agent.maxTurns} turns without completing. Partial changes may have been applied.`));
  } finally {
    clearInterval(keepAlive);
  }
}
