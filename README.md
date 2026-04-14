# ✦ Vibe

**Customize any webpage with natural language. Powered by Claude.**

Vibe is a Chrome extension that lets you describe changes to any page in plain English — hide elements, restyle sections, tweak layouts — and Claude figures out the CSS/JS to make it happen. Changes persist per URL, so every visit loads your customized version.

> **Demo:**
>
> [![Watch the demo](https://drive.google.com/thumbnail?id=1tA4w1ZZwCZE7bbPnhiRHPSmfgFeUIC1D)](https://drive.google.com/file/d/1tA4w1ZZwCZE7bbPnhiRHPSmfgFeUIC1D/view?usp=sharing)
>
> Click the thumbnail above to watch the demo video.

---

## Features

- **Natural language edits** — "hide the shorts shelf", "make the sidebar dark", "increase font size"
- **Persists per URL** — your changes survive page refreshes and browser restarts
- **Undo & version history** — step back through up to 10 previous states
- **SPA-aware** — handles dynamically rendered pages (YouTube, Twitter, etc.) via MutationObserver
- **Iterative agent** — Claude tests selectors, verifies changes, and retries if something doesn't work
- **Clarifying questions** — asks you when your intent is ambiguous

---

## Installation

### Developer Mode (now)

1. Clone this repo:
   ```bash
   git clone https://github.com/nithinag10/vibe_ui.git
   cd vibe_ui
   npm install
   npm run build
   ```
2. Open Chrome and go to `chrome://extensions`
3. Enable **Developer mode** (toggle in the top-right)
4. Click **Load unpacked** and select the `dist/` folder
5. The ✦ Vibe icon appears in your toolbar

For development with auto-rebuild: `npm run dev`

### Chrome Web Store _(coming soon)_

---

## Setup

1. Click the ✦ Vibe icon in your toolbar
2. Paste your [Anthropic API key](https://console.anthropic.com/settings/keys) (starts with `sk-ant-`)
3. Click **Save key**

Your key is stored locally in `chrome.storage.local` and never leaves your device (except in requests to the Anthropic API).

---

## Usage

1. Visit any webpage
2. Click the **✦ Vibe** button in the bottom-right corner
3. Describe what you want to change, e.g.:
   - `hide the recommended videos sidebar`
   - `make the background dark gray and text white`
   - `remove all sponsored posts`
   - `increase the font size to 18px`
4. Press **Make it vibe →** (or ⌘+Enter)
5. Watch Claude work — it inspects the DOM, tests selectors, injects CSS/JS, and verifies the result
6. The modal closes automatically when done. Your change is saved and will reapply on every visit.

### Undo / Reset

- **↩ Undo** — reverts to the previous version
- **Reset** — removes all Vibe changes for the current URL
- **Version history** — restore any of the last 10 states

---

## How It Works

```
src/shared/       — config, message protocol, storage helpers
src/background/   — service worker: Claude agentic loop, API, context compaction
src/content/      — content script: UI, modal, DOM tools
src/popup/        — API key management
```

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full module breakdown.

When you submit a prompt, the content script opens a port to the background service worker, which runs a tool-use loop with Claude:

1. `extract_dom` — snapshots visible page elements
2. `query_selector` — tests CSS selectors against the live page
3. `check_dynamic` — detects SPA-rendered elements
4. `apply_changes` — injects CSS/JS into the page
5. `query_selector` (again) — verifies the change took effect
6. `done` — finalizes when confidence ≥ 70%

**Model:** `claude-sonnet-4-20250514` (configurable in `src/shared/config.js`)

**Context compaction:** Long sessions are automatically compacted — first by pruning old tool result bulk, then by using Claude Haiku to summarize if estimated tokens exceed 100k.

**Direct browser API access:** The extension uses Anthropic's `anthropic-dangerous-direct-browser-access: true` header, which is required to call the Anthropic API directly from a browser extension context.

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

---

## Privacy

See [PRIVACY.md](PRIVACY.md).

---

## License

[MIT](LICENSE) — © 2026 Nithin AG
