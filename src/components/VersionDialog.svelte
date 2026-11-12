<script lang="ts">
  // Earlier versions of one note. Restoring keeps the current text as a version too,
  // so a restore can itself be undone from the same list.
  import { invoke } from '@tauri-apps/api/core';
  import { History, X, RotateCcw } from 'lucide-svelte';
  import { popup, reveal } from '$lib/motion';
  import { plainExcerpt, shortTime } from '$lib/excerpt';
  import { onMount } from 'svelte';
  type Version = { at: number; title: string; content: string };
  let { id, title, current, onRestore, onClose }:
    { id: string; title: string; current: string; onRestore: (at: number) => Promise<void>; onClose: () => void } = $props();
  let versions = $state<Version[]>([]);
  let chosen = $state<Version>();
  let loading = $state(true);
  let busy = $state(false);
  let error = $state('');
  onMount(() => {
    void invoke<Version[]>('note_versions', { id })
      .then(list => { versions = list; chosen = list[0]; })
      .catch(e => error = String(e))
      .finally(() => loading = false);
  });
  const size = (text: string) => `${text.replace(/\s/g, '').length} 字`;
  async function restore() {
    if (!chosen || busy) return;
    busy = true; error = '';
    try { await onRestore(chosen.at); onClose(); }
    catch (e) { error = String(e).replace(/^Error:\s*/, ''); }
    finally { busy = false; }
  }
</script>

<div class="scrim" aria-hidden="true"></div>
<div class="versions" role="dialog" aria-label="历史版本" tabindex="-1" use:popup={() => { if (!busy) onClose(); }} transition:reveal>
  <header>
    <span class="badge"><History size={16} /></span>
    <div><strong>历史版本</strong><small>{title || '未命名便签'}</small></div>
    <button class="icon" aria-label="关闭历史版本" disabled={busy} onclick={onClose}><X size={15} /></button>
  </header>
  {#if loading}
    <p class="empty">正在读取…</p>
  {:else if !versions.length}
    <p class="empty">还没有历史版本。<br />停下 10 分钟以上再继续编辑时，会自动保留之前的内容；最多保留 20 个版本。</p>
  {:else}
    <div class="body">
      <ul aria-label="版本列表">
        {#each versions as version (version.at)}
          <li><button class:chosen={chosen?.at === version.at} aria-pressed={chosen?.at === version.at} onclick={() => chosen = version}>
            <b>{shortTime(version.at)}</b>
            <small>{plainExcerpt(version.content, 40, { title: version.title }).replace(/\s*\n+\s*/g, ' ') || '（空白）'}</small>
            <small class="meta">{size(version.content)}{#if version.content === current}· 与当前相同{/if}</small>
          </button></li>
        {/each}
      </ul>
      <article aria-label="版本内容">
        {#if chosen}
          {#if chosen.title !== title}<p class="title-diff">标题：{chosen.title || '未命名便签'}</p>{/if}
          <pre>{chosen.content || '（空白）'}</pre>
        {/if}
      </article>
    </div>
  {/if}
  {#if error}<p class="error" role="alert">{error}</p>{/if}
  <footer>
    <span>恢复后，当前内容会作为一个版本保留，可以再换回来。</span>
    <button class="primary" disabled={busy || !chosen || chosen.content === current && chosen.title === title} onclick={restore}><RotateCcw size={13} />{busy ? '恢复中…' : '恢复此版本'}</button>
  </footer>
</div>

<style>
  .scrim { position: fixed; inset: 0; z-index: 150; background: var(--overlay); animation: fade var(--motion-fast) ease-out; }
  @keyframes fade { from { opacity: 0; } }
  .versions { position: fixed; z-index: 160; left: 50%; top: 50%; translate: -50% -50%; width: min(720px, calc(100vw - 40px)); height: min(520px, calc(100vh - 60px)); display: flex; flex-direction: column;
    background: var(--surface-raised); color: var(--text); border: 1px solid var(--border); border-radius: var(--radius-lg); box-shadow: var(--menu-shadow); font: 13px/1.5 var(--font); overflow: hidden; }
  header { display: flex; align-items: center; gap: 10px; padding: 14px 16px; border-bottom: 1px solid var(--hairline); }
  .badge { display: grid; place-items: center; width: 32px; height: 32px; border-radius: var(--radius); background: var(--accent-soft); color: var(--accent); }
  header div { display: flex; flex-direction: column; min-width: 0; }
  header strong { font-size: 14px; font-weight: 600; }
  header small { color: var(--muted); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  button { border: 0; border-radius: var(--radius-sm); background: transparent; font: inherit; color: var(--text); cursor: pointer; transition: background var(--motion-fast); }
  button:hover { background: var(--hover); }
  button:disabled { opacity: .45; cursor: default; }
  button:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
  .icon { margin-left: auto; padding: 4px; color: var(--muted); display: inline-flex; }
  .body { flex: 1; min-height: 0; display: grid; grid-template-columns: 220px minmax(0, 1fr); }
  ul { margin: 0; padding: 6px; list-style: none; overflow: auto; border-right: 1px solid var(--hairline); background: var(--surface-muted); }
  li button { display: flex; flex-direction: column; align-items: flex-start; gap: 1px; width: 100%; padding: 8px 10px; text-align: left; }
  li button.chosen { background: var(--accent-soft); }
  li b { font-weight: 500; font-size: 12.5px; }
  li small { color: var(--muted); font-size: 11.5px; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  li .meta { color: var(--subtle); font-size: 10.5px; }
  article { overflow: auto; padding: 14px 18px; }
  pre { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; font: 13px/1.65 var(--font); }
  .title-diff { margin: 0 0 10px; color: var(--muted); font-size: 12px; }
  .empty { flex: 1; margin: 0; padding: 40px 24px; text-align: center; color: var(--muted); line-height: 1.8; }
  .error { margin: 0; padding: 6px 16px; color: var(--danger); font-size: 12px; }
  footer { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 16px; border-top: 1px solid var(--hairline); }
  footer span { color: var(--muted); font-size: 11.5px; }
  .primary { display: inline-flex; align-items: center; gap: 6px; padding: 7px 12px; font-size: 12px; background: var(--accent); color: var(--on-accent); }
  .primary:hover { background: var(--accent-strong); }
  @media (max-width: 560px) { .body { grid-template-columns: 1fr; } ul { max-height: 160px; border-right: 0; border-bottom: 1px solid var(--hairline); } }
</style>
