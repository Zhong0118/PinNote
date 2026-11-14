// Local activity heatmap with sample data tied to the sample notes.
// Levels follow library.ts: share of the busiest day, 0 / ≤25% / ≤50% / ≤75% / more.
import { store, NOW } from './shared.js';

const WEEKS = 20, DAY = 864e5;
const startOfDay = t => { const d = new Date(t); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); };
const addDays = (t, n) => { const d = new Date(t); return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n).getTime(); };
const key = t => { const d = new Date(t); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };
const WD = ['日', '一', '二', '三', '四', '五', '六'];

let cells = [], days = new Map(), selected = null, grid, dayEl, statsEl;

function build() {
  const notes = store.state.notes;
  const today = startOfDay(NOW);
  const monday = addDays(today, -((new Date(today).getDay() + 6) % 7));
  const first = addDays(monday, -7 * (WEEKS - 1));
  let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  days = new Map();
  const add = (t, id, kind, n = 1) => {
    const k = key(t); const d = days.get(k) ?? { edits: 0, created: 0, done: 0, notes: new Map() };
    d[kind] += n;
    const per = d.notes.get(id) ?? { edits: 0, created: 0, done: 0 }; per[kind] += n; d.notes.set(id, per);
    days.set(k, d);
  };
  for (let t = first; t <= today; t = addDays(t, 1)) {
    const alive = notes.filter(n => startOfDay(n.createdAt) < t && t < startOfDay(Math.min(n.editedAt, n.archivedAt ?? Infinity)));
    if (!alive.length) continue;
    const wd = new Date(t).getDay();
    if (rnd() > (wd === 0 || wd === 6 ? .3 : .68)) continue;
    const count = 1 + Math.floor(rnd() * Math.min(2, alive.length));
    for (let i = 0; i < count; i++) {
      const n = alive[Math.floor(rnd() * alive.length)];
      add(t, n.id, 'edits', 1 + Math.floor(rnd() * (wd === 3 ? 6 : 4)));
      if (rnd() < .25) add(t, n.id, 'done', 1);
    }
  }
  for (const n of notes) { add(startOfDay(n.createdAt), n.id, 'created'); add(startOfDay(n.editedAt), n.id, 'edits'); }
  add(today, 'plan', 'done', 1); // checked off 「整理首页结构草稿」 today

  const score = d => (d ? d.edits + d.created + d.done : 0);
  let max = 0;
  for (let i = 0; i < WEEKS * 7; i++) max = Math.max(max, score(days.get(key(addDays(first, i)))));
  cells = [];
  for (let i = 0; i < WEEKS * 7; i++) {
    const t = addDays(first, i), d = days.get(key(t)), s = score(d), share = max ? s / max : 0;
    cells.push({ t, d, future: t > today, level: s === 0 ? 0 : share <= .25 ? 1 : share <= .5 ? 2 : share <= .75 ? 3 : 4 });
  }
}

function stats() {
  const today = startOfDay(NOW);
  let week = 0, done = 0;
  for (const [k, d] of days) {
    const [y, m, dd] = k.split('-').map(Number), t = new Date(y, m - 1, dd).getTime();
    if (t > addDays(today, -7)) week += d.edits;
    if (new Date(t).getMonth() === new Date(NOW).getMonth()) done += d.done;
  }
  let streak = 0; for (let t = today; days.get(key(t)); t = addDays(t, -1)) streak++;
  const active = store.active().length, archived = store.state.notes.filter(n => n.lifecycle === 'archived').length;
  const item = (b, s) => { const div = document.createElement('div'); const bb = document.createElement('b'); bb.textContent = b; const ss = document.createElement('span'); ss.textContent = s; div.append(bb, ss); return div; };
  statsEl.replaceChildren(item(active, `便签 · 归档 ${archived}`), item(week, '近 7 天编辑'), item(done, '本月完成待办'), item(`${streak} 天`, '连续记录'));
}

function label(c) {
  const d = new Date(c.t);
  const head = `${d.getMonth() + 1}月${d.getDate()}日 周${WD[d.getDay()]}`;
  if (c.future) return `${head}，还没到`;
  if (!c.d) return `${head}，没有记录`;
  return `${head}，编辑 ${c.d.edits} 次，新建 ${c.d.created}，完成 ${c.d.done}`;
}

function renderGrid() {
  grid.replaceChildren(...cells.map((c, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.l = String(c.level); b.dataset.i = String(i);
    if (c.future) { b.dataset.future = ''; b.disabled = true; }
    b.setAttribute('aria-label', label(c)); b.title = label(c);
    b.tabIndex = i === selected ? 0 : -1;
    b.setAttribute('aria-pressed', String(i === selected));
    return b;
  }));
}

function select(i, focus = false) {
  if (i < 0 || i >= cells.length || cells[i].future) return;
  const prev = grid.querySelector(`[data-i="${selected}"]`);
  if (prev) { prev.tabIndex = -1; prev.setAttribute('aria-pressed', 'false'); }
  selected = i;
  const btn = grid.querySelector(`[data-i="${i}"]`);
  btn.tabIndex = 0; btn.setAttribute('aria-pressed', 'true');
  if (focus) btn.focus();
  renderDay();
}

function renderDay() {
  const c = cells[selected];
  const d = new Date(c.t);
  const h = document.createElement('h3');
  h.textContent = `${d.getMonth() + 1}月${d.getDate()}日 周${WD[d.getDay()]}${c.t === startOfDay(NOW) ? ' · 今天' : ''}`;
  const span = document.createElement('span');
  span.textContent = c.d ? `编辑 ${c.d.edits} · 新建 ${c.d.created} · 完成 ${c.d.done}` : '';
  h.append(span);
  const parts = [h];
  if (!c.d) { const p = document.createElement('p'); p.className = 'empty'; p.textContent = '这天没有记录。'; parts.push(p); }
  else {
    const ul = document.createElement('ul');
    for (const [id, per] of c.d.notes) {
      const n = store.note(id); if (!n) continue;
      const li = document.createElement('li');
      const kind = document.createElement('span'); kind.className = 'kind';
      kind.textContent = per.created ? '新建' : per.done ? '完成待办' : '编辑';
      const dot = document.createElement('span'); dot.className = 'dot'; dot.style.setProperty('--nd', `var(--n-${n.color}-dot)`);
      const name = document.createElement('span'); name.textContent = n.title + (n.lifecycle === 'archived' ? '（已归档）' : '');
      const count = document.createElement('span'); count.className = 'fine'; count.textContent = per.edits ? `${per.edits} 次编辑` : '';
      li.append(kind, dot, name, count); ul.append(li);
    }
    parts.push(ul);
  }
  dayEl.replaceChildren(...parts);
}

export function initHeatmap() {
  grid = document.getElementById('heat'); dayEl = document.getElementById('heat-day'); statsEl = document.getElementById('heat-stats');
  if (!grid) return;
  const setup = () => {
    build(); stats();
    selected = cells.findIndex(c => c.t === startOfDay(NOW));
    renderGrid(); renderDay();
  };
  grid.addEventListener('click', e => { const b = e.target.closest('button[data-i]'); if (b) select(Number(b.dataset.i)); });
  grid.addEventListener('keydown', e => {
    const moves = { ArrowUp: -1, ArrowDown: 1, ArrowLeft: -7, ArrowRight: 7, Home: -selected % 7, End: 6 - (selected % 7) };
    if (!(e.key in moves)) return;
    e.preventDefault();
    select(selected + moves[e.key], true);
  });
  store.subscribe(reason => { if (reason === 'reset') setup(); });
  setup();
}
