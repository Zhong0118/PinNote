// Core experience: one note moves between the center, an expanded desktop window,
// a floating capsule and an edge tab. Pointer drag, buttons and keyboard all work.
import { store, todoStatsFor, reduceMotion } from './shared.js';
import { render as renderMd, toggleTodo } from './markdown.js';

const SIZE = { expanded: [228, 252], capsule: [152, 34], tab: [26, 60] };
const PITCH = 70;          // edge-tab spacing (EDGE_PITCH in the app)
const PULL = 44;           // inward pull that leaves the edge (scaled from DETACH_PULL)
const SNAP = 28;           // pointer distance from the edge that offers docking

const $ = s => document.querySelector(s);
let desk, note, preview, hintEl, statusEl, actionsEl, stepBtns, countEl, miniList, miniEditor, decor;
let step = 0, anim = null, previewTimer = 0, drag = null; // anim: running Animation[]

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const D = () => store.state.desk;
const plan = () => store.note('plan');
const size = () => [desk.clientWidth, desk.clientHeight];

function slotY() {
  const [, H] = size(), d = D();
  const base = d.slot != null ? d.slot * H : (d.side === 'right' ? .2 * H + PITCH : .3 * H);
  return clamp(base, 8, H - SIZE.tab[1] - 8);
}
function rectFor(d) {
  const [W, H] = size(), [w, h] = SIZE[d.form] || SIZE.expanded;
  if (d.form === 'tab') return { x: d.side === 'right' ? W - w : 0, y: slotY() };
  if (d.form === 'capsule') return { x: clamp(d.cfx * W, 8, W - w - 8), y: clamp(d.cfy * H, 8, H - h - 8) };
  if (d.fromEdge) return { x: d.side === 'right' ? W - SIZE.tab[0] - w - 8 : SIZE.tab[0] + 8, y: clamp(slotY() - 28, 8, H - h - 8) };
  return { x: clamp(d.fx * W, 8, W - w - 8), y: clamp(d.fy * H, 8, H - h - 8) };
}

function setFaces(form) {
  for (const face of note.querySelectorAll('[data-face]')) face.inert = face.dataset.face !== form;
}

const RADII = { expanded: [9, 9, 9, 9], capsule: [17, 17, 17, 17] };
const radiiOf = (form, side) => form === 'tab' ? (side === 'left' ? [0, 8, 8, 0] : [8, 0, 0, 8]) : RADII[form] || RADII.expanded;
/** Corner radii that look like `r` once the shell is scaled by (sx, sy). */
const radius = (r, sx = 1, sy = 1) => `${r.map(v => v / sx + 'px').join(' ')} / ${r.map(v => v / sy + 'px').join(' ')}`;
const EASE = 'cubic-bezier(.2,.7,.2,1)';
let shell, shownRadii = RADII.expanded;
const stopAnimations = () => { for (const a of anim || []) a.cancel(); anim = null; };

/**
 * FLIP on the shell only: measure where the shell is drawn now (mid-animation included),
 * lay the note out in its new form, then animate the shell's shape from old to new.
 * Content never scales; the new face fades in once the shape has mostly settled.
 */
