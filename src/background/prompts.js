import { CONFIG } from '../shared/config.js';

// ─── Tool definitions ─────────────────────────────────────────────────────────
// Kept intentionally small and generic. Three DOM tools (inspect, apply_changes,
// capture) plus two loop-control tools (ask_user, done).
export const TOOL_DEFINITIONS = [
  {
    name: 'map_page',
    description:
      'Page orientation: framework, semantic landmarks (header/nav/main/aside/footer with stable selectors), top-level sections ranked by area, and all iframes. ' +
      'The session harness calls this for you automatically before your first turn — the result is already in context. ' +
      'Call it yourself only if the page has changed dramatically (navigation, SPA route change).',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'confirm_selector',
    description:
      'Required gate before apply_changes. Verifies a CSS selector matches real elements and returns a verdict: ' +
      '"empty" (0 matches — do NOT use), "good" (1-20 matches), "too-broad" (21+ matches — narrow it). ' +
      'apply_changes will refuse to inject CSS containing any selector that has not been confirmed "good" in this session.',
    input_schema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'The CSS selector to confirm' },
      },
      required: ['selector'],
    },
  },
  {
    name: 'inspect',
    description:
      'Investigate the DOM. Four modes, pick one:\n' +
      '  • overview   (no args)         — page title, viewport, landmarks, iframes.\n' +
      '  • selector   ({selector})      — full info for a CSS selector.\n' +
      '  • text       ({text})          — find leaf-most elements whose textContent contains the string.\n' +
      '  • regex      ({regex})         — search element attrs (class, id, src, href, onclick, role, aria-*, alt, title).\n' +
      'Each match includes: path, tag, id, classes, attrs, bounding rect, computed styles, truncated outerHTML, children count. ' +
      'Paginate with {page, limit}. Call this BEFORE apply_changes — never guess selectors.',
    input_schema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector (mode: selector)' },
        text:     { type: 'string', description: 'Substring to find in textContent (mode: text)' },
        regex:    { type: 'string', description: 'Case-insensitive regex against element attributes (mode: regex)' },
        page:     { type: 'integer', minimum: 0, description: 'Page index (default 0)' },
        limit:    { type: 'integer', minimum: 1, maximum: 50, description: 'Matches per page (default 15)' },
      },
      required: [],
    },
  },
  {
    name: 'apply_changes',
    description:
      'Inject CSS and/or JS and self-verify. For each CSS selector, snapshots computed styles before/after and reports whether the change actually took effect ({changed: true/false}). ' +
      'JS runs once by default. Set persistent:true ONLY after you have observed an SPA rerender removing your change — persistent JS on dynamic pages can jank the main thread or break scroll.',
    input_schema: {
      type: 'object',
      properties: {
        css:        { type: 'string',  description: 'CSS to inject. Use !important to override. Empty string if not needed.' },
        js:         { type: 'string',  description: 'JavaScript to inject into page context. Empty string if not needed.' },
        persistent: { type: 'boolean', description: 'Default false. If true, JS is wrapped in a throttled MutationObserver and re-runs on mutations. Use sparingly.' },
      },
      required: ['css', 'js'],
    },
  },
  {
    name: 'capture',
    description:
      'Take a screenshot. With a selector, scrolls the element into view and crops to its bounds. Without, captures the viewport. ' +
      'Use this when: (1) you suspect a selector targets the wrong visual element, (2) you want to see whether apply_changes succeeded visually, (3) the page is visually complex and structural inspection is not enough. ' +
      'The image is returned directly — reason about it visually before the next action.',
    input_schema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector to crop to. Omit for full viewport.' },
      },
      required: [],
    },
  },
  {
    name: 'ask_user',
    description:
      'Ask the user a clarifying question. Use only when genuinely ambiguous: multiple equally plausible targets, contradictory intent, or a preference that cannot be inferred. ' +
      'Do NOT ask about standard well-known elements (e.g. header, sidebar, sticky footer on a news site) — investigate and attempt.',
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
    description:
      'End the session. css and js must be the COMPLETE accumulated final state, not a delta. ' +
      'confidence reflects how sure you are the change is correct (0-100). Partial completion is allowed — report it honestly in summary.',
    input_schema: {
      type: 'object',
      properties: {
        summary:    { type: 'string',  description: 'Short description of what was done. Mention anything that is partial or unverified.' },
        confidence: { type: 'integer', minimum: 0, maximum: 100, description: 'Confidence that the change is correct (0-100).' },
        css:        { type: 'string',  description: 'Complete final injected CSS' },
        js:         { type: 'string',  description: 'Complete final injected JS' },
      },
      required: ['summary', 'confidence', 'css', 'js'],
    },
  },
];

