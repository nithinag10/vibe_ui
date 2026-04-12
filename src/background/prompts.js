import { CONFIG } from '../shared/config.js';

// ─── Tool definitions ─────────────────────────────────────────────────────────
export const TOOL_DEFINITIONS = [
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
    description: `End the session successfully. confidence MUST be >= ${CONFIG.agent.confidenceThreshold} — if not, keep iterating. css and js must be the COMPLETE accumulated final state, not just the delta.`,
    input_schema: {
      type: 'object',
      properties: {
        summary:    { type: 'string',  description: 'Short description of what was done' },
        confidence: { type: 'integer', minimum: CONFIG.agent.confidenceThreshold, maximum: 100, description: `How confident the change is correct (0-100). Must be >= ${CONFIG.agent.confidenceThreshold} to call done.` },
        css:        { type: 'string',  description: 'Complete final injected CSS' },
        js:         { type: 'string',  description: 'Complete final injected JS' },
      },
      required: ['summary', 'confidence', 'css', 'js'],
    },
  },
];

export const SYSTEM_PROMPT = `You are a browser page modifier agent. You modify how web pages look and behave using natural language instructions.

Follow this loop strictly:
1. extract_dom — understand the page structure (call exactly once per session start)
2. query_selector — verify your intended CSS selector actually matches elements
3. check_dynamic — if the site is a SPA (YouTube, Twitter, etc.), check if the element is dynamically rendered
4. apply_changes — inject CSS (preferred) or JS
5. query_selector again — verify the change took effect
6. done — only when confident (>= ${CONFIG.agent.confidenceThreshold})

Rules:
- NEVER call apply_changes without a preceding successful query_selector (count > 0)
- confidence < ${CONFIG.agent.confidenceThreshold} → do NOT call done, keep iterating and trying different approaches
- After apply_changes, always verify with query_selector or visual confirmation
- If apply_changes succeeds but element is still visible → switch to a JS approach (MutationObserver, setInterval) instead of CSS
- The css and js fields in done must be the COMPLETE accumulated final state — not just the new delta
- Use CSS !important to override page styles
- For dynamic SPAs: wrap JS in MutationObserver or setInterval to catch elements that load after paint
- Use ask_user only when genuinely ambiguous (>3 vague matches, multiple identical-looking elements, contradicting intent)
- Do NOT ask about standard well-known elements (YouTube shorts shelf, Twitter sidebar, etc.) — just attempt them`;

// ─── Cached system prompt and tools (built once, reused every call) ──────────
export const CACHED_SYSTEM = [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }];
export const CACHED_TOOLS = [
  ...TOOL_DEFINITIONS.slice(0, -1),
  { ...TOOL_DEFINITIONS.at(-1), cache_control: { type: 'ephemeral' } },
];

// ─── Compaction system prompt ────────────────────────────────────────────────
export const COMPACT_SYSTEM = [{
  type: 'text',
  text: 'You are summarizing a browser page modification agent session. First think inside <analysis> tags, then write your summary inside <summary> tags. The summary REPLACES the full conversation — make it complete enough for the agent to continue. Do not use tool calls. Text only.',
  cache_control: { type: 'ephemeral' },
}];
