<script lang="ts">
  import { ChevronDown, ChevronUp, Search, X } from 'lucide-svelte';
  import { reveal } from '$lib/motion';

  type Props = {
    query: string;
    matchIndex: number;
    matchCount: number;
    onQuery: (value: string) => void;
    onNext: () => void;
    onPrev: () => void;
    onClose: () => void;
  };
  let { query, matchIndex, matchCount, onQuery, onNext, onPrev, onClose }: Props = $props();
  let input = $state<HTMLInputElement>();

  export function focus() {
    input?.focus();
    input?.select();
  }

  $effect(() => {
    requestAnimationFrame(() => {
      input?.focus();
      input?.select();
    });
  });

  function keydown(e: KeyboardEvent) {
    if (e.isComposing) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) onPrev();
      else onNext();
    }
  }
</script>

<div class="find-bar" role="search" aria-label="文内查找" transition:reveal>
  <Search size={13} class="find-icon" aria-hidden="true" />
  <input
    bind:this={input}
    type="text"
    value={query}
    placeholder="文内查找"
    aria-label="文内查找关键字"
    oninput={e => onQuery(e.currentTarget.value)}
    onkeydown={keydown}
  />
  {#if query}
    <span class="find-count" class:empty={matchCount === 0}>
      {matchCount ? `${matchIndex + 1}/${matchCount}` : '0/0'}
    </span>
  {/if}
  <button type="button" aria-label="上一个匹配" title="上一个（Shift+Enter）" disabled={!matchCount} onclick={onPrev}>
    <ChevronUp size={14} />
  </button>
  <button type="button" aria-label="下一个匹配" title="下一个（Enter）" disabled={!matchCount} onclick={onNext}>
    <ChevronDown size={14} />
  </button>
  <button type="button" aria-label="关闭查找" title="关闭（Esc）" onclick={onClose}>
    <X size={13} />
  </button>
</div>

<style>
  .find-bar {
    position: absolute;
    z-index: 20;
    top: 8px;
    right: 14px;
    display: flex;
    align-items: center;
    gap: 3px;
    max-width: calc(100% - 28px);
    padding: 4px 5px 4px 9px;
    border-radius: var(--radius);
    background: var(--material);
    -webkit-backdrop-filter: var(--material-blur);
    backdrop-filter: var(--material-blur);
    box-shadow: var(--material-shadow);
    color: var(--text);
    font: 12px/1.4 var(--font);
    transform-origin: top right;
  }
  .find-bar :global(.find-icon) { flex: 0 0 auto; color: var(--muted); }
  input {
    width: 148px;
    min-width: 72px;
    border: 0;
    outline: 0;
    background: transparent;
    color: var(--text);
    font: inherit;
    padding: 2px 4px;
  }
  input::placeholder { color: var(--subtle); }
  .find-count {
    flex: 0 0 auto;
    padding: 0 4px;
    font: 11px/1.4 var(--font-pixel);
    font-variant-numeric: tabular-nums;
    color: var(--muted);
  }
  .find-count.empty { color: var(--danger); }
  button {
    flex: 0 0 auto;
    width: 22px;
    height: 22px;
    display: grid;
    place-items: center;
    padding: 0;
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--muted);
    cursor: pointer;
    transition: background var(--motion-fast), color var(--motion-fast), transform var(--motion-fast);
  }
  button:hover:not(:disabled) { background: var(--hover-strong); color: var(--text); }
  button:active:not(:disabled) { transform: scale(.93); }
  button:disabled { opacity: .35; cursor: default; }
  button:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
  @media (prefers-reduced-motion: reduce) { button { transition: none; } }
</style>
