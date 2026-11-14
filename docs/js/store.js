// Shared sample notes for every demo on the page. State lives in memory only:
// reloading the page or pressing 「重置演示」 brings it back to the start.

/** Demo clock: Thursday 2026-11-12 16:20 local time (same moment as the screenshots). */
export const NOW = new Date(2026, 10, 12, 16, 20).getTime();
const at = (m, d, h = 10, min = 0) => new Date(2026, m - 1, d, h, min).getTime();

function initial() {
  return {
    notes: [
      { id: 'plan', title: '本周计划', color: 'sky', starred: true, tags: ['工作', '官网'], lifecycle: 'active',
        reminder: at(11, 13, 9, 30), placement: 'center', revision: 3,
        createdAt: at(10, 31, 9, 12), editedAt: NOW - 40 * 60e3,
        body: '周五前把官网改版定下来，其余事情顺手推进。\n\n- [x] 整理首页结构草稿\n- [ ] 补齐下载区的平台说明\n- [ ] 和设计确认深色截图\n\n周三下午留两小时读书，不排会议。' },
      { id: 'meet', title: '官网改版讨论', color: 'paper', starred: false, tags: ['官网', '会议'], lifecycle: 'active',
        reminder: null, placement: 'center', revision: 2,
        createdAt: at(11, 10, 16, 5), editedAt: at(11, 10, 19, 20),
        body: '## 11/10 讨论\n\n- 首屏同时看到中心、桌面便签和贴边标签\n- 下载按钮按访客平台高亮\n- FAQ 写清提醒要在后台运行\n\n下周再看一次移动端。' },
      { id: 'read', title: '阅读摘录', color: 'grape', starred: false, tags: ['阅读'], lifecycle: 'active',
        reminder: null, placement: 'desktop', form: 'capsule', revision: 5,
        createdAt: at(10, 23, 21, 40), editedAt: at(11, 11, 22, 15),
        body: '> 把常用的信息放在看得见的地方，记忆的负担就会小很多。\n\n想到便签：用完收起来，需要时它就在屏幕边上。' },
      { id: 'shop', title: '周末采购', color: 'mint', starred: false, tags: ['生活'], lifecycle: 'active',
        reminder: null, placement: 'desktop', form: 'tab', revision: 4,
        createdAt: at(11, 9, 20, 30), editedAt: at(11, 12, 11, 20),
        body: '- [ ] 牛奶两盒\n- [x] 咖啡豆\n- [ ] 厨房纸\n- [ ] 给阳台的薄荷换盆' },
      { id: 'oct', title: '十月计划', color: 'paper', tags: ['工作'], lifecycle: 'archived', createdAt: at(9, 28, 9), editedAt: at(10, 30, 18), archivedAt: at(11, 2, 9), body: '' },
      { id: 'trip', title: '国庆出行清单', color: 'mint', tags: ['生活'], lifecycle: 'archived', createdAt: at(9, 18, 21), editedAt: at(10, 6, 8), archivedAt: at(10, 9, 10), body: '' },
      { id: 'books', title: '夏天的读书单', color: 'grape', tags: ['阅读'], lifecycle: 'archived', createdAt: at(6, 24, 22), editedAt: at(9, 1, 21), archivedAt: at(9, 3, 9), body: '' },
    ],
    // The desk demo's note ("本周计划") and how it is shown.
    desk: { form: 'center', side: 'right', fx: .63, fy: .1, cfx: .66, cfy: .78, slot: null, fromEdge: false },
  };
}

let state = initial();
const listeners = new Set();

export const store = {
  get state() { return state; },
  note(id) { return state.notes.find(n => n.id === id); },
  active() { return state.notes.filter(n => n.lifecycle === 'active'); },
  /** Mutate through here so every demo re-renders from the same data. */
  update(fn, reason = 'change') {
    fn(state);
    for (const l of listeners) l(reason);
  },
  /** Change a note's text and bump its revision, like a real save. */
  edit(id, fn, reason = 'edit') {
    this.update(s => {
      const n = s.notes.find(x => x.id === id);
      fn(n);
      n.revision++;
      n.editedAt = NOW;
    }, reason);
  },
  subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  reset() { state = initial(); for (const l of listeners) l('reset'); },
};

/** The desk demo decides who edits 「本周计划」: an expanded desktop window, otherwise the center. */
export function desktopOwns(note) {
  if (note.id === 'plan') return state.desk.form === 'expanded';
  return note.placement === 'desktop' && note.form === 'expanded';
}

export function isOnDesktop(note) {
  if (note.id === 'plan') return state.desk.form !== 'center';
  return note.placement === 'desktop';
}

const pad = n => String(n).padStart(2, '0');
export function timeLabel(t) {
  const d = new Date(t), now = new Date(NOW);
  const day0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (t >= day0) return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (t >= day0 - 864e5) return '昨天';
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}
export function reminderLabel(t) {
  const d = new Date(t), now = new Date(NOW);
  const day0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (t >= day0 && t < day0 + 864e5) return `今天 ${hm}`;
  if (t >= day0 + 864e5 && t < day0 + 2 * 864e5) return `明天 ${hm}`;
  return `${d.getMonth() + 1}月${d.getDate()}日 ${hm}`;
}
