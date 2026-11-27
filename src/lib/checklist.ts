// Ignore fenced code so examples never count as actual tasks.
const FENCE_RE = /^\s{0,3}(`{3,}|~{3,})/;
const TASK_RE = /^(\s*)(?:[-*+]|\d+[.)])\s+\[([ xX])\]\s/;

export function checklistProgress(markdown: string) {
  let fence = ''; let total = 0; let done = 0;
  for(const line of markdown.split('\n')) {
    const marker=line.match(FENCE_RE);
    if(marker) { if(!fence) fence=marker[1]; else if(marker[1][0]===fence[0]&&marker[1].length>=fence.length) fence=''; continue; }
    if(fence) continue;
    const task=line.match(TASK_RE);
    if(task) { total++; if(task[2].toLowerCase()==='x') done++; }
  }
  return {total,done};
}

/**
 * Reorder each contiguous task list block (outside fenced code blocks) so unfinished items
 * stay on top and checked items sink to the bottom, preserving relative order inside each group.
 */
export function moveCompletedToBottom(markdown: string): string {
  const lines = markdown.split('\n');
  const out: string[] = [];
  let fence = '';
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const marker = line.match(FENCE_RE);
    if (marker) {
      if (!fence) fence = marker[1];
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = '';
      out.push(line);
      i++;
      continue;
    }
    if (fence) {
      out.push(line);
      i++;
      continue;
    }

    const firstTask = line.match(TASK_RE);
    if (!firstTask) {
      out.push(line);
      i++;
      continue;
    }

    const baseIndent = firstTask[1].length;
    const openItems: string[][] = [];
    const doneItems: string[][] = [];

    while (i < lines.length) {
      const m = lines[i].match(TASK_RE);
      if (!m || m[1].length !== baseIndent) break;
      const checked = m[2].toLowerCase() === 'x';
      const itemLines = [lines[i]];
      i++;
      // Keep indented continuation lines attached to this task item.
      while (i < lines.length && lines[i].trim() !== '') {
        const nextTask = lines[i].match(TASK_RE);
        if (nextTask && nextTask[1].length <= baseIndent) break;
        const nextIndent = lines[i].match(/^(\s*)/)?.[1].length ?? 0;
        if (nextIndent <= baseIndent) break;
        itemLines.push(lines[i]);
        i++;
      }
      // Consume a single blank line separating loose list items only when another peer task follows.
      const hasBlank = i < lines.length && lines[i].trim() === '';
      const nextPeer = hasBlank && i + 1 < lines.length ? lines[i + 1].match(TASK_RE) : null;
      if (hasBlank && nextPeer && nextPeer[1].length === baseIndent) {
        i++;
      }
      (checked ? doneItems : openItems).push(itemLines);
      if (hasBlank && !(nextPeer && nextPeer[1].length === baseIndent)) {
        out.push(...[...openItems, ...doneItems].flat());
        out.push('');
        openItems.length = 0;
        doneItems.length = 0;
        i++;
        break;
      }
    }
    if (openItems.length || doneItems.length) {
      out.push(...[...openItems, ...doneItems].flat());
    }
  }
  return out.join('\n');
}

/** Extract all unfinished checklist items (outside fenced code blocks) for rolling over to a new note. */
export function extractOpenTasks(markdown: string): { openMarkdown: string; count: number } {
  const lines = markdown.split('\n');
  let fence = '';
  const open: string[] = [];
  for (const line of lines) {
    const marker = line.match(FENCE_RE);
    if (marker) {
      if (!fence) fence = marker[1];
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = '';
      continue;
    }
    if (fence) continue;
    const task = line.match(TASK_RE);
    if (task && task[2] === ' ') {
      open.push(line.replace(/^\s*(?:[-*+]|\d+[.)])\s+\[ \]\s+/, '- [ ] '));
    }
  }
  return { openMarkdown: open.join('\n'), count: open.length };
}

export type ChecklistItem = { lineIndex: number; checked: boolean; text: string };

/** List all real checklist items (outside fenced code blocks) with their exact 0-based line index. */
export function listTasks(markdown: string): ChecklistItem[] {
  const lines = markdown.split('\n');
  let fence = '';
  const items: ChecklistItem[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const marker = line.match(FENCE_RE);
    if (marker) {
      if (!fence) fence = marker[1];
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = '';
      continue;
    }
    if (fence) continue;
    const task = line.match(/^(\s*(?:[-*+]|\d+[.)])\s+)\[([ xX])\]\s+(.*)$/);
    if (task) {
      items.push({ lineIndex: i, checked: task[2].toLowerCase() === 'x', text: task[3].trim() });
    }
  }
  return items;
}

/** Toggle `[ ]` <-> `[x]` at an exact 0-based line index, skipping fenced code blocks. */
export function toggleTaskAtLine(markdown: string, lineIndex: number): string {
  const lines = markdown.split('\n');
  if (lineIndex < 0 || lineIndex >= lines.length) return markdown;
  let fence = '';
  for (let i = 0; i <= lineIndex; i++) {
    const marker = lines[i].match(FENCE_RE);
    if (marker) {
      if (!fence) fence = marker[1];
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = '';
      if (i === lineIndex) return markdown;
    }
  }
  if (fence) return markdown;
  const m = lines[lineIndex].match(/^(\s*(?:[-*+]|\d+[.)])\s+)\[([ xX])\](\s+.*)$/);
  if (!m) return markdown;
  const nextMark = m[2].toLowerCase() === 'x' ? ' ' : 'x';
  lines[lineIndex] = `${m[1]}[${nextMark}]${m[3]}`;
  return lines.join('\n');
}

export type CodeBlock = { lang: string; code: string };

/** Extract fenced code blocks (``` or ~~~) with language hint and verbatim code content. */
export function extractCodeBlocks(markdown: string): CodeBlock[] {
  const blocks: CodeBlock[] = [];
  let fence = '';
  let lang = '';
  let buf: string[] = [];
  for (const line of markdown.split('\n')) {
    const marker = line.match(/^\s{0,3}(`{3,}|~{3,})\s*([\w-]*)/);
    if (!fence && marker) {
      fence = marker[1];
      lang = marker[2] ?? '';
      buf = [];
      continue;
    }
    if (fence) {
      const close = line.match(/^\s{0,3}(`{3,}|~{3,})\s*$/);
      if (close && close[1][0] === fence[0] && close[1].length >= fence.length) {
        const code = buf.join('\n').trimEnd();
        if (code) blocks.push({ lang, code });
        fence = '';
        lang = '';
        buf = [];
      } else {
        buf.push(line);
      }
    }
  }
  return blocks;
}
