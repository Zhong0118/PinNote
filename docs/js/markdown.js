// A deliberately small Markdown subset for the sample notes. Everything is built with
// createElement/textContent, so note text can never inject markup.

const TASK = /^\s*- \[( |x)\] (.*)$/i;
const BULLET = /^\s*- (.*)$/;

export function parse(body) {
  const blocks = [];
  const lines = body.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let m;
    if (!line.trim()) continue;
    if ((m = line.match(TASK))) {
      const last = blocks.at(-1);
      const item = { line: i, done: m[1].toLowerCase() === 'x', text: m[2] };
      if (last?.type === 'tasks') last.items.push(item); else blocks.push({ type: 'tasks', items: [item] });
    } else if ((m = line.match(BULLET))) {
      const last = blocks.at(-1);
      if (last?.type === 'list') last.items.push({ line: i, text: m[1] }); else blocks.push({ type: 'list', items: [{ line: i, text: m[1] }] });
    } else if ((m = line.match(/^(#{1,3}) (.*)$/))) {
      blocks.push({ type: 'heading', text: m[2], line: i });
    } else if ((m = line.match(/^> ?(.*)$/))) {
      blocks.push({ type: 'quote', text: m[1], line: i });
    } else {
      blocks.push({ type: 'p', text: line, line: i });
    }
  }
  return blocks;
}

export function todoStats(body) {
  let done = 0, total = 0;
  for (const line of body.split('\n')) {
    const m = line.match(TASK);
    if (m) { total++; if (m[1].toLowerCase() === 'x') done++; }
  }
  return { done, total, open: total - done };
}

export function toggleTodo(body, line) {
  const lines = body.split('\n');
  lines[line] = lines[line].replace(/\[( |x)\]/i, (_, c) => (c === ' ' ? '[x]' : '[ ]'));
  return lines.join('\n');
}

/** Insert a new open task after the last task line (or at the end). */
export function addTodo(body, text) {
  const lines = body.split('\n');
  let last = -1;
  lines.forEach((l, i) => { if (TASK.test(l)) last = i; });
  const item = `- [ ] ${text}`;
  if (last === -1) lines.push('', item); else lines.splice(last + 1, 0, item);
  return lines.join('\n');
}

/** Append text with matches of `query` wrapped in <mark>. */
export function appendHighlighted(el, text, query) {
  const q = (query || '').trim();
  if (!q) { el.append(text); return; }
  const lower = text.toLowerCase(), needle = q.toLowerCase();
  let from = 0, idx;
  while ((idx = lower.indexOf(needle, from)) !== -1) {
    if (idx > from) el.append(text.slice(from, idx));
    const mark = document.createElement('mark');
    mark.textContent = text.slice(idx, idx + q.length);
    el.append(mark);
    from = idx + q.length;
  }
  if (from < text.length) el.append(text.slice(from));
}

/** Plain one-line excerpt like the center list: tasks as ○/✓, starting near the first match. */
export function excerpt(body, query, max = 64) {
  const flat = parse(body).flatMap(b => {
    if (b.type === 'tasks') return b.items.map(it => (it.done ? '✓ ' : '○ ') + it.text);
    if (b.type === 'list') return b.items.map(it => it.text);
    return [b.text];
  }).join(' · ').replace(/ · (○|✓) /g, ' $1 ');
  const q = (query || '').trim().toLowerCase();
  const idx = q ? flat.toLowerCase().indexOf(q) : -1;
  if (idx > 18) return '…' + flat.slice(idx - 10, idx - 10 + max);
  return flat.length > max ? flat.slice(0, max) + '…' : flat;
}

/**
 * Render a note body. `onToggle(line)` makes task boxes interactive;
 * `readonly` disables them (another window owns editing); `added` marks lines >= that index.
 */
export function render(body, { query = '', onToggle, readonly = false, added = -1 } = {}) {
  const frag = document.createDocumentFragment();
  const mark = (el, line) => { if (added >= 0 && line >= added) el.classList.add('added'); };
  for (const b of parse(body)) {
    if (b.type === 'heading') { const h = document.createElement('h3'); appendHighlighted(h, b.text, query); mark(h, b.line); frag.append(h); }
    else if (b.type === 'p') { const p = document.createElement('p'); appendHighlighted(p, b.text, query); mark(p, b.line); frag.append(p); }
    else if (b.type === 'quote') { const q = document.createElement('blockquote'); appendHighlighted(q, b.text, query); frag.append(q); }
    else if (b.type === 'list') {
      const ul = document.createElement('ul');
      for (const it of b.items) { const li = document.createElement('li'); appendHighlighted(li, it.text, query); mark(li, it.line); ul.append(li); }
      frag.append(ul);
    } else if (b.type === 'tasks') {
      const ul = document.createElement('ul'); ul.className = 'tasks';
      for (const it of b.items) {
        const li = document.createElement('li');
        const label = document.createElement('label'); label.className = 'task' + (it.done ? ' done' : '');
        const box = document.createElement('input'); box.type = 'checkbox'; box.checked = it.done;
        box.disabled = readonly || !onToggle;
        if (onToggle && !readonly) box.addEventListener('change', () => onToggle(it.line));
        const span = document.createElement('span'); appendHighlighted(span, it.text, query);
        label.append(box, span); li.append(label); mark(li, it.line); ul.append(li);
      }
      frag.append(ul);
    }
  }
  return frag;
}