function place(animate) {
  const d = D();
  if (d.form === 'center') return hideToCenter(animate);
  const wasHidden = note.hidden;
  const first = wasHidden ? miniEditor.getBoundingClientRect() : shell.getBoundingClientRect();
  const fromRadii = wasHidden ? RADII.expanded : shownRadii;
  stopAnimations();
  note.hidden = false;
  note.dataset.form = d.form; note.dataset.side = d.side;
  setFaces(d.form);
  const r = rectFor(d);
  note.style.left = r.x + 'px'; note.style.top = r.y + 'px';
  shownRadii = radiiOf(d.form, d.side);
  if (!animate || reduceMotion()) return;
  const last = note.getBoundingClientRect();
  if (!last.width || !first.width) return;
  const dx = first.left - last.left, dy = first.top - last.top;
  const sx = first.width / last.width, sy = first.height / last.height;
  if (Math.abs(dx) + Math.abs(dy) < 1 && Math.abs(sx - 1) + Math.abs(sy - 1) < .01) return;
  const face = note.querySelector(`[data-face="${d.form}"]`);
  anim = [
    shell.animate([
      { transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`, borderRadius: radius(fromRadii, sx, sy), opacity: wasHidden ? 0 : 1 },
      { transform: 'none', borderRadius: radius(shownRadii), opacity: 1 },
    ], { duration: 300, easing: EASE }),
    face.animate([{ opacity: 0 }, { opacity: 0, offset: .55 }, { opacity: 1 }], { duration: 300 }),
  ];
}
function hideToCenter(animate) {
  hidePreview();
  if (note.hidden) return;
  const first = shell.getBoundingClientRect();
  stopAnimations();
  if (!animate || reduceMotion()) { note.hidden = true; return; }
  const box = note.getBoundingClientRect(), target = miniEditor.getBoundingClientRect();
  const t = (rc) => `translate(${rc.left - box.left}px, ${rc.top - box.top}px) scale(${rc.width / box.width}, ${rc.height / box.height})`;
  const face = note.querySelector(`[data-face="${D().form === 'center' ? note.dataset.form : D().form}"]`);
  const a = shell.animate([
    { transform: t(first), borderRadius: radius(shownRadii, first.width / box.width, first.height / box.height), opacity: 1 },
    { transform: t(target), borderRadius: radius(RADII.expanded, target.width / box.width, target.height / box.height), opacity: 0 },
  ], { duration: 260, easing: 'cubic-bezier(.4,0,.6,1)' });
  anim = [a, face.animate([{ opacity: 1 }, { opacity: 0, offset: .3 }, { opacity: 0 }], { duration: 260, fill: 'forwards' })];
  const done = () => { if (anim?.[0] === a && D().form === 'center') { note.hidden = true; stopAnimations(); } };
  a.onfinish = done;
  setTimeout(done, 400); // state must not depend on frames being rendered
}

// ---- actions -------------------------------------------------------------
function go(changes, nextStep, message) {
  hidePreview();
  store.update(s => Object.assign(s.desk, changes), 'desk');
  setStep(nextStep);
  say(message);
}
const act = {
  toDesktop: () => go({ form: 'expanded', fromEdge: false }, 1, '「本周计划」放到了桌面。它现在负责编辑，中心变成只读。'),
  collapse: () => {
    const d = D();
    if (d.fromEdge) return go({ form: 'tab', fromEdge: false }, 5, '收起后回到原来的槽位。向内拖离边缘，或者收回中心。');
    const r = rectFor(d), [W, H] = size();
    go({ form: 'capsule', cfx: r.x / W, cfy: r.y / H }, 2, '收成胶囊：只留颜色、标题和置顶，位置和展开时分开记住。');
  },
  dock: side => go({ form: 'tab', side, fromEdge: false, slot: null }, 3, `收进${side === 'left' ? '左' : '右'}侧边缘的槽位。指针停在标签上可以预览。`),
  expand: () => {
    const d = D();
    if (d.form === 'tab') return go({ form: 'expanded', fromEdge: true }, 4, '从边缘向内展开，可以继续写。再收起会回到原来的槽位。');
    go({ form: 'expanded', fromEdge: false }, 1, '展开到上次的位置和尺寸。');
  },
  undock: (cx, cy) => {
    const [W, H] = size();
    const d = D();
    const r = rectFor(d);
    const x = cx ?? (d.side === 'right' ? r.x - SIZE.capsule[0] - 24 : r.x + 40);
    const y = cy ?? r.y + 12;
    go({ form: 'capsule', fromEdge: false, slot: null, cfx: x / W, cfy: y / H }, 5, '离开边缘后变回自由的胶囊。');
  },
  recall: () => go({ form: 'center', fromEdge: false }, 5, '收回中心：桌面窗口关闭，便签回到中心，由中心编辑。'),
  editHere: () => {
    const r = rectFor(D()), [W, H] = size();
    go({ form: 'capsule', fromEdge: false, cfx: r.x / W, cfy: r.y / H }, 2, '桌面窗口收成胶囊，编辑移回中心。');
  },
  preview: () => { if (D().form === 'tab') { showPreview(); setStep(3); } },
};

const STEP_STATE = [
  () => go({ form: 'center', fromEdge: false, slot: null }, 0, '在中心写下。勾选待办试试，进度会同步到其他地方。'),
  () => go({ form: 'expanded', fromEdge: false, fx: .63, fy: .1 }, 1, '「本周计划」在桌面上展开。拖动标题栏可以移动它。'),
  () => { const [W, H] = size(); const r = rectFor({ ...D(), form: 'expanded', fromEdge: false }); go({ form: 'capsule', fromEdge: false, cfx: r.x / W, cfy: r.y / H }, 2, '收成胶囊。也可以把它拖到左右边缘，收成贴边标签。'); },
  () => { go({ form: 'tab', side: 'right', fromEdge: false }, 3, '贴边标签。指针停留时出现只读预览。'); setTimeout(showPreview, reduceMotion() ? 0 : 300); },
  () => go({ form: 'expanded', side: D().side, fromEdge: true }, 4, '点标签从边缘展开。再收起回到槽位。'),
  () => go({ form: 'tab', fromEdge: false }, 5, '把标签向内拖离边缘，它会变回胶囊；或者直接收回中心。'),
];

function buttonsFor(d) {
  const b = (label, fn, primary) => ({ label, fn, primary });
  switch (d.form) {
    case 'center': return [b('放到桌面', act.toDesktop, true)];
    case 'expanded': return d.fromEdge
      ? [b('收起到边缘', act.collapse, true), b('收回中心', act.recall)]
      : [b('收成胶囊', act.collapse, true), b('贴到右边缘', () => act.dock('right')), b('贴到左边缘', () => act.dock('left')), b('收回中心', act.recall)];
    case 'capsule': return [b('展开', act.expand, true), b('贴到右边缘', () => act.dock('right')), b('贴到左边缘', () => act.dock('left')), b('收回中心', act.recall)];
    case 'tab': return [b('预览', act.preview), b('展开', act.expand, true), b('拖回桌面', () => act.undock()), b('收回中心', act.recall)];
  }
  return [];
}

// ---- rendering -----------------------------------------------------------
function renderActions() {
  actionsEl.replaceChildren(...buttonsFor(D()).map(({ label, fn, primary }) => {
    const el = document.createElement('button');
    el.type = 'button'; el.textContent = label; if (primary) el.className = 'primary';
    el.addEventListener('click', fn);
    return el;
  }));
}
function renderMini() {
  const p = plan(), d = D();
  miniList.replaceChildren(...store.active().map(n => {
    const li = document.createElement('li');
    if (n.id === 'plan') li.className = 'sel';
    const dot = document.createElement('span'); dot.className = 'dot'; dot.style.setProperty('--nd', `var(--n-${n.color}-dot)`);
    li.append(dot, n.title);
    const onDesk = n.id === 'plan' ? d.form !== 'center' : n.placement === 'desktop';
    if (onDesk) li.insertAdjacentHTML('beforeend', '<svg class="ic" aria-label="在桌面"><use href="#i-monitor"/></svg>');
    return li;
  }));
  const owned = d.form === 'expanded';
  miniEditor.classList.toggle('readonly', owned);
  const h = document.createElement('h3'); h.textContent = p.title;
  const parts = [h];
  if (owned) {
    const notice = document.createElement('p'); notice.className = 'notice';
    notice.append('正在桌面窗口编辑');
    const here = document.createElement('button'); here.type = 'button'; here.textContent = '在这里编辑'; here.addEventListener('click', act.editHere);
    const back = document.createElement('button'); back.type = 'button'; back.textContent = '收回中心'; back.addEventListener('click', act.recall);
    notice.append(here, back); parts.push(notice);
  }
  const md = document.createElement('div'); md.className = 'md';
  md.append(renderMd(p.body, { readonly: owned, onToggle: line => store.edit('plan', n => { n.body = toggleTodo(n.body, line); }, 'todo') }));
  parts.push(md);
  if (d.form === 'center') {
    const cta = document.createElement('button'); cta.type = 'button'; cta.className = 'cta';
    cta.innerHTML = '<svg class="ic" aria-hidden="true"><use href="#i-monitor"/></svg>';
    cta.append('放到桌面'); cta.addEventListener('click', act.toDesktop); parts.push(cta);
  }
  miniEditor.replaceChildren(...parts);
}
function renderNoteBody() {
  const p = plan();
  const body = note.querySelector('[data-note-body]');
  body.replaceChildren(renderMd(p.body, { onToggle: line => store.edit('plan', n => { n.body = toggleTodo(n.body, line); }, 'todo') }));
  for (const el of note.querySelectorAll('.dn-name, .dn-tab-text')) el.textContent = p.title;
  note.querySelector('[data-face="capsule"]').setAttribute('aria-label', `${p.title}（胶囊）。按 Enter 展开`);
  note.querySelector('[data-face="tab"]').setAttribute('aria-label', `${p.title}（贴边标签）。聚焦时预览，按 Enter 展开，按 Delete 拖回桌面`);
}
function renderDecor() {
  // The other two sample notes that live on the desktop, drawn as in the app.
  const [W, H] = size();
  const shop = store.note('shop'), read = store.note('read');
  decor.tab.style.cssText = `top:${.2 * H}px`;
  decor.tab.querySelector('span').textContent = shop.title;
  decor.cap.style.cssText = `left:${clamp(W * .6, 8, W - 160)}px; top:${H - 34 - 14}px`;
  decor.cap.querySelector('b').textContent = read.title;
}

function setStep(i) {
  step = i;
  stepBtns.forEach((b, j) => { if (j === i) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current'); });
  countEl.textContent = `${i + 1} / ${STEP_STATE.length}`;
}
function say(text) { statusEl.textContent = text; }

// ---- preview ---------------------------------------------------------------
function showPreview() {
  if (D().form !== 'tab') return;
  const p = plan(), s = todoStatsFor(p);
  preview.querySelector('b').textContent = p.title;
  preview.querySelector('[data-preview-text]').textContent = p.body.split('\n').filter(Boolean).map(l => l.replace(/^\s*- \[( |x)\] /i, '').replace(/^#+ |^> /, '')).join('\n');
  preview.querySelector('[data-preview-progress]').textContent = s.total ? `清单 ${s.done}/${s.total}` : '';
  const r = rectFor(D()), [W, H] = size();
  const pw = 210, ph = 168;
  preview.style.left = (D().side === 'right' ? r.x - pw - 8 : r.x + SIZE.tab[0] + 8) + 'px';
  preview.style.top = clamp(r.y - 20, 8, H - ph - 8) + 'px';
  preview.hidden = false;
  if (!reduceMotion()) preview.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 140 });
}
function hidePreview() { clearTimeout(previewTimer); preview.hidden = true; }

// ---- pointer & keyboard -------------------------------------------------------
function onDown(e) {
  if (e.button !== 0 || e.target.closest('button, input, label')) return;
  const face = e.currentTarget;
  face.setPointerCapture(e.pointerId);
  drag = { id: e.pointerId, sx: e.clientX, sy: e.clientY, left: parseFloat(note.style.left), top: parseFloat(note.style.top), moved: false, face };
}
function onMove(e) {
  if (!drag || e.pointerId !== drag.id) return;
  const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
  if (!drag.moved && Math.hypot(dx, dy) < 4) return;
  if (!drag.moved) { drag.moved = true; note.classList.add('dragging'); hidePreview(); stopAnimations(); }
  const d = D(), [W, H] = size(), [w, h] = SIZE[d.form];
  const box = desk.getBoundingClientRect();
  if (d.form === 'tab') {
    const inward = d.side === 'right' ? -dx : dx;
    if (inward > PULL) {
      // Leaving the edge: the tab becomes a capsule under the pointer and the drag continues.
      const cx = clamp(e.clientX - box.left - SIZE.capsule[0] / 2, 8, W - SIZE.capsule[0] - 8);
      const cy = clamp(e.clientY - box.top - SIZE.capsule[1] / 2, 8, H - SIZE.capsule[1] - 8);
      act.undock(cx, cy);
      drag.left = cx; drag.top = cy; drag.sx = e.clientX; drag.sy = e.clientY;
      return;
    }
    note.style.top = clamp(drag.top + dy, 8, H - h - 8) + 'px';
    return;
  }
  note.style.left = clamp(drag.left + dx, 0, W - w) + 'px';
  note.style.top = clamp(drag.top + dy, 0, H - h) + 'px';
  const px = e.clientX - box.left;
  const side = px < SNAP ? 'left' : px > W - SNAP ? 'right' : '';
  desk.dataset.hint = side;
  hintEl.textContent = side ? `松手收纳到${side === 'left' ? '左' : '右'}侧` : '';
  hintEl.classList.toggle('show', !!side);
}
function onUp(e) {
  if (!drag || e.pointerId !== drag.id) return;
  const { moved } = drag; drag = null;
  note.classList.remove('dragging');
  const side = desk.dataset.hint; desk.dataset.hint = ''; hintEl.classList.remove('show');
  const d = D(), [W, H] = size();
  if (!moved) { if (d.form === 'capsule' || d.form === 'tab') act.expand(); return; }
  const left = parseFloat(note.style.left), top = parseFloat(note.style.top);
  if (d.form === 'tab') { store.update(s => { s.desk.slot = top / H; }, 'desk-quiet'); say('标签沿边缘移动，位置会被记住。'); return; }
  if (side) {
    store.update(s => { s.desk.slot = clamp(top + (d.form === 'capsule' ? 0 : 20), 8, H - 68) / H; }, 'desk-quiet');
    return act.dock(side);
  }
  if (d.form === 'capsule') store.update(s => { s.desk.cfx = left / W; s.desk.cfy = top / H; }, 'desk-quiet');
  else store.update(s => { s.desk.fx = left / W; s.desk.fy = top / H; s.desk.fromEdge = false; }, 'desk-quiet');
}
function onCancel() {
  if (!drag) return;
  drag = null; note.classList.remove('dragging'); desk.dataset.hint = ''; hintEl.classList.remove('show');
  place(true);
}
function onKey(e) {
  const d = D();
  if ((e.key === 'Enter' || e.key === ' ') && (d.form === 'capsule' || d.form === 'tab')) { e.preventDefault(); act.expand(); }
  else if ((e.key === 'Delete' || e.key === 'Backspace') && d.form === 'tab') { e.preventDefault(); act.undock(); }
  else if (d.form === 'expanded' && e.currentTarget.matches('[data-drag]') && e.key.startsWith('Arrow')) {
    e.preventDefault();
    const [W, H] = size(), step = e.shiftKey ? 40 : 12;
    const left = parseFloat(note.style.left) + (e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0);
    const top = parseFloat(note.style.top) + (e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0);
    store.update(s => { s.desk.fx = left / W; s.desk.fy = top / H; s.desk.fromEdge = false; }, 'desk');
  } else if (e.key === 'Escape') hidePreview();
}

export function initDesk() {
  desk = $('#desk'); note = $('#desk-note'); shell = note?.querySelector('.dn-shell'); preview = $('#desk-preview'); hintEl = $('#desk-hint');
  statusEl = $('#desk-status'); actionsEl = $('#desk-actions'); miniList = $('#mini-list'); miniEditor = $('#mini-editor');
  stepBtns = [...document.querySelectorAll('#desk-steps [data-step]')];
  countEl = document.querySelector('[data-step-count]');
  if (!desk) return;

  decor = { tab: document.createElement('div'), cap: document.createElement('div') };
  decor.tab.className = 'decor-tab'; decor.tab.setAttribute('aria-hidden', 'true'); decor.tab.innerHTML = '<span></span>';
  decor.cap.className = 'decor-capsule'; decor.cap.setAttribute('aria-hidden', 'true'); decor.cap.innerHTML = '<i class="dot"></i><b></b>';
  desk.append(decor.tab, decor.cap);

  const title = note.querySelector('[data-drag]');
  title.tabIndex = 0; title.setAttribute('aria-label', '本周计划的标题栏：拖动或用方向键移动');
  const capsule = note.querySelector('[data-face="capsule"]'), tab = note.querySelector('[data-face="tab"]');
  for (const el of [capsule, tab]) { el.tabIndex = 0; el.setAttribute('role', 'button'); }
  for (const el of [title, capsule, tab]) {
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onCancel);
    el.addEventListener('keydown', onKey);
  }
  note.querySelector('[data-act="collapse"]').addEventListener('click', act.collapse);
  tab.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse' && !drag) { clearTimeout(previewTimer); previewTimer = setTimeout(() => { showPreview(); setStep(3); }, 320); } });
  tab.addEventListener('pointerleave', () => { clearTimeout(previewTimer); previewTimer = setTimeout(hidePreview, 180); });
  tab.addEventListener('focus', () => showPreview());
  tab.addEventListener('blur', hidePreview);

  stepBtns.forEach((b, i) => b.addEventListener('click', () => STEP_STATE[i]()));
  document.querySelector('[data-step-prev]').addEventListener('click', () => STEP_STATE[(step + STEP_STATE.length - 1) % STEP_STATE.length]());
  document.querySelector('[data-step-next]').addEventListener('click', () => STEP_STATE[(step + 1) % STEP_STATE.length]());

  store.subscribe(reason => {
    if (reason === 'reset') { hidePreview(); setStep(0); say(''); }
    renderMini(); renderNoteBody(); renderActions(); renderDecor();
    if (reason === 'desk' || reason === 'reset') place(reason === 'desk');
  });
  new ResizeObserver(() => { renderDecor(); if (!drag) place(false); }).observe(desk);

  renderMini(); renderNoteBody(); renderActions(); renderDecor(); place(false); setStep(0);
  say('在中心写下。勾选待办试试，进度会同步到其他地方。');
}
