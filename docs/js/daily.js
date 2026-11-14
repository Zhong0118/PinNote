// Daily use: a re-drawn note center driven by the shared sample notes.
import { store, NOW, desktopOwns, isOnDesktop, timeLabel, reminderLabel, todoStatsFor } from './shared.js';
import { render as renderMd, toggleTodo, addTodo, excerpt, appendHighlighted } from './markdown.js';

const ui = { query: '', scope: 'all', filters: { starred: false, reminder: false, todo: false, tag: '' }, tabs: ['meet', 'shop', 'plan'], active: 'plan', adding: false, menu: false };
const initialUi = JSON.stringify(ui);
let els;

const svg = (id, cls = '') => `<svg class="ic ${cls}" aria-hidden="true"><use href="#i-${id}"/></svg>`;
function el(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') e.className = v;
    else if (k === 'html') e.innerHTML = v; // only ever static icon markup from this file
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) e.setAttribute(k, v === true ? '' : v);
  }
  e.append(...kids.filter(k => k != null && k !== false));
  return e;
}

function matches(n) {
  const q = ui.query.trim().toLowerCase();
  if (ui.scope === 'desktop' && !isOnDesktop(n)) return false;
  if (ui.filters.starred && !n.starred) return false;
  if (ui.filters.reminder && !n.reminder) return false;
  if (ui.filters.todo && !todoStatsFor(n).open) return false;
  if (ui.filters.tag && !n.tags.includes(ui.filters.tag)) return false;
  if (q && !(n.title + '\n' + n.body + '\n' + n.tags.join(' ')).toLowerCase().includes(q)) return false;
  return true;
}
function sorted(list) {
  return [...list].sort((a, b) => (b.starred - a.starred) || (b.editedAt - a.editedAt));
}

function renderList() {
  const list = sorted(store.active().filter(matches));
  els.list.replaceChildren(...(list.length ? list.map(n => {
    const s = todoStatsFor(n);
    const title = el('span', { class: 'row-title' }); appendHighlighted(title, n.title, ui.query);
    const top = el('div', { class: 'row-top' }, el('span', { class: 'dot', style: `--nd:var(--n-${n.color}-dot)` }), title);
    if (n.starred) top.insertAdjacentHTML('beforeend', `<svg class="ic star" aria-label="已收藏"><use href="#i-star"/></svg>`);
    if (isOnDesktop(n)) top.insertAdjacentHTML('beforeend', `<svg class="ic" aria-label="在桌面"><use href="#i-monitor"/></svg>`);
    top.append(el('span', { class: 'row-time' }, timeLabel(n.editedAt)));
    const ex = el('div', { class: 'row-excerpt' }); appendHighlighted(ex, excerpt(n.body, ui.query), ui.query);
    const meta = el('div', { class: 'row-meta' }, s.open ? el('span', { class: 'todo' }, `${s.open} 项待办`) : null, ...n.tags.slice(0, 3).map(t => el('span', {}, '#' + t)));
    const row = el('button', { type: 'button', class: 'app-row', 'aria-current': String(n.id === ui.active), onclick: () => open(n.id) }, top, ex, meta);
    return el('li', {}, row);
  }) : [el('li', { class: 'app-empty' }, '没有符合条件的便签')]));
}

function renderFilters() {
  const tags = [...new Set(store.active().flatMap(n => n.tags))];
  const chip = (label, on, fn, icon) => el('button', { type: 'button', class: 'chip', 'aria-pressed': String(on), onclick: fn, html: icon ? svg(icon) : '' }, label);
  const f = ui.filters;
  els.chips.replaceChildren(
    chip('已收藏', f.starred, () => { f.starred = !f.starred; refresh(); }, 'star'),
    chip('有提醒', f.reminder, () => { f.reminder = !f.reminder; refresh(); }, 'bell'),
    chip('未完成待办', f.todo, () => { f.todo = !f.todo; refresh(); }, 'check'),
    ...tags.map(t => chip('#' + t, f.tag === t, () => { f.tag = f.tag === t ? '' : t; refresh(); })),
  );
  const active = [];
  if (f.starred) active.push(['已收藏', () => f.starred = false]);
  if (f.reminder) active.push(['有提醒', () => f.reminder = false]);
  if (f.todo) active.push(['未完成待办', () => f.todo = false]);
  if (f.tag) active.push(['#' + f.tag, () => f.tag = '']);
  els.active.replaceChildren(...active.map(([label, off]) => el('button', { type: 'button', class: 'chip', 'aria-pressed': 'true', 'aria-label': `去掉筛选：${label}`, onclick: () => { off(); refresh(); }, html: '' }, label, el('span', { html: svg('x') }))));
  els.filterBtn.classList.toggle('on', active.length > 0);
}

