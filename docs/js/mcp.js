// AI / MCP flow, scripted. No model is called and nothing leaves the page. Tool names,
// argument shapes and error codes follow scripts/pinnote-mcp.mjs and src-tauri/src/integration.rs.
import { store } from './shared.js';
import { render as renderMd } from './markdown.js';
import { open as openInCenter } from './daily.js';

const EDITS = ['首屏换成中心、桌面便签和贴边标签的合成图', '下载按钮按访客平台高亮', 'FAQ 写清提醒要在后台运行'];
const APPEND = '\n\n' + EDITS.map(t => `- [ ] ${t}`).join('\n');

let chat, nextBtn, enabled, write;
let phase = 'start', readRevision = null, beforeAppend = null;

const svgIcon = id => `<svg class="ic" aria-hidden="true"><use href="#i-${id}"/></svg>`;
function node(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

function userMessage() {
  const m = node('div', 'msg user');
  m.append('找一下和官网改版有关的便签，把会上定的三处修改追加到「本周计划」：');
  const ol = node('ol'); for (const t of EDITS) ol.append(node('li', null, t));
  m.append(ol); return m;
}
function agentMessage(text) { return node('div', 'msg agent', text); }
function call(name, args, result, { error = false } = {}) {
  const c = node('div', 'call ' + (error ? 'err' : 'ok'));
  const head = node('div', 'call-head');
  head.innerHTML = svgIcon('plug');
  head.append('调用 ', node('code', null, name));
  const pre = node('pre');
  pre.textContent = JSON.stringify(args) + '\n→ ' + (typeof result === 'string' ? result : JSON.stringify(result, null, 1));
  c.append(head, pre); return c;
}
function add(...items) { chat.append(...items); items.at(-1)?.scrollIntoView?.({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); }
function setButton(label, disabled = false) { nextBtn.textContent = label; nextBtn.disabled = disabled; }

const disabledError = 'INTEGRATION_DISABLED: 请在 PinNote 设置中启用集成';
const brief = n => ({ id: n.id, title: n.title, revision: n.revision, lifecycle: n.lifecycle, placement: n.id === 'plan' ? (store.state.desk.form === 'center' ? 'center' : 'desktop') : n.placement });

function step() {
  const plan = store.note('plan'), meet = store.note('meet');
  if (phase === 'start') {
    if (!enabled.checked) { add(call('search_notes', { query: '官网' }, disabledError, { error: true }), agentMessage('PinNote 的本地 MCP 还没有启用。打开上方的「启用本地 MCP」后再试。')); setButton('重试'); return; }
    searchStep(); return;
  }
  if (phase === 'retry-search') {
    if (!enabled.checked) { add(call('search_notes', { query: '官网' }, disabledError, { error: true })); return; }
    searchStep(); return;
  }
  if (phase === 'read') {
    if (!enabled.checked) { add(call('read_note', { id: 'meet' }, disabledError, { error: true })); return; }
    readRevision = plan.revision;
    add(call('read_note', { id: 'meet' }, { id: meet.id, title: meet.title, revision: meet.revision, content: meet.body.slice(0, 46) + '…' }),
      call('read_note', { id: 'plan' }, { id: plan.id, title: plan.title, revision: plan.revision, content: plan.body.slice(0, 30) + '…' }),
      agentMessage('读到了。「官网改版讨论」里定了三处修改，下面是准备追加到「本周计划」末尾的内容，还没有写入。'));
    const box = node('div', 'preview-box');
    box.append(node('h5', null, '预览：追加到「本周计划」'));
    const md = node('div', 'md'); md.append(renderMd(plan.body + APPEND, { added: plan.body.split('\n').length + 1, readonly: true }));
    box.append(md); add(box);
    phase = 'write'; setButton('写入「本周计划」'); return;
  }
  if (phase === 'write') {
    const args = { id: 'plan', content: APPEND.replace(/\n/g, '\\n'), expectedRevision: readRevision };
    if (!enabled.checked) { add(call('append_note', args, disabledError, { error: true })); return; }
    if (!write.checked) {
      add(call('append_note', args, 'READ_ONLY: 未启用写入权限', { error: true }), agentMessage('写入被拒绝：PinNote 现在只允许读取。要继续，请打开「允许 agent 修改便签」。'));
      setButton('重试写入'); return;
    }
    if (plan.revision !== readRevision) {
      add(call('append_note', args, 'VERSION_CONFLICT', { error: true }), agentMessage('「本周计划」在读取之后被改过，需要重新读取再写。'));
      phase = 'read'; setButton('重新读取'); return;
    }
    beforeAppend = plan.body;
    store.edit('plan', n => { n.body = n.body + APPEND; }, 'agent');
    const updated = store.note('plan');
    add(call('append_note', args, { id: 'plan', revision: updated.revision, lifecycle: 'active' }),
      agentMessage('已经追加到「本周计划」末尾。这次修改记在「设置 → 集成 → agent 修改记录」里，可以撤销。'));
    phase = 'done';
    const actions = node('div', 'ai-actions');
    const view = node('button', 'btn btn-quiet', '在便签中心查看'); view.type = 'button';
    view.addEventListener('click', () => { openInCenter('plan'); document.getElementById('daily').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); });
    const undo = node('button', 'btn btn-quiet', '撤销这次修改'); undo.type = 'button';
    undo.addEventListener('click', () => {
      if (beforeAppend == null) return;
      store.edit('plan', n => { n.body = beforeAppend; }, 'agent');
      beforeAppend = null; undo.disabled = true;
      add(agentMessage('已撤销，「本周计划」回到这次修改之前。'));
    });
    actions.append(view, undo); add(actions);
    setButton('已完成', true);
  }
}
function searchStep() {
  const q = '官网';
  const results = store.active().filter(n => (n.title + '\n' + n.body).toLowerCase().includes(q)).map(brief);
  add(call('search_notes', { query: q }, results), agentMessage(`找到 ${results.length} 张相关便签。接下来读取内容。`));
  phase = 'read'; setButton('读取便签');
}

export function resetMcp() {
  chat.replaceChildren(userMessage(), node('p', 'fine', 'MCP 默认关闭。可以先不打开开关，直接发送，看看会发生什么。'));
  enabled.checked = false; write.checked = false; write.disabled = true;
  phase = 'start'; readRevision = null; beforeAppend = null;
  setButton('发送请求');
}

export function initMcp() {
  chat = document.getElementById('ai-chat'); nextBtn = document.getElementById('ai-next');
  enabled = document.getElementById('mcp-enabled'); write = document.getElementById('mcp-write');
  if (!chat) return;
  nextBtn.addEventListener('click', () => { chat.querySelector(':scope > p.fine')?.remove(); if (phase === 'start' && chat.querySelector('.call')) phase = 'retry-search'; step(); });
  // Like the app: agent writes can only be allowed once MCP itself is on.
  enabled.addEventListener('change', () => { if (!enabled.checked) write.checked = false; write.disabled = !enabled.checked; });
  store.subscribe(reason => { if (reason === 'reset') resetMcp(); });
  resetMcp();
}
