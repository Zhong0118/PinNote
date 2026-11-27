// Site theme: follows the system until the visitor picks one; the choice covers every section.
const root = document.documentElement;
const toggle = document.getElementById('theme-toggle');
const heroImages = document.querySelectorAll('[data-theme-source]');
function syncToggle() {
  const dark = root.dataset.theme === 'dark';
  toggle.setAttribute('aria-pressed', String(dark));
  toggle.setAttribute('aria-label', dark ? '切换到浅色模式' : '切换到深色模式');
  for (const source of heroImages) source.media = dark ? 'all' : 'not all';
}
toggle.addEventListener('click', () => {
  root.dataset.theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
  try { localStorage.setItem('pinnote-site-theme', root.dataset.theme); } catch { /* ignore */ }
  syncToggle();
});
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
  let saved = null; try { saved = localStorage.getItem('pinnote-site-theme'); } catch { /* ignore */ }
  if (!saved) { root.dataset.theme = e.matches ? 'dark' : 'light'; syncToggle(); }
});
syncToggle();
