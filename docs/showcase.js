const desk = document.querySelector('#desk');
const caption = document.querySelector('#mode-caption');
const play = document.querySelector('#play');
const controls = [...document.querySelectorAll('button[data-mode]')];
const captions = {
  open: '桌面便签独立展开，可以边看行程边核对清单。',
  capsule: '收成胶囊后留下标题，需要时可以在原处展开。',
  edge: '停在边签上看摘要，点击边签就能展开。'
};
let timer;
function show(mode) {
  desk.dataset.mode = mode;
  caption.textContent = captions[mode];
  document.querySelector('#note-toggle').setAttribute('aria-label', mode === 'open' ? '将出发清单收为胶囊' : '展开出发清单');
  for (const control of controls) control.setAttribute('aria-pressed', String(control.dataset.mode === mode));
}
function stop() {
  clearTimeout(timer);
  timer = undefined;
  play.textContent = '播放演示';
}
for (const control of controls) {
  control.addEventListener('click', () => {
    stop();
    show(control.dataset.mode);
  });
}
play.addEventListener('click', () => {
  if (timer !== undefined) return stop();
  play.textContent = '暂停演示';
  const sequence = ['open', 'capsule', 'edge', 'open'];
  function step(index) {
    show(sequence[index]);
    if (index === sequence.length - 1) stop();
    else timer = setTimeout(() => step(index + 1), 1800);
  }
  step(sequence.indexOf(desk.dataset.mode));
});
document.querySelector('.tasks').addEventListener('change', () => {
  const done = document.querySelectorAll('.tasks :checked').length;
  document.querySelector('progress').value = done;
  document.querySelector('#count').textContent = '已完成 ' + done + ' / 3';
});
const rows = [...document.querySelectorAll('#results li')];
document.querySelector('#query').addEventListener('input', event => {
  const query = event.target.value.trim().toLowerCase();
  for (const row of rows) row.hidden = !row.textContent.toLowerCase().includes(query);
  const total = rows.filter(row => !row.hidden).length;
  document.querySelector('#matches').textContent = total ? total + ' 张便签' : '没有匹配的便签';
});
const original = document.querySelector('#current').textContent;
const restore = document.querySelector('#restore');
restore.addEventListener('click', () => {
  const restoring = restore.textContent === '恢复这版示例';
  document.querySelector('#current').textContent = restoring ? '周六 08:30，车站东门集合。' : original;
  restore.textContent = restoring ? '重置示例' : '恢复这版示例';
  document.querySelector('#restored').textContent = restoring ? '已恢复上一版' : '';
});

document.querySelector('#note-toggle').addEventListener('click', () => {
  stop();
  show(desk.dataset.mode === 'open' ? 'capsule' : 'open');
});
