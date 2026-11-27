<script lang="ts">
  import { onMount } from 'svelte';
  import { emit, emitTo, listen } from '@tauri-apps/api/event';
  import { getCurrentWindow } from '@tauri-apps/api/window';
  import { Check, Copy } from 'lucide-svelte';
  import { PREVIEW_LABEL, type PreviewSummary } from '$lib/previewWindow';
  import { listTasks, toggleTaskAtLine } from '$lib/checklist';
  import { loadNotes, noteOperation } from '$lib/notesStore';
  import { tick } from '$lib/celebrate';
  import { shortTime } from '$lib/excerpt';
  import { isMacPlatform } from '$lib/settings';
  import { applyWindowGlass, effectiveGlass, onAppearance } from '$lib/theme';

  // A summary pushed by the hovered capsule; nothing is loaded or refreshed while hidden.
  let note = $state<PreviewSummary>();
  let leaving = $state(false);
  let busyLine = $state<number | null>(null);
  let copiedIdx = $state<number | null>(null);
  let feedback = $state('');
  let timer: ReturnType<typeof setTimeout>;
  let copyTimer: ReturnType<typeof setTimeout>;
  let feedbackTimer: ReturnType<typeof setTimeout>;
  const mac = isMacPlatform();
  let glassLevel = $state(0);
  const glass = $derived(mac && glassLevel > 0);

  $effect(() => {
    document.documentElement.toggleAttribute('data-glass', glass);
    void applyWindowGlass(glass, 12);
  });

  onMount(() => {
    const stopGlass = onAppearance(a => { glassLevel = effectiveGlass(a); });
    const show = listen<PreviewSummary>('preview-show', e => {
      clearTimeout(timer);
      clearTimeout(copyTimer);
      clearTimeout(feedbackTimer);
      leaving = false;
      feedback = '';
      copiedIdx = null;
      note = e.payload;
    });
    const hover = listen<{ id: string; inside: boolean }>('preview-hover', e => {
      if (e.payload.id !== note?.id) return;
      if (e.payload.inside) enter(); else leave();
    });
    void show.then(() => emitTo(PREVIEW_LABEL, 'preview-ready'));
    return () => {
      stopGlass();
      clearTimeout(timer);
      clearTimeout(copyTimer);
      clearTimeout(feedbackTimer);
      show.then(f => f());
      hover.then(f => f());
    };
  });

  function enter() { clearTimeout(timer); leaving = false; }
  function leave() {
    clearTimeout(timer);
    timer = setTimeout(() => { leaving = true; timer = setTimeout(() => { void getCurrentWindow().hide(); leaving = false; }, 140); }, 320);
  }
  async function open() { clearTimeout(timer); if (note) await emit('expand-note-requested', { id: note.id }); await getCurrentWindow().hide(); }

  function flash(msg: string) {
    feedback = msg;
    clearTimeout(feedbackTimer);
    feedbackTimer = setTimeout(() => (feedback = ''), 1800);
  }

  async function toggleTask(lineIndex: number, event: MouseEvent) {
    if (!note || busyLine !== null) return;
    const summary = note;
    const target = summary.tasks.find(task => task.lineIndex === lineIndex);
    if (!target) return;
    busyLine = lineIndex;
    const row = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
    try {
      const fresh = (await loadNotes()).notes[summary.id];
      if (!fresh || fresh.lifecycle !== 'active') return;
      const task = listTasks(fresh.content).find(task => task.lineIndex === lineIndex);
      if (!task || task.text !== target.text || task.checked !== target.checked) {
        if (note === summary) flash('待办已更新，请重新悬停');
        return;
      }
      const nextContent = toggleTaskAtLine(fresh.content, lineIndex);
      if (nextContent === fresh.content) return;
      await noteOperation(fresh, 'save', {
        expectedRevision: fresh.revision,
        patch: { title: fresh.title, content: nextContent },
      });
      if (note !== summary) return;
      const nextChecked = !target.checked;
      note = {
        ...summary,
        done: Math.max(0, summary.done + (nextChecked ? 1 : -1)),
        tasks: summary.tasks.map(t => t.lineIndex === lineIndex ? { ...t, checked: nextChecked } : t),
      };
      if (nextChecked && row) tick(row, note.accent || '#2563eb');
    } catch {
      if (note === summary) flash('便签正在编辑中，请打开修改');
    } finally {
      busyLine = null;
    }
  }

  async function copyCode(idx: number, code: string) {
    const seq = note?.seq;
    try {
      await navigator.clipboard.writeText(code);
      if (note?.seq !== seq) return;
      copiedIdx = idx;
      clearTimeout(copyTimer);
      copyTimer = setTimeout(() => { if (copiedIdx === idx) copiedIdx = null; }, 1500);
    } catch {
      if (note?.seq === seq) flash('复制失败');
    }
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
{#if note}{#key note.seq}
<main class="from-{note.side}" class:glass class:leaving onpointerenter={enter} onpointerleave={leave}>
  <header>
    <i class="dot" style:background={note.accent}></i>
    <strong>{note.title || '未命名便签'}</strong>
  </header>
  <div class="body">
    {#if note.tasks?.length}
      <ul class="task-list">
        {#each note.tasks as item (item.lineIndex)}
          <li>
            <button type="button" class="task-btn" class:checked={item.checked} aria-pressed={item.checked} disabled={busyLine === item.lineIndex} onclick={e => void toggleTask(item.lineIndex, e)}>
              <span class="pixel-check" class:checked={item.checked} style:--box-accent={note.accent} aria-hidden="true"></span>
              <span class="text">{item.text || '（空待办）'}</span>
            </button>
          </li>
        {/each}
      </ul>
    {:else}
      <p>{note.excerpt || '暂无可显示的摘要'}</p>
    {/if}
    {#if note.codeBlocks?.length}
      <div class="code-chips">
        {#each note.codeBlocks as block, idx}
          <button type="button" class="code-chip" title="直接复制代码块" onclick={() => void copyCode(idx, block.code)}>
            {#if copiedIdx === idx}<Check size={11} />已复制{:else}<Copy size={11} />复制{block.lang ? ` ${block.lang}` : '代码'}{/if}
          </button>
        {/each}
      </div>
    {/if}
  </div>
  <footer>
    {#if feedback}<small class="warn">{feedback}</small>
    {:else}
      {#if note.total}<small>清单 {note.done}/{note.total}</small>{/if}
      {#if note.reminderAt}<small>{shortTime(note.reminderAt)}</small>{/if}
    {/if}
    <button class="open" onclick={open}>打开编辑</button>
  </footer>
</main>
{/key}{/if}

<style>
  :global(html), :global(body) { margin: 0; height: 100%; background: transparent; overflow: hidden; }
  :global(body) { font: 13px/1.55 var(--font); color: var(--text, #171717); -webkit-font-smoothing: antialiased; }
  main {
    box-sizing: border-box; position: absolute; inset: 0; padding: 13px 15px 11px; display: flex; flex-direction: column; gap: 7px;
    border: 1px solid var(--border, #0000001a); border-radius: var(--radius-lg); background: var(--surface-raised, #fffffff7);
    animation: card-in var(--motion) cubic-bezier(.2, .85, .25, 1);
    transition: opacity var(--motion-fast) ease-in, transform var(--motion-fast) ease-in;
  }
  main.glass {
    background: var(--glass-sheen), color-mix(in srgb, var(--surface-raised) var(--glass-note, 62%), transparent);
    box-shadow: inset 0 1px 0 var(--glass-edge), inset 1px 0 0 var(--glass-rim), inset 0 0 0 .5px var(--glass-rim);
  }
  main.from-right { --dx: 8px; }
  main.from-left { --dx: -8px; }
  main.leaving { opacity: 0; transform: translateX(var(--dx, 0)) scale(.985); }
  @keyframes card-in { from { opacity: 0; transform: translateX(var(--dx, 0)) scale(.98); } }
  header { display: flex; align-items: center; gap: 7px; min-width: 0; padding-bottom: 6px;
    background: var(--px-rule) bottom / 100% 1px no-repeat; }
  .dot { width: 8px; height: 8px; flex: 0 0 auto; clip-path: var(--px-cut); }
  strong { font-size: 13.5px; font-weight: 600; color: var(--text-strong); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .body { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 6px; overflow: hidden; }
  p { white-space: pre-wrap; overflow: hidden; flex: 1; color: var(--muted, #737373); margin: 0; mask-image: linear-gradient(#000 75%, transparent); }
  .task-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 1px; overflow: auto; }
  .task-btn {
    display: flex; align-items: flex-start; gap: 7px; width: 100%; border: 0; border-radius: var(--radius-sm);
    padding: 3px 4px; background: transparent; color: var(--text); font: 12.5px/1.45 var(--font); text-align: left; cursor: pointer;
    transition: background var(--motion-fast), opacity var(--motion-fast);
  }
  .task-btn:hover { background: var(--hover); }
  .task-btn.checked .text { color: var(--muted); text-decoration: line-through; }
  .text { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .code-chips { display: flex; flex-wrap: wrap; gap: 5px; margin-top: auto; }
  .code-chip {
    display: inline-flex; align-items: center; gap: 4px; border: 0; border-radius: var(--radius-sm);
    padding: 3px 9px; background: var(--fill); color: var(--text); font: 11px/1.3 var(--font); cursor: pointer;
    transition: background var(--motion-fast), color var(--motion-fast), transform var(--motion-fast);
  }
  .code-chip:hover { background: var(--hover-strong); color: var(--accent); }
  .code-chip:active { transform: scale(.96); }
  footer { display: flex; align-items: center; gap: 10px; }
  small { color: var(--muted, #737373); font-size: 11px; font-variant-numeric: tabular-nums; }
  footer small { font-family: var(--font-pixel); }
  small.warn { color: var(--danger); }
  .open {
    margin-left: auto; border: 0; border-radius: var(--radius-sm); background: var(--accent-soft, #eff6ff); color: var(--accent, #2563eb);
    padding: 4px 10px; font: inherit; font-size: 12px; cursor: pointer;
    transition: background var(--motion-fast), transform var(--motion-fast);
  }
  .open:hover { background: var(--accent-soft-strong, #dbeafe); }
  .open:active { transform: scale(.96); }
  @media (prefers-reduced-motion: reduce) { main { animation: none; } button { transition: none; } }
</style>
