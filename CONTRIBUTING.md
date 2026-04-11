# Contributing to Vibe

Thanks for your interest in contributing! Vibe is a vanilla JS Chrome extension — no build step, no framework, no bundler. Keep it that way.

---

## Running Locally

1. Clone the repo:
   ```bash
   git clone https://github.com/your-username/vibe.git
   ```
2. Go to `chrome://extensions` in Chrome
3. Enable **Developer mode** (top-right toggle)
4. Click **Load unpacked** → select the repo folder
5. To test changes: edit a file → click the **↺ refresh** icon on the extension card

You'll need your own [Anthropic API key](https://console.anthropic.com/settings/keys) to test the agent loop.

---

## Project Structure

| File | Role |
|------|------|
| `manifest.json` | Extension manifest (MV3) |
| `popup.html` / `popup.js` | Toolbar popup — API key input and storage |
| `content.js` | Injected into every page — the ✦ Vibe button, modal UI, and DOM tool executors |
| `background.js` | Service worker — Claude agentic loop, Anthropic API calls, context compaction |

---

## Key Concepts

- **Agent loop** (`background.js:agentLoop`) — up to 25 turns; Claude calls tools, content.js executes them in the page context and returns results via Chrome messaging port
- **Tool dispatch** — `background.js` sends `TOOL_EXEC` messages; `content.js` executes and replies with `TOOL_RESULT`
- **Session persistence** — stored in `chrome.storage.local` keyed as `vibe::<url>`, includes CSS, JS, version history, and conversation history
- **Context compaction** — Layer 1 prunes old tool results; Layer 3 calls Claude Haiku to summarize if tokens > 100k

---

## Making Changes

- **CSS/UI changes** (popup or modal): edit `popup.html` or the inline styles in `content.js:injectVibeButton` / `content.js:_openModalInner`
- **New tools**: add to `TOOL_DEFINITIONS` in `background.js` and add an executor in `content.js:execTool`
- **System prompt**: edit `SYSTEM_PROMPT` in `background.js`
- **Model**: change the `model` field in `background.js:callAPI`

---

## Pull Request Guidelines

- Describe **what** changed and **why**
- For UI changes, attach a before/after screenshot
- Keep PRs focused — one thing at a time
- Don't add a build step, bundler, or npm dependencies without discussion
- Don't add telemetry or external services beyond the Anthropic API

---

## Reporting Bugs

Use the [bug report template](.github/ISSUE_TEMPLATE/bug_report.md). Include the URL where it broke, the Chrome console errors, and exactly what you asked Vibe to do.
