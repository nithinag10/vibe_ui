// Click-to-copy for example prompts.
// Minimal, no build step — keep it static.

const chips = document.querySelectorAll('.chip');
chips.forEach((chip) => {
  chip.addEventListener('click', async () => {
    const text = chip.textContent.trim();
    try {
      await navigator.clipboard.writeText(text);
      const prev = chip.textContent;
      chip.textContent = '✓ copied';
      chip.style.color = '#ffc6c7';
      setTimeout(() => {
        chip.textContent = prev;
        chip.style.color = '';
      }, 1200);
    } catch {
      // clipboard blocked — fail silently
    }
  });
});

// Smooth scroll for in-page anchors
document.querySelectorAll('a[href^="#"]').forEach((a) => {
  a.addEventListener('click', (e) => {
    const id = a.getAttribute('href').slice(1);
    if (!id) return;
    const el = document.getElementById(id);
    if (!el) return;
    e.preventDefault();
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
});

// Pause demo video when offscreen (save battery)
const video = document.querySelector('.demo video');
if (video && 'IntersectionObserver' in window) {
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          video.play().catch(() => {});
        } else {
          video.pause();
        }
      });
    },
    { threshold: 0.1 }
  );
  io.observe(video);
}
