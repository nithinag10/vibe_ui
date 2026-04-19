// ─── Default configuration ──────────────────────────────────────────────────
// All magic numbers and model identifiers centralized here.
// Power users can override via chrome.storage.local key 'vibe::config'.

const DEFAULT_CONFIG = Object.freeze({
  models: {
    agent: 'claude-sonnet-4-20250514',
    compactor: 'claude-haiku-4-5-20251001',
  },

  api: {
    baseUrl: 'https://api.anthropic.com/v1/messages',
    version: '2023-06-01',
    beta: 'prompt-caching-2024-07-31',
    maxTokensAgent: 4096,
    maxTokensCompact: 2048,
  },

  agent: {
    maxTurns: 25,
    confidenceThreshold: 50,
    selectorFailureHintAt: 3,
    maxHistorySnapshots: 10,
  },

  compaction: {
    tokenThreshold: 100_000,
    microCompactKeep: 2,
    fullCompactKeep: 3,
    charsPerToken: 4,
    tokensPerImage: 1600,
  },

  dom: {
    textSliceLength: 120,
    maxClassesPerElement: 8,
    outerHTMLLimit: 500,
    defaultLimit: 15,
    maxLimit: 50,
  },

  apply: {
    persistentThrottleMs: 300,
  },

  capture: {
    maxEdge: 1280,
  },

  timeouts: {
    toolExecDefault: 10_000,
    toolExecCapture: 15_000,
    askUser: 300_000,
    keepAlivePing: 20_000,
    modalAutoClose: 1_800,
  },
});

/** Deep-merge user overrides onto defaults (one level deep per section). */
function mergeConfig(defaults, overrides) {
  if (!overrides) return defaults;
  const merged = { ...defaults };
  for (const key of Object.keys(overrides)) {
    if (key in defaults && typeof defaults[key] === 'object' && typeof overrides[key] === 'object') {
      merged[key] = { ...defaults[key], ...overrides[key] };
    }
  }
  return Object.freeze(merged);
}

/**
 * Load config with optional user overrides from chrome.storage.local.
 * Falls back to defaults if storage is unavailable (e.g. in tests).
 */
export async function loadConfig() {
  try {
    const data = await new Promise(r => chrome.storage.local.get('vibe::config', r));
    return mergeConfig(DEFAULT_CONFIG, data['vibe::config']);
  } catch {
    return DEFAULT_CONFIG;
  }
}

/** Synchronous access to defaults (use when config hasn't been loaded yet). */
export const CONFIG = DEFAULT_CONFIG;
