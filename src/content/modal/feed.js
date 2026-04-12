const FEED_COLORS = {
  thinking: '#999',
  tool:     '#2563eb',
  question: '#d97706',
  done:     '#16a34a',
  error:    '#dc2626',
};

export function appendFeedItem({ kind, text, tool, confidence }) {
  const feedEl = document.getElementById('__vibe_feed__');
  if (!feedEl) return;

  feedEl.style.display = 'block';

  const row = document.createElement('div');
  row.className = '__vibe_feed_row__';

  let label;
  if (kind === 'thinking') label = `· ${(text || '').slice(0, 100)}`;
  else if (kind === 'tool') label = `→ ${tool || text}`;
  else if (kind === 'question') label = `? ${text}`;
  else if (kind === 'done') label = `✓ done  confidence: ${confidence}%  — ${text}`;
  else label = `✗ ${text}`;

  row.style.color = FEED_COLORS[kind] || '#555';
  row.textContent = label;

  feedEl.appendChild(row);
  feedEl.scrollTop = feedEl.scrollHeight;
}
