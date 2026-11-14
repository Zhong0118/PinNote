import { store } from './shared.js';
import { initDesk } from './desk.js';
import { initCenterCollapse, resetCenterCollapse } from './center-collapse.js';
import { initDaily } from './daily.js';
import { initMcp } from './mcp.js';
import { initHeatmap } from './heatmap.js';
import { initDownload } from './download.js';

// Site theme: follows the system until the visitor picks one; the choice covers every section.
const root = document.documentElement;
const toggle = document.getElementById('theme-toggle');
function syncToggle() {
  const dark = root.dataset.theme === 'dark';
  toggle.setAttribute('aria-pressed', String(dark));
  toggle.setAttribute('aria-label', dark ? '切换到浅色模式' : '切换到深色模式');
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

// Each init is isolated so one failing demo cannot take the others down.
for (const init of [initDesk, initCenterCollapse, initDaily, initMcp, initHeatmap, initDownload]) {
  try { init(); } catch (error) { console.error(error); }
}

function openFaqFromHash() { const t = location.hash && document.querySelector(location.hash); if (t?.tagName === 'DETAILS') t.open = true; }
window.addEventListener('hashchange', openFaqFromHash);
openFaqFromHash();

for (const b of document.querySelectorAll('[data-reset]')) {
  b.addEventListener('click', () => { store.reset(); resetCenterCollapse(); });
}
