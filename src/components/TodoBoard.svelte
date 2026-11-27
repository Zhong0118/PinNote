<script lang="ts">
  import { ArrowLeft, ListTodo, Monitor, ArrowUpRight } from 'lucide-svelte';
  import { overlay } from '$lib/motion';
  import { listTasks, type ChecklistItem } from '$lib/checklist';
  import { displayTitle, noteDot } from '$lib/noteAppearance';
  import { tick, tintedConfetti } from '$lib/celebrate';
  import type { PinNote } from '$lib/notesStore';

  type Props = {
    notes: PinNote[];
    onToggleTask: (noteId: string, lineIndex: number) => Promise<boolean>;
    onOpenNote: (noteId: string) => void;
    onClose: () => void;
  };
  let { notes, onToggleTask, onOpenNote, onClose }: Props = $props();

  let onlyOpen = $state(true);
  let toggling = $state('');

  type Group = {
    note: PinNote;
    title: string;
    items: ChecklistItem[];
    openCount: number;
    doneCount: number;
    shown: ChecklistItem[];
  };

  const groups = $derived.by<Group[]>(() => {
    const out: Group[] = [];
    for (const note of notes) {
      if (note.lifecycle !== 'active') continue;
      const items = listTasks(note.content);
      if (!items.length) continue;
      const openCount = items.filter(t => !t.checked).length;
      const doneCount = items.length - openCount;
      const shown = onlyOpen ? items.filter(t => !t.checked) : items;
      if (onlyOpen && !shown.length) continue;
      out.push({ note, title: displayTitle(note.title, note.content), items, openCount, doneCount, shown });
    }
    return out;
  });

  const totals = $derived.by(() => {
    let open = 0, done = 0, noteCount = 0;
    for (const note of notes) {
      if (note.lifecycle !== 'active') continue;
      const items = listTasks(note.content);
      if (!items.length) continue;
      noteCount++;
      for (const item of items) { if (item.checked) done++; else open++; }
    }
    return { open, done, noteCount };
  });

  async function toggle(group: Group, item: ChecklistItem, event: MouseEvent) {
    const key = `${group.note.id}:${item.lineIndex}`;
    if (toggling) return;
    toggling = key;
    const row = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
    const finishingGroup = !item.checked && group.openCount === 1;
    try {
      const ok = await onToggleTask(group.note.id, item.lineIndex);
      if (ok && !item.checked && row) {
        const accent = noteDot(group.note.theme, group.note.customColor);
        tick(row, accent);
        if (finishingGroup) {
          const r = row.getBoundingClientRect();
          tintedConfetti(r.left + 12, r.top + 10, accent);
        }
      }
    } finally {
      toggling = '';
    }
  }

  function keydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && !e.isComposing) {
      e.preventDefault();
      onClose();
    }
  }
</script>

<svelte:window onkeydown={keydown} />

