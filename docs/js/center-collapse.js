// Collapsing the whole note center: window ↔ left/right edge handle, window ↔ compact strip.
// Auto-play explains the shapes; any manual action takes over. It pauses offscreen, when the
// page is hidden, and does not start at all with reduced motion.
import { reduceMotion } from './shared.js';

const SEQUENCE = [['window', 1700], ['left', 2100], ['window', 1500], ['bar', 2100], ['window', 1500], ['right', 2100]];
const PULL = 44;

let screen, win, handle, bar, statusEl, playBtn, replayBtn;
let state = 'window', platform = 'mac', anim = null;
let playing = false, userPaused = false, visible = false, seqIndex = 0, timer = 0;
let handleY = .4;

const MESSAGES = {
  window: '常规窗口。点标题栏右上角的按钮收起。',
  left: '收起到左侧边缘：点把手恢复，上下拖动换位置，向内拖出恢复到指针处。',
  right: '收起到右侧边缘：点把手恢复，上下拖动换位置，向内拖出恢复到指针处。',
  bar: '收起为小条：显示当前便签标题，可以新建便签或展开。',
};

const animated = () => platform === 'mac' && !reduceMotion();

/** Move to a state. On macOS the window shrinks into the handle/strip and grows back from it. */
function setState(next, { from } = {}) {
  if (next === state && !from) return;
  const prev = state;
  state = next;
  anim?.cancel(); anim = null;
  const collapsed = next !== 'window';
  const target = next === 'bar' ? bar : (next === 'left' || next === 'right') ? handle : null;
  // Lay out the destination shape first so it can be measured.
  if (next === 'left' || next === 'right') {
    handle.className = 'cc-handle ' + next;
    handle.style.top = `calc(${handleY * 100}% - 48px)`;
  }
  handle.hidden = !(next === 'left' || next === 'right');
  bar.hidden = next !== 'bar';
  statusEl.textContent = MESSAGES[next];

  if (collapsed) {
    if (!animated()) { win.hidden = true; return; }
    win.hidden = false;
    const w = win.getBoundingClientRect(), t = target.getBoundingClientRect();
    target.style.opacity = '0';
    anim = win.animate([
      { transform: 'none', opacity: 1 },
      { transform: `translate(${t.left - w.left}px, ${t.top - w.top}px) scale(${t.width / w.width}, ${t.height / w.height})`, opacity: .15 },
    ], { duration: 360, easing: 'cubic-bezier(.4,0,.2,1)' });
    const a = anim;
    a.onfinish = () => {
      if (anim !== a) return;
      win.hidden = true; target.style.opacity = '';
      target.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 120 });
      anim = null;
    };
    a.oncancel = () => { target.style.opacity = ''; };
    return;
  }
  // Restore: grow back out of the handle or strip (or from a pointer position).
  const source = from || (prev === 'bar' ? bar : handle);
  const fromRect = source.getBoundingClientRect ? source.getBoundingClientRect() : source;
  handle.hidden = true; bar.hidden = true;
  win.hidden = false;
  if (!animated() || !fromRect.width) return;
  const w = win.getBoundingClientRect();
  anim = win.animate([
    { transform: `translate(${fromRect.left - w.left}px, ${fromRect.top - w.top}px) scale(${fromRect.width / w.width}, ${fromRect.height / w.height})`, opacity: .15 },
    { transform: 'none', opacity: 1 },
  ], { duration: 360, easing: 'cubic-bezier(.2,.7,.2,1)' });
}

// ---- auto-play ---------------------------------------------------------------
function tick() {
  clearTimeout(timer);
  if (!playing) return;
  const [s, wait] = SEQUENCE[seqIndex];
  setState(s);
  timer = setTimeout(() => { seqIndex = (seqIndex + 1) % SEQUENCE.length; tick(); }, wait);
}
function syncPlay() {
  const should = !userPaused && visible && !document.hidden;
  if (should && !playing) { playing = true; tick(); }
  else if (!should && playing) { playing = false; clearTimeout(timer); }
  playBtn.setAttribute('aria-label', userPaused ? '继续自动演示' : '暂停自动演示');
  playBtn.querySelector('use').setAttribute('href', userPaused ? '#i-play' : '#i-pause');
}
function takeOver() { if (!userPaused) { userPaused = true; syncPlay(); } }

