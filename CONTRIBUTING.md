# Contributing to Vibe

Thanks for your interest in contributing! Vibe is a Chrome MV3 extension built with vanilla JS and a minimal esbuild bundler.

---

## Running Locally

1. Clone the repo:
   ```bash
   git clone https://github.com/nithinag10/vibe_ui.git
   cd vibe_ui
   ```
2. Install dependencies and build:
   ```bash
   npm install
   npm run build
   ```
3. Go to `chrome://extensions` in Chrome
4. Enable **Developer mode** (top-right toggle)
5. Click **Load unpacked** → select the `dist/` folder
6. To develop with auto-rebuild on save:
   ```bash
   npm run dev
   ```
   Then click the **refresh** icon on the extension card in Chrome after each rebuild.

You'll need your own [Anthropic API key](https://console.anthropic.com/settings/keys) to test the agent loop.

---

## Project Structure

```
src/
  shared/              Shared between background and content bundles
    config.js            Centralized configuration (all magic numbers)
    messages.js          Message type constants and factory functions
    storage.js           chrome.storage.local helpers
  background/          Service worker bundle
    main.js              Entry point — port connection and message routing
    agent-loop.js        Claude agentic loop (up to 25 turns)
    api.js               Anthropic API HTTP details
    compaction.js        Context compaction (3 layers)
    tool-dispatch.js     Tool execution RPC and ask-user flow
    session.js           Session persistence
    prompts.js           System prompt and tool definitions
  content/             Content script bundle
    main.js              Entry point — button injection, vibe application
    button.js            The Vibe button
    helpers.js           Utility functions (hash, escaping, formatting)
    vibe.css             All styles (CSS custom properties, __vibe_ prefixed)
    message-handler.js   Handles messages from background
    modal/
      modal.js           Modal orchestrator
      templates.js       Pure functions returning HTML strings
      actions.js         Event handler wiring (undo, reset, close, etc.)
      feed.js            Agent activity feed rendering
      question.js        Ask-user question panel
    tools/
      registry.js        Tool dispatcher and definitions export
      extract-dom.js     DOM snapshot extraction
      query-selector.js  Selector validation
      check-dynamic.js   SPA detection via MutationObserver
      apply-changes.js   CSS/JS injection
  popup/
    popup.js             API key management
tests/                 Vitest test suites
dist/                  Built output (gitignored, loaded by Chrome)
```

---

## Key Concepts

- **Agent loop** (`agent-loop.js`) — up to 25 turns; Claude calls tools, content.js executes them in the page context and returns results via Chrome messaging port
- **Tool dispatch** — background sends `TOOL_EXEC` messages; content executes and replies with `TOOL_RESULT`
- **Session persistence** — stored in `chrome.storage.local` keyed as `vibe::<url>`, includes CSS, JS, version history, and conversation history
- **Context compaction** — Layer 1 prunes old tool results; Layer 3 calls Claude Haiku to summarize if tokens exceed threshold
- **Message protocol** — all messages use type constants from `shared/messages.js` with factory functions

---

## Adding a New Tool

This is the most common contribution. Each tool is a single file:

1. **Create** `src/content/tools/my-tool.js`:
   ```javascript
   export const myTool = {
     definition: {
       name: 'my_tool',
       description: 'What this tool does and when Claude should use it.',
       input_schema: {
         type: 'object',
         properties: {
           param: { type: 'string', description: 'What this param is for' },
         },
         required: ['param'],
       },
     },
     execute: async ({ param }) => {
       // Tool logic runs in the page context
       return { result: 'something useful' };
     },
   };
   ```

2. **Register** in `src/content/tools/registry.js`:
   ```javascript
   import { myTool } from './my-tool.js';

   const TOOLS = [
     // ... existing tools
     myTool,
   ];
   ```

3. **Add to system prompt** in `src/background/prompts.js` — tell Claude when to use the tool

4. **Add a test** in `tests/content/tools/my-tool.test.js`

5. Build and verify: `npm run build && npm run test && npm run lint`

---

## Making Other Changes

- **CSS/UI changes**: edit `src/content/vibe.css` or templates in `src/content/modal/templates.js`
- **System prompt**: edit `SYSTEM_PROMPT` in `src/background/prompts.js`
- **Configuration**: edit defaults in `src/shared/config.js`
- **Model**: change `CONFIG.models.agent` in `src/shared/config.js`

---

## Scripts

| Command | Description |
|---------|-------------|
| `npm run build` | Build to `dist/` |
| `npm run dev` | Build + watch for changes |
| `npm run test` | Run test suite |
| `npm run test:watch` | Run tests in watch mode |
| `npm run lint` | Check for lint errors |
| `npm run lint:fix` | Auto-fix lint errors |

---

## Pull Request Guidelines

- Describe **what** changed and **why**
- For UI changes, attach a before/after screenshot
- Keep PRs focused — one thing at a time
- Don't add telemetry or external services beyond the Anthropic API
- CI runs lint, build, and tests — all must pass

---

## Reporting Bugs

Use the [bug report template](.github/ISSUE_TEMPLATE/bug_report.md). Include the URL where it broke, the Chrome console errors, and exactly what you asked Vibe to do.