function renderTabs() {
  els.tabs.replaceChildren(...ui.tabs.map(id => {
    const n = store.note(id);
    const sel = id === ui.active;
    const label = el('button', { type: 'button', role: 'tab', 'aria-selected': String(sel), tabindex: sel ? '0' : '-1', onclick: () => open(id) }, n.title);
    const close = el('button', { type: 'button', class: 'close', 'aria-label': `关闭标签页 ${n.title}`, onclick: () => closeTab(id), html: svg('x') });
    return el('div', { class: 'app-tab' + (sel ? ' sel' : '') }, label, close);
  }));
}

function renderEditor() {
  const n = store.note(ui.active);
  const ed = els.editor;
  if (!n) { ed.replaceChildren(el('p', { class: 'app-empty' }, '打开一张便签，开始书写')); ed.style.removeProperty('--nb'); return; }
  ed.style.setProperty('--nb', `var(--n-${n.color})`);
  const owned = desktopOwns(n);
  ed.classList.toggle('readonly', owned);
  const s = todoStatsFor(n);

  const title = el('h3', { class: 'ed-title' }); appendHighlighted(title, n.title, ui.query);
  const star = el('button', { type: 'button', class: 'ed-tool icon' + (n.starred ? ' star-on' : ''), 'aria-pressed': String(n.starred), 'aria-label': n.starred ? '取消收藏' : '收藏', onclick: () => store.update(() => { n.starred = !n.starred; }, 'meta'), html: svg('star') });
  const remind = el('div', { class: 'pop' },
    el('button', { type: 'button', class: 'ed-tool' + (n.reminder ? ' chip-time' : ' icon'), 'aria-expanded': String(ui.menu), 'aria-label': n.reminder ? `提醒：${reminderLabel(n.reminder)}，点击修改` : '设置提醒', onclick: () => { ui.menu = !ui.menu; renderEditor(); }, html: svg('bell') }, n.reminder ? reminderLabel(n.reminder) : ''),
    ui.menu ? reminderMenu(n) : null);
  const onDesk = isOnDesktop(n);
  const place = el('button', { type: 'button', class: 'ed-tool accent', onclick: () => placeOnDesktop(n), html: svg('monitor') }, onDesk ? '定位窗口' : '放到桌面');
  const head = el('div', { class: 'ed-head' }, title, star, remind, place);
  const tags = el('div', { class: 'ed-tags', 'aria-label': '标签' }, ...n.tags.map(t => el('span', { class: 'ed-tag' }, '#' + t)));

  const parts = [head, tags];
  if (owned) {
    parts.push(el('div', { class: 'ed-notice', role: 'status' }, '正在桌面窗口编辑',
      el('button', { type: 'button', onclick: () => handBack(n), html: svg('pen') }, '在这里编辑'),
      el('button', { type: 'button', onclick: () => recall(n) }, '收回中心')));
  }
  if (s.total || !owned) {
    parts.push(el('div', { class: 'ed-progress' },
      s.total ? el('span', {}, `已完成 ${s.done}/${s.total}`) : el('span', {}, '还没有待办'),
      s.total ? el('span', { class: 'ed-bar', 'aria-hidden': 'true' }, el('i', { style: `transform:scaleX(${s.done / s.total})` })) : null,
      owned ? null : el('button', { type: 'button', class: 'ed-tool ed-add', 'aria-expanded': String(ui.adding), onclick: () => { ui.adding = !ui.adding; renderEditor(); if (ui.adding) els.editor.querySelector('.ed-addrow input')?.focus(); }, html: svg('plus') }, ui.adding ? '取消添加' : '添加待办')));
  }
  const md = el('div', { class: 'md' });
  md.append(renderMd(n.body, { query: ui.query, readonly: owned, onToggle: line => store.edit(n.id, x => { x.body = toggleTodo(x.body, line); }, 'todo') }));
  parts.push(md);
  if (ui.adding && !owned) {
    const input = el('input', { type: 'text', 'aria-label': '新待办内容', placeholder: '输入后按 Enter', maxlength: '60' });
    const submit = () => { const v = input.value.trim(); if (!v) return; store.edit(n.id, x => { x.body = addTodo(x.body, v); }, 'todo'); ui.adding = true; renderEditor(); els.editor.querySelector('.ed-addrow input')?.focus(); };
    input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); submit(); } if (e.key === 'Escape') { ui.adding = false; renderEditor(); } });
    parts.push(el('div', { class: 'ed-addrow' }, input, el('button', { type: 'button', class: 'ed-tool accent', onclick: submit }, '添加')));
  }
  ed.replaceChildren(...parts);
}

