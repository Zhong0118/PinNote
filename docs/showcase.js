const $ = id => document.getElementById(id);
const themes = { 杏黄: '#fff0d7', 雾蓝: '#daeaff', 鼠尾草: '#deefdf', 丁香: '#efe4fa' };
function idea(title, body, color = '杏黄') {
  return { title, body, color, pinned: false, mode: 'open', side: '', y: .35, x: .45, alarm: null };
}
const notes = [
  idea('城市的耳朵', '如果只听声音，能认出这条街吗？\n第一期，录下清晨拉开卷帘门的声音。'),
  idea('窗边的光', '给每天的窗边拍一张照片，取一个颜色做封面。', '雾蓝'),
  idea('下一期的开场', '从一段环境声开始，让听众先猜地点。', '鼠尾草')
];
let selected = notes[0];
let desktop = notes[1];
desktop.pinned = true;
let minutes = 9 * 60 + 41;
const time = value => String(Math.floor(value / 60) % 24).padStart(2, '0') + ':' + String(value % 60).padStart(2, '0');
function button(label, fn) {
  const el = document.createElement('button');
  el.textContent = label;
  el.onclick = fn;
  return el;
}
function list() {
  const query = $('search').value.trim().toLowerCase();
  $('list').replaceChildren();
  for (const note of notes.filter(n => (n.title + n.body).toLowerCase().includes(query))) {
    const row = button((note.title || '未命名便签') + (note.pinned ? ' · 桌面' : ''), () => {
      selected = note;
      if (note.pinned) desktop = note;
      render();
    });
    row.style.setProperty('--tone', themes[note.color]);
    row.setAttribute('aria-current', note === selected);
    $('list').append(row);
  }
  if (!$('list').childElementCount) $('list').textContent = '没有匹配的便签';
}
function editor() {
  const onDesktop = selected.pinned && selected.mode === 'open';
  $('title').value = selected.title;
  $('body').value = selected.body;
  $('title').readOnly = $('body').readOnly = onDesktop;
  $('location').textContent = onDesktop ? '桌面已展开 · 中心只读' : '便签中心 · 可编辑';
  $('pin').textContent = selected.pinned ? '收回中心' : '放到桌面 ↗';
  for (const swatch of $('palette').querySelectorAll('button')) swatch.setAttribute('aria-pressed', swatch.textContent === selected.color);
}
for (const [name, color] of Object.entries(themes)) {
  const swatch = button(name, () => {
    selected.color = name;
    render();
  });
  swatch.style.setProperty('--tone', color);
  $('palette').append(swatch);
}
$('new').onclick = () => {
  selected = idea('', '');
  notes.unshift(selected);
  days.at(-1).created++;
  refreshToday();
  $('search').value = '';
  render();
  $('title').focus();
};
for (const key of ['title', 'body']) $(key).oninput = () => {
  selected[key] = $(key).value;
  list();
  drawDesk();
  reminder();
};
$('search').oninput = list;
$('pin').onclick = () => {
  selected.pinned = !selected.pinned;
  selected.mode = 'open';
  selected.side = '';
  desktop = selected.pinned ? selected : notes.find(n => n.pinned);
  render();
  if (selected.pinned) $('desktop').scrollIntoView({block: 'center'});
};
$('desktop-body').oninput = () => {
  desktop.body = $('desktop-body').value;
  if (desktop === selected) $('body').value = desktop.body;
  list();
  drawDesk();
};
const desk = $('desk');
const card = $('card');
const clamp = (n, max = 1) => Math.min(max, Math.max(0, n));
function drawDesk() {
  const empty = !desktop;
  card.hidden = empty;
  $('empty').hidden = !empty;
  for (const id of ['fold','left','right','undock']) $(id).disabled = empty;
  if (empty) { desk.dataset.mode = 'empty'; return; }
  const n = desktop;
  desk.dataset.mode = n.mode;
  const width = n.mode === 'edge' ? 32 : n.mode === 'capsule' ? 150 : Math.min(230, desk.clientWidth * .82);
  const height = n.mode === 'edge' ? 105 : n.mode === 'capsule' ? 40 : 150;
  const right = desk.clientWidth - width;
  const x = n.side ? (n.side === 'left' ? 0 : right) : n.x * right;
  const y = n.y * (desk.clientHeight - height);
  card.style.left = x + 'px';
  card.style.top = y + 'px';
  card.style.setProperty('--tone', themes[n.color]);
  $('grip').textContent = n.title || '未命名便签';
  if ($('desktop-body').value !== n.body) $('desktop-body').value = n.body;
  $('peek').textContent = n.body.slice(0, 78);
  $('peek').style[n.side === 'left' ? 'left' : 'right'] = '38px';
  $('peek').style[n.side === 'left' ? 'right' : 'left'] = 'auto';
  $('peek').style.top = Math.min(y, desk.clientHeight - 100) + 'px';
  $('fold').textContent = n.mode === 'open' ? (n.side ? '收回边缘' : '收成胶囊') : '展开便签';
}
function toggle() {
  desktop.mode = desktop.mode === 'open' ? (desktop.side ? 'edge' : 'capsule') : 'open';
  render();
}
$('fold').onclick = toggle;
for (const side of ['left','right']) $(side).onclick = () => {
  desktop.side = side;
  desktop.mode = 'edge';
  render();
};
$('undock').onclick = () => {
  desktop.side = '';
  desktop.mode = 'open';
  render();
};
let drag;
const grip = $('grip');
grip.onpointerdown = event => {
  if (!event.isPrimary || event.button !== 0) return;
  drag = { x:event.clientX, y:event.clientY, left:card.offsetLeft, top:card.offsetTop, moved:false };
  grip.setPointerCapture(event.pointerId);
};
grip.onpointermove = event => {
  if (!drag) return;
  const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
  if (Math.hypot(dx, dy) < 5 && !drag.moved) return;
  drag.moved = true;
  card.classList.add('dragging');
  card.style.left = clamp(drag.left + dx, desk.clientWidth - card.offsetWidth) + 'px';
  card.style.top = clamp(drag.top + dy, desk.clientHeight - card.offsetHeight) + 'px';
};
grip.onpointerup = event => {
  if (!drag) return;
  grip.onpointermove(event);
  if (drag.moved) {
    const room = desk.clientWidth - card.offsetWidth;
    const side = card.offsetLeft < 12 ? 'left' : room - card.offsetLeft < 12 ? 'right' : '';
    desktop.x = clamp(card.offsetLeft / room);
    desktop.y = clamp(card.offsetTop / (desk.clientHeight - card.offsetHeight));
    desktop.mode = side ? 'edge' : desktop.mode === 'edge' ? 'open' : desktop.mode;
    desktop.side = side;
  } else toggle();
  drag = null;
  card.classList.remove('dragging');
  render();
};
grip.onpointercancel = () => { drag = null; card.classList.remove('dragging'); drawDesk(); };
grip.onclick = event => { if (event.detail === 0) toggle(); };
new ResizeObserver(drawDesk).observe(desk);
function reminder() {
  $('clock').textContent = time(minutes);
  $('rem-title').textContent = selected.title || '未命名便签';
  const actions = $('rem-actions');
  actions.replaceChildren();
  function action(label, fn) { actions.append(button(label, () => { fn(); reminder(); })); }
  if (selected.alarm === null) {
    $('rem-msg').textContent = '下次看这张便签，想在什么时候？';
    action('十分钟后提醒', () => { selected.alarm = minutes + 10; });
  } else if (minutes < selected.alarm) {
    $('rem-msg').textContent = '已设提醒 · ' + time(selected.alarm);
    action('演示到点', () => { minutes = selected.alarm; });
    action('移除提醒', () => { selected.alarm = null; });
  } else {
    $('rem-msg').textContent = '提醒到点了 · ' + (selected.title || '未命名便签');
    action('打开便签', () => { selected.alarm = null; $('workspace').scrollIntoView(); });
    action('延后 10 分钟', () => { selected.alarm = minutes + 10; });
    action('清除', () => { selected.alarm = null; });
  }
}
const dateLabel = new Intl.DateTimeFormat('zh-CN', { month:'long',day:'numeric' });
const today = new Date();
const days = Array.from({length:182}, (_, index) => {
  const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 181 + index);
  const edits = index % 5 === 2 || index > 177 ? 1 + index % 4 : 0;
  const created = index % 29 === 0 ? 1 : 0;
  const done = index % 19 === 0 ? 1 : 0;
  return {date, edits, created, done, total:edits + created + done};
});
function metrics() {
  const recent = days.slice(-7).reduce((sum,d) => sum + d.edits + d.created,0);
  const month = days.filter(d => d.date.getMonth() === today.getMonth()).reduce((sum,d) => sum+d.done,0);
  const streak = days.length - days.findLastIndex(d => !d.total) - 1;
  $('metrics').replaceChildren();
  for (const [label,value] of [['张便签',notes.length],['近 7 天编辑',recent],['本月完成待办',month],['天连续记录',streak]]) {
    const cell = document.createElement('div'), number = document.createElement('b'), name = document.createElement('span');
    number.textContent = value; name.textContent = label; cell.append(number,name); $('metrics').append(cell);
  }
}
function chooseDay(index) {
  const d = days[index];
  $('day').textContent = dateLabel.format(d.date) + ' · 新建 ' + d.created + ' 张 · 编辑 ' + d.edits + ' 次 · 完成 ' + d.done + ' 项';
  Array.from($('heat').children).forEach((cell,i) => { cell.setAttribute('aria-pressed',i===index); cell.tabIndex = i===index ? 0 : -1; });
}
days.forEach((d,i) => {
  const cell = button('', () => chooseDay(i));
  cell.style.background = ['#e3e8ed','#bbd4fb','#88b3ee','#5489d1','#2c65ac'][Math.min(4,d.total)];
  cell.title = dateLabel.format(d.date) + ' · ' + d.total + ' 次活动';
  cell.setAttribute('aria-label',cell.title);
  cell.onkeydown = event => {
    const delta = {ArrowUp:-1,ArrowDown:1,ArrowLeft:-7,ArrowRight:7}[event.key];
    if (!delta) return;
    event.preventDefault();
    const next = clamp(i + delta,days.length-1);
    chooseDay(next); $('heat').children[next].focus();
  };
  $('heat').append(cell);
});
function refreshToday() {
  const d = days.at(-1);
  d.total = d.edits + d.created + d.done;
  const cell = $('heat').lastElementChild;
  cell.style.background = ['#e3e8ed','#bbd4fb','#88b3ee','#5489d1','#2c65ac'][Math.min(4,d.total)];
  cell.title = dateLabel.format(d.date) + ' · ' + d.total + ' 次活动';
  cell.setAttribute('aria-label',cell.title);
  if (cell.tabIndex === 0) chooseDay(days.length-1);
  metrics();
}
for (const field of ['title','body','desktop-body']) $(field).addEventListener('change', () => {
  days.at(-1).edits++;
  refreshToday();
});
chooseDay(days.length-1);
function render() { list(); editor(); drawDesk(); reminder(); metrics(); }
render();
