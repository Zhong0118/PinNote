import './theme.js';
import { store } from './shared.js';
import { initDesk } from './desk.js';
import { initCenterCollapse, resetCenterCollapse } from './center-collapse.js';
import { initDaily } from './daily.js';
import { initMcp } from './mcp.js';
import { initHeatmap } from './heatmap.js';
import { initDownload } from './download.js';

// Each init is isolated so one failing demo cannot take the others down.
for (const init of [initDesk, initCenterCollapse, initDaily, initMcp, initHeatmap, initDownload]) {
  try { init(); } catch (error) { console.error(error); }
}

function openFaqFromHash() {
  const target = document.getElementById(location.hash.slice(1));
  if (target?.tagName === 'DETAILS') target.open = true;
}
window.addEventListener('hashchange', openFaqFromHash);
openFaqFromHash();

for (const b of document.querySelectorAll('[data-reset]')) {
  b.addEventListener('click', () => { store.reset(); resetCenterCollapse(); });
}
