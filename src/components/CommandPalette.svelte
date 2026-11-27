<script lang="ts">
  import { Search, Monitor, Archive, Trash2, CornerDownLeft } from 'lucide-svelte';
  import { backdropFade, reveal } from '$lib/motion';
  import { displayTitle, noteDot } from '$lib/noteAppearance';
  import type { PinNote } from '$lib/notesStore';

  export type PaletteCommand = {
    id: string;
    label: string;
    hint?: string;
    keywords?: string;
    icon: typeof Search;
    run: () => void | Promise<void>;
  };

  type Props = {
    notes: PinNote[];
    commands: PaletteCommand[];
    onSelectNote: (id: string) => void;
    onClose: () => void;
  };
  let { notes, commands, onSelectNote, onClose }: Props = $props();

  let query = $state('');
  let activeIndex = $state(0);
  let input = $state<HTMLInputElement>();
  let listEl = $state<HTMLDivElement>();

  $effect(() => {
    input?.focus();
  });

  type Entry =
    | { kind: 'cmd'; id: string; cmd: PaletteCommand }
    | { kind: 'note'; id: string; note: PinNote; title: string };

  const items = $derived.by<Entry[]>(() => {
    const raw = query.trim();
    const commandOnly = raw.startsWith('>');
    const q = (commandOnly ? raw.slice(1) : raw).trim().toLowerCase();

    const matchedCmds: Entry[] = commands
      .filter(c => !q || `${c.label} ${c.hint ?? ''} ${c.keywords ?? ''}`.toLowerCase().includes(q))
      .map(cmd => ({ kind: 'cmd' as const, id: `cmd:${cmd.id}`, cmd }));

    if (commandOnly) return matchedCmds;

    const matchedNotes: Entry[] = notes
      .filter(n => n.lifecycle !== 'trash' || Boolean(q))
      .map(note => ({ note, title: displayTitle(note.title, note.content) }))
      .filter(({ note, title }) => !q || `${title}\n${note.content}\n${(note.tags ?? []).join(' ')}`.toLowerCase().includes(q))
      .slice(0, q ? 20 : 8)
      .map(({ note, title }) => ({ kind: 'note' as const, id: `note:${note.id}`, note, title }));

    return q ? [...matchedNotes, ...matchedCmds] : [...matchedNotes, ...matchedCmds.slice(0, 6)];
  });

  $effect(() => {
    void query;
    activeIndex = 0;
  });

  function choose(entry: Entry | undefined) {
    if (!entry) return;
    onClose();
    if (entry.kind === 'note') onSelectNote(entry.note.id);
    else void entry.cmd.run();
  }

  function scrollIntoView(idx: number) {
    const el = listEl?.querySelector<HTMLElement>(`[data-idx="${idx}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }

  function keydown(e: KeyboardEvent) {
    if (e.isComposing) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!items.length) return;
      activeIndex = (activeIndex + 1) % items.length;
      scrollIntoView(activeIndex);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!items.length) return;
      activeIndex = (activeIndex - 1 + items.length) % items.length;
      scrollIntoView(activeIndex);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(items[activeIndex]);
    }
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="palette-backdrop" transition:backdropFade onclick={e => { if (e.target === e.currentTarget) onClose(); }}>
  <div class="palette" role="dialog" aria-label="快速命令与便签跳转" transition:reveal>
    <div class="search-row">
      <Search size={15} class="lead-icon" aria-hidden="true" />
      <input
        bind:this={input}
        type="text"
        bind:value={query}
        placeholder="搜索便签或命令"
        aria-label="搜索便签或命令"
        onkeydown={keydown}
      />
      <kbd>ESC</kbd>
    </div>
    <div class="results" bind:this={listEl} role="listbox">
      {#each items as entry, idx (entry.id)}
        <button
          type="button"
          role="option"
          aria-selected={idx === activeIndex}
          data-idx={idx}
          class:active={idx === activeIndex}
          onmouseenter={() => (activeIndex = idx)}
          onclick={() => choose(entry)}
        >
          {#if entry.kind === 'note'}
            <i class="dot" style:background={noteDot(entry.note.theme, entry.note.customColor)}></i>
            <span class="label">{entry.title}</span>
            {#if entry.note.tags?.length}
              <span class="meta">#{entry.note.tags[0]}</span>
            {/if}
            {#if entry.note.lifecycle === 'archived'}
              <Archive size={12} class="badge" />
            {:else if entry.note.lifecycle === 'trash'}
              <Trash2 size={12} class="badge" />
            {:else if entry.note.placement === 'desktop'}
              <Monitor size={12} class="badge" />
            {/if}
          {:else}
            {@const Icon = entry.cmd.icon}
            <span class="cmd-icon"><Icon size={14} /></span>
            <span class="label">{entry.cmd.label}</span>
            {#if entry.cmd.hint}<span class="meta">{entry.cmd.hint}</span>{/if}
          {/if}
          {#if idx === activeIndex}<CornerDownLeft size={12} class="enter-hint" />{/if}
        </button>
      {:else}
        <div class="empty">没有找到结果</div>
      {/each}
    </div>
    <footer>
      <span><kbd>↑</kbd><kbd>↓</kbd> 选择</span>
      <span><kbd>Enter</kbd> 打开</span>
      <span><kbd>&gt;</kbd> 只看命令</span>
    </footer>
  </div>
</div>

<style>
  .palette-backdrop {
    position: fixed;
    inset: 0;
    z-index: 220;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding: min(14vh, 96px) 16px 24px;
    background: color-mix(in srgb, #000 22%, transparent);
  }
  .palette {
    width: min(520px, 100%);
    max-height: min(440px, 70vh);
    display: flex;
    flex-direction: column;
    border-radius: var(--radius-sm);
    background: var(--material);
    -webkit-backdrop-filter: var(--material-blur);
    backdrop-filter: var(--material-blur);
    box-shadow: var(--material-shadow);
    color: var(--text);
    overflow: hidden;
  }
  .search-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 14px;
    background: var(--px-rule) bottom / 100% 1px no-repeat;
  }
  .search-row :global(.lead-icon) { color: var(--muted); flex: 0 0 auto; }
  .search-row input {
    flex: 1;
    min-width: 0;
    border: 0;
    outline: 0;
    background: transparent;
    color: var(--text-strong);
    font: 14px/1.4 var(--font);
  }
  .search-row input::placeholder { color: var(--subtle); }
  kbd {
    font: 10px/1 var(--font-pixel);
    padding: 3px 5px;
    border-radius: var(--px-radius);
    background: var(--fill);
    color: var(--muted);
  }
  .results {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: 6px;
  }
  .results button {
    display: flex;
    align-items: center;
    gap: 9px;
    width: 100%;
    padding: 8px 10px;
    border: 0;
    border-radius: var(--px-radius);
    background: transparent;
    color: var(--text);
    font: 13px/1.4 var(--font);
    text-align: left;
    cursor: pointer;
    transition: background var(--motion-fast), color var(--motion-fast), box-shadow var(--motion-fast), transform var(--motion-fast);
  }
  .results button.active {
    background: var(--px-selected);
    color: var(--text-strong);
    box-shadow: var(--px-selected-edge);
  }
  .results button:active { transform: scale(.99); }
  .dot {
    width: 8px;
    height: 8px;
    flex: 0 0 auto;
    clip-path: var(--px-cut);
  }
  .cmd-icon {
    display: grid;
    place-items: center;
    width: 18px;
    color: var(--muted);
    flex: 0 0 auto;
  }
  .results button.active .cmd-icon { color: var(--accent); }
  .label {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .meta {
    font-size: 11px;
    color: var(--muted);
    flex: 0 0 auto;
  }
  .results button :global(.badge),
  .results button :global(.enter-hint) {
    color: var(--muted);
    flex: 0 0 auto;
  }
  .results button.active :global(.enter-hint) { color: var(--accent); }
  .empty {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 28px 12px;
    color: var(--muted);
    font-size: 12.5px;
  }
  footer {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 7px 14px;
    border-top: 1px solid var(--hairline);
    font-size: 11px;
    color: var(--subtle);
    background: var(--fill);
  }
  footer span:last-child { margin-left: auto; }
</style>
