# Privacy Policy — Vibe

_Last updated: April 2026_

---

## What Vibe Collects

Vibe collects and stores the following data **locally on your device only**:

| Data                           | Where stored           | Purpose                                                      |
| ------------------------------ | ---------------------- | ------------------------------------------------------------ |
| Your Anthropic API key         | `chrome.storage.local` | Authenticate requests to the Anthropic API                   |
| Per-URL CSS/JS customizations  | `chrome.storage.local` | Persist your page modifications across visits                |
| Conversation history (per URL) | `chrome.storage.local` | Allow Claude to resume sessions and understand prior changes |

**No data is stored on any Vibe server.** There are no Vibe servers. The extension is entirely client-side.

---

## What Is Sent to Anthropic

When you submit a prompt, the following is sent to the [Anthropic API](https://www.anthropic.com/privacy):

- Your prompt text
- A snapshot of the current page's DOM (tag names, classes, IDs, visible text — no passwords or form values)
- Any clarifying answers you provide during the session

This data is governed by [Anthropic's Privacy Policy](https://www.anthropic.com/privacy).

---

## What Vibe Does NOT Do

- Does not collect analytics or telemetry
- Does not track browsing history
- Does not send data to any third party other than Anthropic (only when you actively use the Vibe button)
- Does not sync your API key or customizations across devices (`chrome.storage.local`, not `chrome.storage.sync`)
- Does not read form inputs, passwords, or payment information

---

## Permissions Explained

| Permission                    | Why it's needed                                                              |
| ----------------------------- | ---------------------------------------------------------------------------- |
| `storage`                     | Save your API key and page customizations locally                            |
| `scripting`                   | Execute AI-generated JavaScript on pages via `chrome.scripting.executeScript` (required to bypass strict Content Security Policies) |
| `<all_urls>` host permission  | Inject the Vibe button and run DOM tools on any page you choose to customize |
| `https://api.anthropic.com/*` | Make requests to the Anthropic API                                           |

---

## Contact

If you have privacy concerns, open an issue on [GitHub](https://github.com/nithinag10/vibe_ui/issues).