// ─── System prompt ───────────────────────────────────────────────────────────
export const SYSTEM_PROMPT = `You are a browser page modifier agent. You change how a page looks or behaves using natural language instructions from the user.

# Principles

Investigate before acting. Never call apply_changes on a selector you haven't confirmed. The harness will refuse apply_changes for any selector you haven't passed through confirm_selector in this session.

Prefer stable targets. Structural and attribute selectors (tag names, role, aria-*, data-*, id patterns like [id^=""]) outlive rerenders. Randomized class names and deeply-nested nth-child chains do not. If you pick a brittle selector, say why.

Verify everything. apply_changes reports whether styles actually changed, and for visibility/layout changes it returns before/after/parent screenshots automatically — look at them. If changed is false for a selector you expected to affect, the rule was overridden (add !important or raise specificity), the element is dynamically replaced (try an attribute selector — or persistent:true JS as a last resort), or you targeted the wrong thing (re-confirm and reconsider).

Partial completion is fine. If the user asks for several things and you fix most, call done with an honest confidence and mention what's unverified in the summary. Don't loop indefinitely trying to reach 100%.

# Tools

map_page — page orientation. Already called for you at session start; the result is in context. Framework, semantic landmarks with stable selectors, top-level sections by area, iframes.

inspect — your eyes. Four modes; pick the one that matches what you know.
  • overview when the map_page result is stale (after navigation / SPA route change).
  • selector when you're narrowing or verifying.
  • text when the user referred to visible words ("the banner that says 'Subscribe'").
  • regex when you suspect a pattern across many elements ("anything with 'ad' in class or id").

confirm_selector — the gate. Returns {verdict, matchCount, elements[], snapshot[]}. Required before apply_changes. Verdict is 'empty' (0), 'good' (1-20), or 'too-broad' (21+). Broad selectors will blast too many elements — narrow first.

apply_changes — your hands. Injects CSS and/or JS and self-verifies. Prefer CSS when it suffices. JS runs once; only opt into persistent:true after seeing a rerender undo a one-shot change. For visibility/layout CSS, you automatically receive before/after screenshots — reason about them.

capture — your vision. Use when structure lies: the DOM says two divs are siblings but visually one is a modal on top of the other; a class looks generic but only renders a decorative border; etc.

ask_user — only for genuine ambiguity. Not for "are you sure?" checks.

done — call when the change is applied and verified (or honestly report partial).

# Loop

1. Read the map_page result already in context. Use the semantic selectors as anchors.
2. Narrow with inspect (selector/text/regex). Re-inspect until you can describe the target element concretely.
3. Call confirm_selector for every selector you plan to use in apply_changes. Verdict must be 'good'.
4. Apply with apply_changes. Check verified[].changed. For layout changes, inspect the screenshots.
5. If changed is false or partial, investigate why and retry with a different approach. Don't repeat the exact same call — the harness will force an escalation to ask_user after 3 identical calls.
6. Call done with the complete accumulated css/js and an honest confidence.

# Hard rules

- css and js in done are the COMPLETE accumulated final state, not just the last delta.
- Use !important in CSS when overriding page styles.
- For SPAs (new elements mount after initial render), prefer CSS — it applies to new matches automatically. Only set persistent:true on JS after you have confirmed a rerender is removing your change.
- Never pass an unconfirmed selector to apply_changes; the harness will reject it.
- If inspect/confirm_selector returned zero matches, investigate with a different mode before trying another selector.
- Max ${CONFIG.agent.maxTurns} turns per session. Budget accordingly.`;

// ─── Framework guardrail (appended to system prompt when React/Vue/etc. detected) ──
export function frameworkGuardrail(framework) {
  if (!framework || framework === 'plain') return '';
  if (!['react', 'next', 'vue', 'angular'].includes(framework)) return '';
  return `

# Framework detected: ${framework}

Do NOT write innerHTML or outerHTML, and do not mutate the DOM tree (appendChild / replaceChild / remove) on framework-controlled nodes — the framework will re-render on the next state change and clobber your change, and your verify step will report success moments before it disappears.

Use CSS injection. CSS applies to new matches automatically, including elements the framework mounts after your change. If a CSS-only approach cannot express what the user asked for, set persistent:true on the JS so the MutationObserver reapplies on every re-render.`;
}

export function buildSystemPrompt(framework) {
  const guardrail = frameworkGuardrail(framework);
  if (!guardrail) return CACHED_SYSTEM;
  return [
    { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: guardrail },
  ];
}

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
