# Architecture

Vibe is a Chrome MV3 extension with three contexts that communicate via Chrome messaging ports.

## Contexts

```
┌──────────────┐     chrome.runtime.connect     ┌──────────────────┐
│  Content      │ ◄──────── port ──────────────► │  Background       │
│  Script       │   TOOL_EXEC / TOOL_RESULT      │  Service Worker   │
│  (page DOM)   │   ASK_USER / ASK_USER_ANSWER   │  (Claude API)     │
└──────────────┘   FEED_UPDATE / SESSION_*       └──────────────────┘
                                                         │
       ┌──────────┐                                      │  HTTP
       │  Popup   │  chrome.storage.local                ▼
       │  (API    │◄────────────────────────►   Anthropic API
       │   key)   │
       └──────────┘
```

**Content script** — injected into every page. Owns the Vibe button, modal UI, and tool execution (DOM reads, CSS/JS injection). Cannot make cross-origin HTTP requests.

**Background service worker** — runs the agentic loop. Calls the Anthropic API, manages conversation history, handles context compaction, and dispatches tool calls to the content script via port messages.

**Popup** — minimal UI for entering and storing the API key in `chrome.storage.local`.

## Data Flow: A Vibe Request

1. User clicks the Vibe button → modal opens → user types a prompt
2. Content script opens a port to background, sends `SESSION_START` with prompt and URL
3. Background loads the API key and any existing session from storage
4. Background dispatches `extract_dom` tool to content script, gets DOM snapshot back
5. Background calls the Anthropic API with system prompt, tool definitions, and user message
6. Claude responds with tool calls → background dispatches each to content via `TOOL_EXEC`
7. Content executes tools in page context, returns `TOOL_RESULT`
8. Loop continues (up to 25 turns) until Claude sends a `done` signal or max turns reached
9. Background persists session (CSS, JS, history) to `chrome.storage.local`
10. On page reload, content script restores saved CSS/JS from storage

## Module Boundaries

### Shared (`src/shared/`)

Modules imported by both background and content bundles. esbuild inlines them into each output file at build time — no runtime sharing.

- **config.js** — all hardcoded values in one place. Frozen `DEFAULT_CONFIG` with sections: models, api, agent, compaction, dom, timeouts. Supports user overrides via `chrome.storage.local` key `vibe::config`.
- **messages.js** — message type constants (`MSG.TOOL_EXEC`, etc.) and factory functions. Serves as protocol documentation.
- **storage.js** — thin Promise wrappers around `chrome.storage.local`.

### Background (`src/background/`)

- **main.js** — entry point. Listens for port connections, routes messages.
- **agent-loop.js** — `agentLoop()` and `startAgentLoop()`. The core loop that calls the API, processes tool use blocks, handles compaction triggers, and detects end conditions.
- **api.js** — `callAPI()` encapsulates all Anthropic HTTP details (headers, body shape, error handling). `addCacheBreakpoint()` stamps prompt caching hints.
- **compaction.js** — three layers of context management: (1) prune old tool results, (2) token estimation, (3) Claude Haiku summarization when tokens exceed threshold.
- **tool-dispatch.js** — UUID-based RPC. `dispatchToolExec()` sends a tool call to content and returns a Promise that resolves when content replies. `toolAskUser()` pauses for user input. `cleanup()` rejects all pending on port disconnect.
- **session.js** — `persistSession()` writes session state to storage.
- **prompts.js** — system prompt, tool definitions array, compaction prompt.

### Content (`src/content/`)

- **main.js** — entry point (async IIFE). Injects the button, restores saved vibes on load.
- **button.js** — creates and injects the floating Vibe button.
- **message-handler.js** — routes incoming port messages (tool exec, feed updates, ask-user, session done/failed).
- **modal/** — UI decomposed into templates (pure HTML-returning functions), actions (event wiring), feed (activity rendering), and question (ask-user panel).
- **tools/** — each tool is a `{ definition, execute }` object. The registry imports all tools and exports `execTool(name, input)` for dispatch and `TOOL_DEFINITIONS` for the API.

## Tool System

Tools follow a simple pattern — one file, one export:

```javascript
export const myTool = {
  definition: {
    name: 'my_tool',
    description: '...',
    input_schema: { type: 'object', properties: { ... }, required: [...] },
  },
  execute: async (input) => { /* runs in page context */ },
};
```

The registry (`tools/registry.js`) imports all tools, builds a `Map` for O(1) lookup, and exports the definitions array for the API. Adding a tool requires: create the file, register it, add it to the system prompt, write a test.

## Context Compaction

When conversation history grows large, three layers activate:

1. **Prune old tool results** — strips bulk from `extract_dom` and `query_selector` results older than the last N turns
2. **Token estimation** — `estimateTokens()` checks if we're approaching the threshold
3. **Claude summarization** — sends the conversation to Claude Haiku to produce a compact summary, replacing the full history

## Build

esbuild bundles `src/` into `dist/` with three entry points. Output format is IIFE (required for MV3 content scripts which cannot use ES modules). Static assets (manifest, HTML, icons, CSS) are copied to `dist/`. Chrome loads the extension from `dist/`.
