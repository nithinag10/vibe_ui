const keyInput  = document.getElementById('api-key');
const saveBtn   = document.getElementById('save-btn');
const statusEl  = document.getElementById('status');
const toggleBtn = document.getElementById('toggle-show');

// Load existing key
chrome.storage.local.get('apiKey', ({ apiKey }) => {
  if (apiKey) {
    keyInput.value = apiKey;
    setStatus('✓ API key is saved', '#2a9d5c');
  }
});

// Show / hide toggle
toggleBtn.onclick = () => {
  const isHidden = keyInput.type === 'password';
  keyInput.type = isHidden ? 'text' : 'password';
  toggleBtn.textContent = isHidden ? 'Hide key' : 'Show key';
};

// Save
saveBtn.onclick = () => {
  const key = keyInput.value.trim();

  if (!key) {
    setStatus('⚠ Paste your API key above', '#e55');
    return;
  }

  if (!key.startsWith('sk-ant-')) {
    setStatus('⚠ Key should start with sk-ant-…', '#e55');
    return;
  }

  chrome.storage.local.set({ apiKey: key }, () => {
    setStatus('✓ Saved!', '#2a9d5c');
  });
};

keyInput.onkeydown = (e) => { if (e.key === 'Enter') saveBtn.click(); };

function setStatus(msg, color) {
  statusEl.textContent = msg;
  statusEl.style.color = color;
}