<section class="todo-board" aria-label="跨便签待办汇总" transition:overlay>
  <div class="drag-strip" data-tauri-drag-region aria-hidden="true"></div>
  <header>
    <button class="back" onclick={onClose}><ArrowLeft size={15} />返回便签</button>
    <div class="title">
      <ListTodo size={17} />
      <h2>待办汇总</h2>
      <span class="summary">未完成 {totals.open} · 已完成 {totals.done} · {totals.noteCount} 张便签</span>
    </div>
    <div class="mode-seg" role="radiogroup" aria-label="待办筛选">
      <button role="radio" aria-checked={onlyOpen} class:on={onlyOpen} onclick={() => (onlyOpen = true)}>未完成</button>
      <button role="radio" aria-checked={!onlyOpen} class:on={!onlyOpen} onclick={() => (onlyOpen = false)}>全部</button>
    </div>
  </header>
  <div class="board-body">
    <div class="board-inner">
      {#each groups as group (group.note.id)}
        <article class="group-card">
          <div class="group-head">
            <button class="note-link" onclick={() => onOpenNote(group.note.id)}>
              <i class="dot" style:background={noteDot(group.note.theme, group.note.customColor)}></i>
              <strong>{group.title}</strong>
              {#if group.note.placement === 'desktop'}<Monitor size={12} class="desk" />{/if}
              <ArrowUpRight size={13} class="jump" />
            </button>
            <small>{group.doneCount}/{group.items.length}</small>
          </div>
          <ul>
            {#each group.shown as item (`${group.note.id}:${item.lineIndex}`)}
              <li>
                <button
                  type="button"
                  class="task-row"
                  class:checked={item.checked}
                  aria-pressed={item.checked}
                  disabled={toggling === `${group.note.id}:${item.lineIndex}`}
                  onclick={e => void toggle(group, item, e)}
                >
                  <span class="pixel-check" class:checked={item.checked} style:--box-accent={noteDot(group.note.theme, group.note.customColor)} aria-hidden="true"></span>
                  <span class="text">{item.text || '（空待办）'}</span>
                </button>
              </li>
            {/each}
          </ul>
        </article>
      {:else}
        <div class="board-empty">
          <ListTodo size={24} />
          <p>{onlyOpen ? '没有未完成的待办' : '暂无待办'}</p>
          {#if onlyOpen && totals.done > 0}
            <button class="show-all" onclick={() => (onlyOpen = false)}>查看已完成项（{totals.done}）</button>
          {/if}
        </div>
      {/each}
    </div>
  </div>
</section>

<style>
  .todo-board {
    position: absolute;
    inset: 0;
    z-index: 38;
    display: flex;
    flex-direction: column;
    background: var(--surface);
    color: var(--text);
  }
  :global(:root[data-glass]) .todo-board {
    background: color-mix(in srgb, var(--surface) var(--glass-page, 84%), transparent);
  }
  .drag-strip {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 36px;
    z-index: 1;
  }
  header {
    position: relative;
    z-index: 2;
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 40px 24px 14px;
    border-bottom: 1px solid var(--hairline);
  }
  .back {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    border: 0;
    border-radius: var(--px-radius);
    padding: 6px 10px;
    background: transparent;
    color: var(--muted);
    font: inherit;
    font-size: 13px;
    cursor: pointer;
    transition: background var(--motion-fast), color var(--motion-fast);
  }
  .back:hover { background: var(--hover); color: var(--text); }
  .title {
    display: flex;
    align-items: baseline;
    gap: 8px;
    flex: 1;
    min-width: 0;
    color: var(--text-strong);
  }
  .title h2 { margin: 0; font-size: 17px; font-weight: 600; }
  .summary { font-size: 12px; color: var(--muted); font-variant-numeric: tabular-nums; }
  .mode-seg {
    display: inline-flex;
    padding: 2px;
    gap: 2px;
    border-radius: var(--px-radius);
    background: var(--fill);
  }
  .mode-seg button {
    border: 0;
    border-radius: var(--px-radius);
    padding: 4px 10px;
    background: transparent;
    color: var(--muted);
    font: 12px/1.3 var(--font);
    cursor: pointer;
    transition: background var(--motion-fast), color var(--motion-fast), box-shadow var(--motion-fast), transform var(--motion-fast);
  }
  .mode-seg button:active { transform: scale(.96); }
  .mode-seg button.on {
    background: var(--px-selected);
    color: var(--text-strong);
    box-shadow: var(--px-selected-edge);
    font-weight: 600;
  }
  .board-body {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: 18px 24px 32px;
  }
  .board-inner {
    max-width: 720px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .group-card {
    border-radius: var(--radius-lg);
    background: color-mix(in srgb, var(--surface-raised) 82%, transparent);
    border: 1px solid var(--hairline);
    padding: 12px 14px;
  }
  .group-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 6px;
  }
  .note-link {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    min-width: 0;
    border: 0;
    border-radius: var(--radius-sm);
    padding: 3px 6px 3px 2px;
    background: transparent;
    color: var(--text-strong);
    font: 13.5px/1.4 var(--font);
    cursor: pointer;
    transition: background var(--motion-fast), color var(--motion-fast);
  }
  .note-link:hover { background: var(--hover); color: var(--accent); }
  .note-link strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
  .note-link :global(.desk), .note-link :global(.jump) { color: var(--muted); flex: 0 0 auto; }
  .dot { width: 8px; height: 8px; flex: 0 0 auto; clip-path: var(--px-cut); }
  .group-head small { font-size: 11px; color: var(--muted); font-variant-numeric: tabular-nums; }
  ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
  .task-row {
    display: flex;
    align-items: flex-start;
    gap: 9px;
    width: 100%;
    border: 0;
    border-radius: var(--radius-sm);
    padding: 6px 6px;
    background: transparent;
    color: var(--text);
    font: 13.5px/1.5 var(--font);
    text-align: left;
    cursor: pointer;
    transition: background var(--motion-fast), opacity var(--motion-fast);
  }
  .task-row:hover { background: var(--hover); }
  .task-row.checked .text { color: var(--muted); text-decoration: line-through; }
  .text { flex: 1; min-width: 0; overflow-wrap: anywhere; }
  .board-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    padding: 56px 16px;
    color: var(--muted);
    text-align: center;
  }
  .board-empty p { margin: 0; font-size: 13.5px; }
  .show-all {
    border: 0;
    border-radius: var(--radius);
    padding: 6px 12px;
    background: var(--accent-soft);
    color: var(--accent);
    font: 12.5px/1.4 var(--font);
    cursor: pointer;
  }
  .show-all:hover { background: var(--accent-soft-strong); }
</style>
