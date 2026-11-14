// Release info has one source: GitHub's "latest release". Links point at the Release page
// until it loads, and stay there if it fails. No tokens, no tracking; cached per tab for an hour.
const API = 'https://api.github.com/repos/Zhong0118/PinNote/releases/latest';
const RELEASES = 'https://github.com/Zhong0118/PinNote/releases/latest';
const CACHE = 'pinnote-site-release';
const PATTERNS = { dmg: /_universal\.dmg$/i, exe: /_x64-setup\.exe$/i, msi: /_x64_[^.]*\.msi$/i };

function detectPlatform() {
  const p = (navigator.userAgentData?.platform || navigator.platform || '').toLowerCase();
  const ua = navigator.userAgent.toLowerCase();
  if (/iphone|ipad|android/.test(ua)) return 'mobile';
  if (p.includes('mac') || ua.includes('mac os')) return 'mac';
  if (p.includes('win') || ua.includes('windows')) return 'win';
  return 'other';
}

function selectPlatform(which) {
  for (const tab of document.querySelectorAll('[data-platform-tab]')) {
    const on = tab.dataset.platformTab === which;
    tab.setAttribute('aria-selected', String(on)); tab.tabIndex = on ? 0 : -1;
    document.getElementById(tab.getAttribute('aria-controls')).hidden = !on;
  }
}

async function loadRelease() {
  try {
    const cached = JSON.parse(sessionStorage.getItem(CACHE) || 'null');
    if (cached && Date.now() - cached.at < 36e5) return cached.data;
  } catch { /* storage unavailable */ }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(API, { headers: { Accept: 'application/vnd.github+json' }, signal: ctrl.signal, referrerPolicy: 'no-referrer' });
    if (!res.ok) throw new Error(String(res.status));
    const json = await res.json();
    const data = { tag: json.tag_name, published: json.published_at, url: json.html_url, assets: (json.assets || []).map(a => ({ name: a.name, size: a.size, url: a.browser_download_url })) };
    try { sessionStorage.setItem(CACHE, JSON.stringify({ at: Date.now(), data })); } catch { /* ignore */ }
    return data;
  } finally { clearTimeout(timer); }
}

const mb = n => (n / 1048576).toFixed(1) + ' MB';
const date = s => { const d = new Date(s); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const safeUrl = u => (/^https:\/\/github\.com\/Zhong0118\/PinNote\//.test(u) ? u : RELEASES);

function applyRelease(r, platform) {
  const version = String(r.tag || '').replace(/^v/, '');
  const found = {};
  for (const [kind, re] of Object.entries(PATTERNS)) found[kind] = r.assets.find(a => re.test(a.name));
  for (const a of document.querySelectorAll('[data-asset]')) {
    const asset = found[a.dataset.asset];
    if (!asset) continue;
    a.href = safeUrl(asset.url);
    a.querySelector('[data-asset-meta]').textContent = mb(asset.size);
    a.setAttribute('aria-label', `下载 ${asset.name}（${mb(asset.size)}）`);
  }
  const line = document.querySelector('[data-release-line]');
  if (line && version) {
    line.textContent = '';
    const link = document.createElement('a'); link.href = safeUrl(r.url); link.textContent = `最新版本 ${version}`;
    line.append(link, `，${date(r.published)} 发布 · macOS（Apple Silicon 和 Intel）· Windows x64`);
  }
  const summary = document.querySelector('[data-release-summary]');
  if (summary && version) summary.textContent = `最新版本 ${version}，${date(r.published)} 发布。安装包来自 GitHub Release。`;
  const hero = document.getElementById('hero-download');
  const main = platform === 'mac' ? found.dmg : platform === 'win' ? found.exe : null;
  if (hero && main) {
    hero.href = safeUrl(main.url);
    hero.querySelector('span').textContent = platform === 'mac' ? `下载 macOS 版 ${version}` : `下载 Windows 版 ${version}`;
  }
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* fall back */ }
  const ta = document.createElement('textarea');
  ta.value = text; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
  document.body.append(ta); ta.select();
  let ok = false; try { ok = document.execCommand('copy'); } catch { ok = false; }
  ta.remove();
  return ok;
}

export function initDownload() {
  const platform = detectPlatform();
  const note = document.querySelector('[data-platform-detect]');
  selectPlatform(platform === 'win' ? 'win' : 'mac');
  if (note) note.textContent = platform === 'mac' ? '已按你的系统选择 macOS，可以切换。'
    : platform === 'win' ? '已按你的系统选择 Windows，可以切换。'
    : platform === 'mobile' ? 'PinNote 是桌面应用，请在 Mac 或 Windows 电脑上下载。'
    : 'PinNote 目前提供 macOS 和 Windows 版本。';
  if (platform === 'win') document.querySelector('#hero-download span').textContent = '下载 Windows 版';
  if (platform === 'mac') document.querySelector('#hero-download span').textContent = '下载 macOS 版';

  const tabs = [...document.querySelectorAll('[data-platform-tab]')];
  tabs.forEach((t, i) => {
    t.addEventListener('click', () => selectPlatform(t.dataset.platformTab));
    t.addEventListener('keydown', e => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const next = tabs[(i + 1) % tabs.length]; selectPlatform(next.dataset.platformTab); next.focus();
    });
  });

  for (const btn of document.querySelectorAll('[data-copy]')) {
    const label = btn.querySelector('span');
    btn.addEventListener('click', async () => {
      const code = document.querySelector(btn.dataset.copy);
      const ok = await copyText(code.textContent.trim());
      if (ok) { label.textContent = '已复制'; btn.classList.add('done'); }
      else {
        // Last resort: select the command so the visitor can press Cmd/Ctrl+C.
        const range = document.createRange(); range.selectNodeContents(code);
        const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range);
        label.textContent = '已选中，请按 ⌘C 或 Ctrl+C';
      }
      clearTimeout(btn._t);
      btn._t = setTimeout(() => { label.textContent = '复制'; btn.classList.remove('done'); }, 2200);
    });
  }

  loadRelease().then(r => applyRelease(r, platform)).catch(() => {
    const summary = document.querySelector('[data-release-summary]');
    if (summary) summary.textContent = '暂时读不到版本信息，下面的按钮会打开 GitHub Release 页面，在那里选择安装包。';
  });
}
