/**
 * Inject the floating Vibe button into the page.
 * Styling is handled by vibe.css; this just creates the element.
 */
export function injectVibeButton(onClick) {
  if (document.getElementById('__vibe_btn__')) return;

  const btn = document.createElement('button');
  btn.id = '__vibe_btn__';
  btn.innerHTML = '<span style="font-size:15px;line-height:1">✦</span><span>Vibe</span>';
  btn.onclick = onClick;

  document.body.appendChild(btn);
}
