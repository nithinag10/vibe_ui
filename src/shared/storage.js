// ─── Chrome storage helpers ─────────────────────────────────────────────────

/** Get a single value from chrome.storage.local by key. Returns null if missing. */
export function storageGet(key) {
  return new Promise(r => chrome.storage.local.get(key, d => r(d[key] ?? null)));
}

/** Set one or more key-value pairs in chrome.storage.local. */
export function storageSet(data) {
  return new Promise(r => chrome.storage.local.set(data, r));
}

/** Remove a key from chrome.storage.local. */
export function storageRemove(key) {
  return new Promise(r => chrome.storage.local.remove(key, r));
}

/** Build the storage key for a URL's session data. */
export function sessionKey(url) {
  return `vibe::${url}`;
}
