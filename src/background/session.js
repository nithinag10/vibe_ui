import { storageSet, sessionKey } from '../shared/storage.js';
import { pruneOldToolResults } from './compaction.js';

// ─── Persist session to chrome.storage.local ─────────────────────────────────
export async function persistSession(url, session) {
  const toPersist = {
    ...session,
    conversationHistory: pruneOldToolResults(session.conversationHistory || []),
  };
  await storageSet({ [sessionKey(url)]: toPersist });
  console.log('[Vibe BG] Session persisted for:', url);
}