function reminderMenu(n) {
  const base = new Date(NOW);
  const day = (d, h, m = 0) => new Date(base.getFullYear(), base.getMonth(), base.getDate() + d, h, m).getTime();
  const set = t => { ui.menu = false; store.update(() => { n.reminder = t; }, 'meta'); };
  return el('div', { class: 'pop-menu', role: 'menu' },
    el('p', {}, '每张便签一个一次性提醒'),
    el('button', { type: 'button', role: 'menuitem', onclick: () => set(day(0, 21)) }, '今天 21:00'),
    el('button', { type: 'button', role: 'menuitem', onclick: () => set(day(1, 9)) }, '明天 09:00'),
    el('button', { type: 'button', role: 'menuitem', onclick: () => set(day(4, 9)) }, '下周一 09:00'),
    n.reminder ? el('button', { type: 'button', role: 'menuitem', onclick: () => set(null) }, '移除提醒') : null);
}

function placeOnDesktop(n) {
  if (n.id === 'plan') {
    if (store.state.desk.form === 'center') store.update(s => { s.desk.form = 'expanded'; s.desk.fromEdge = false; }, 'desk');
    els.status.textContent = '「本周计划」已放到桌面，上方的桌面演示里也能看到。';
  } else if (n.placement === 'desktop') {
    els.status.textContent = `已定位「${n.title}」的桌面窗口。`;
  } else {
    store.update(() => { n.placement = 'desktop'; n.form = 'capsule'; }, 'meta');
    els.status.textContent = `「${n.title}」已放到桌面。`;
  }
}
function handBack(n) {
  if (n.id === 'plan') store.update(s => { s.desk.form = 'capsule'; }, 'desk');
  else store.update(() => { n.form = 'capsule'; }, 'meta');
  els.status.textContent = '桌面窗口收成胶囊，编辑移回中心。';
}
function recall(n) {
  if (n.id === 'plan') store.update(s => { s.desk.form = 'center'; }, 'desk');
  else store.update(() => { n.placement = 'center'; }, 'meta');
  els.status.textContent = '已收回中心。';
}

export function open(id) {
  if (!ui.tabs.includes(id)) ui.tabs.push(id);
  ui.active = id; ui.adding = false; ui.menu = false;
  refresh();
}
function closeTab(id) {
  const i = ui.tabs.indexOf(id);
  ui.tabs.splice(i, 1);
  if (ui.active === id) ui.active = ui.tabs[Math.min(i, ui.tabs.length - 1)] ?? null;
  els.status.textContent = '关闭标签页不会删除便签，它还在左侧列表里。';
  refresh();
}

function refresh() { renderFilters(); renderList(); renderTabs(); renderEditor(); }

export function initDaily() {
  const root = document.getElementById('app');
  if (!root) return;
  els = {
    list: document.getElementById('app-list'), tabs: document.getElementById('app-tabs'), editor: document.getElementById('app-editor'),
    chips: document.getElementById('app-filter-chips'), active: document.getElementById('app-active-filters'),
    filterBtn: document.getElementById('app-filter-btn'), filters: document.getElementById('app-filters'),
    search: document.getElementById('app-search'),
  };
  els.status = document.createElement('p'); els.status.className = 'demo-note'; els.status.setAttribute('aria-live', 'polite');
  root.after(els.status);

  els.search.addEventListener('input', () => { ui.query = els.search.value; renderList(); renderEditor(); });
  for (const b of root.querySelectorAll('[data-scope]')) b.addEventListener('click', () => {
    ui.scope = b.dataset.scope;
    for (const o of root.querySelectorAll('[data-scope]')) o.setAttribute('aria-checked', String(o === b));
    renderList();
  });
  els.filterBtn.addEventListener('click', () => {
    const open = els.filters.hidden;
    els.filters.hidden = !open; els.filterBtn.setAttribute('aria-expanded', String(open));
  });
  els.tabs.addEventListener('keydown', e => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const i = ui.tabs.indexOf(ui.active); if (i < 0) return;
    open(ui.tabs[(i + (e.key === 'ArrowRight' ? 1 : -1) + ui.tabs.length) % ui.tabs.length]);
    els.tabs.querySelector('[role="tab"][aria-selected="true"]')?.focus();
  });
  document.addEventListener('click', e => { if (ui.menu && !e.target.closest('.pop')) { ui.menu = false; renderEditor(); } });

  store.subscribe(reason => {
    if (reason === 'reset') {
      Object.assign(ui, JSON.parse(initialUi));
      els.search.value = ''; els.filters.hidden = true; els.filterBtn.setAttribute('aria-expanded', 'false');
      for (const o of root.querySelectorAll('[data-scope]')) o.setAttribute('aria-checked', String(o.dataset.scope === 'all'));
      els.status.textContent = '';
    }
    if (reason === 'desk-quiet') return;
    refresh();
  });
  refresh();
}