// ---- handle drag -------------------------------------------------------------
let drag = null;
function onHandleDown(e) {
  if (e.button !== 0) return;
  takeOver();
  handle.setPointerCapture(e.pointerId);
  drag = { id: e.pointerId, sx: e.clientX, sy: e.clientY, moved: false, y0: handleY };
}
function onHandleMove(e) {
  if (!drag || e.pointerId !== drag.id) return;
  const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
  if (!drag.moved && Math.hypot(dx, dy) < 4) return;
  drag.moved = true;
  const inward = state === 'right' ? -dx : dx;
  if (inward > PULL) {
    // A clear inward pull restores the window right under the pointer.
    const box = screen.getBoundingClientRect();
    drag = null;
    const w = box.width * .64, h = box.height * .7;
    const left = Math.max(8, Math.min(box.width - w - 8, e.clientX - box.left - w / 2));
    const top = Math.max(8, Math.min(box.height - h - 8, e.clientY - box.top - 16));
    win.style.left = left + 'px'; win.style.top = top + 'px';
    setState('window', { from: handle });
    statusEl.textContent = '向内拖出：窗口直接出现在指针下。';
    return;
  }
  const box = screen.getBoundingClientRect();
  handleY = Math.max(.18, Math.min(.82, drag.y0 + dy / box.height));
  handle.style.top = `calc(${handleY * 100}% - 48px)`;
}
function onHandleUp(e) {
  if (!drag || e.pointerId !== drag.id) return;
  const moved = drag.moved; drag = null;
  if (!moved) { win.style.left = ''; win.style.top = ''; setState('window'); return; }
  statusEl.textContent = '把手沿边缘移动，位置会被记住。';
}
function onHandleKey(e) {
  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
    e.preventDefault(); takeOver();
    handleY = Math.max(.18, Math.min(.82, handleY + (e.key === 'ArrowUp' ? -.06 : .06)));
    handle.style.top = `calc(${handleY * 100}% - 48px)`;
  }
}

export function resetCenterCollapse() {
  anim?.cancel(); anim = null;
  win.style.left = ''; win.style.top = '';
  handleY = .4; seqIndex = 0; state = '';
  setState('window');
  userPaused = reduceMotion();
  playing = false; syncPlay();
}

export function initCenterCollapse() {
  screen = document.getElementById('cc-screen');
  if (!screen) return;
  win = document.getElementById('cc-window'); handle = document.getElementById('cc-handle'); bar = document.getElementById('cc-bar');
  statusEl = document.getElementById('cc-status'); playBtn = document.getElementById('cc-play'); replayBtn = document.getElementById('cc-replay');

  screen.addEventListener('click', e => {
    const b = e.target.closest('[data-cc]');
    if (!b) return;
    takeOver();
    const to = b.dataset.cc;
    if (to === 'restore') { win.style.left = ''; win.style.top = ''; setState('window'); }
    else setState(to);
  });
  handle.addEventListener('pointerdown', onHandleDown);
  handle.addEventListener('pointermove', onHandleMove);
  handle.addEventListener('pointerup', onHandleUp);
  handle.addEventListener('pointercancel', () => { drag = null; });
  handle.addEventListener('keydown', onHandleKey);
  // Keyboard/AT click on the handle (pointer clicks are handled in pointerup).
  handle.addEventListener('click', e => { if (e.detail === 0) { takeOver(); win.style.left = ''; win.style.top = ''; setState('window'); } });

  for (const b of document.querySelectorAll('[data-platform]')) {
    b.addEventListener('click', () => {
      platform = b.dataset.platform;
      for (const o of document.querySelectorAll('[data-platform]')) o.setAttribute('aria-checked', String(o === b));
      statusEl.textContent = platform === 'mac' ? 'macOS：收起和恢复时有缩放动画。' : 'Windows：直接切换，没有缩放动画。';
    });
  }
  playBtn.addEventListener('click', () => { userPaused = !userPaused; syncPlay(); });
  replayBtn.addEventListener('click', () => {
    userPaused = false; seqIndex = 0; playing = false;
    win.style.left = ''; win.style.top = '';
    syncPlay();
  });
  new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; syncPlay(); }, { threshold: .35 }).observe(screen);
  document.addEventListener('visibilitychange', syncPlay);

  userPaused = reduceMotion();
  statusEl.textContent = MESSAGES.window + (userPaused ? ' 已开启减少动态，自动演示不会播放。' : '');
  syncPlay();
}
