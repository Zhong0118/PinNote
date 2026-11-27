// The HTML includes working 1.4.0 links for offline API access. GitHub supplies newer assets.
const API = 'https://api.github.com/repos/Zhong0118/PinNote/releases/latest';
const RELEASES = 'https://github.com/Zhong0118/PinNote/releases/latest';
const CACHE = 'inkpin-site-release';
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
    tab.setAttribute('aria-selected', String(on));
    tab.tabIndex = on ? 0 : -1;
    const panel = document.getElementById(tab.getAttribute('aria-controls'));
    panel.inert = !on;
    panel.hidden = !on;
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
    const data = { tag: json.tag_name, url: json.html_url, assets: (json.assets || []).map(a => ({ name: a.name, size: a.size, url: a.browser_download_url })) };
    try { sessionStorage.setItem(CACHE, JSON.stringify({ at: Date.now(), data })); } catch { /* ignore */ }
    return data;
  } finally { clearTimeout(timer); }
}

const mb = n => (n / 1048576).toFixed(1) + ' MB';
const safeUrl = u => (/^https:\/\/github\.com\/Zhong0118\/PinNote\//.test(u) ? u : RELEASES);

function applyRelease(r, platform) {
  const version = String(r.tag || '').replace(/^v/, '');
  if (!version) return;
  const found = {};
  for (const [kind, re] of Object.entries(PATTERNS)) found[kind] = r.assets.find(a => re.test(a.name));
  for (const a of document.querySelectorAll('[data-asset]')) {
    const asset = found[a.dataset.asset];
    a.href = asset ? safeUrl(asset.url) : safeUrl(r.url);
    a.querySelector('[data-asset-meta]').textContent = asset ? mb(asset.size) : '查看发布页';
  }
  const versionLink = document.querySelector('[data-release-version]');
  versionLink.href = safeUrl(r.url);
  versionLink.textContent = version;
  document.querySelector('[data-release-summary]').textContent = `${version} · macOS 通用版和 Windows x64`;
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
  if (platform === 'mobile') note.textContent = '请在 Mac 或 Windows 电脑上安装。';
  if (platform === 'win') document.querySelector('#hero-download span').textContent = '下载 Windows 版';
  if (platform === 'mac') document.querySelector('#hero-download span').textContent = '下载 macOS 版';

  const tabs = [...document.querySelectorAll('[data-platform-tab]')];
  tabs.forEach((t, i) => {
    t.addEventListener('click', () => selectPlatform(t.dataset.platformTab));
    t.addEventListener('keydown', e => {
      const nextIndex = {
        ArrowLeft: (i - 1 + tabs.length) % tabs.length,
        ArrowRight: (i + 1) % tabs.length,
        Home: 0,
        End: tabs.length - 1,
      }[e.key];
      if (nextIndex === undefined) return;
      e.preventDefault();
      const next = tabs[nextIndex];
      selectPlatform(next.dataset.platformTab);
      next.focus();
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
        label.textContent = '已选中';
      }
      document.getElementById('copy-status').textContent = ok ? '已复制命令' : '已选中命令，请按 ⌘C 或 Ctrl+C';
      clearTimeout(btn._t);
      btn._t = setTimeout(() => { label.textContent = '复制'; btn.classList.remove('done'); }, 2200);
    });
  }

  loadRelease().then(r => applyRelease(r, platform)).catch(() => {
    // The visible version and links in the HTML remain usable.
  });
}
