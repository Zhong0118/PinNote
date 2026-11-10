<script lang="ts">
  import { onMount } from 'svelte';
  import { emit, emitTo, listen } from '@tauri-apps/api/event';
  import { getCurrentWindow } from '@tauri-apps/api/window';
  import { PREVIEW_LABEL, type PreviewSummary } from '$lib/previewWindow';
  import { shortTime } from '$lib/excerpt';
  // A summary pushed by the hovered capsule; nothing is loaded or refreshed while hidden.
  let note = $state<PreviewSummary>();
  let leaving = $state(false);
  let timer: ReturnType<typeof setTimeout>;
  onMount(() => {
    const show = listen<PreviewSummary>('preview-show', e => { clearTimeout(timer); leaving = false; note = e.payload; });
    const hover = listen<{id:string;inside:boolean}>('preview-hover', e => {
      // Only the capsule currently shown may keep or dismiss the card.
      if (e.payload.id !== note?.id) return;
      if (e.payload.inside) enter(); else leave();
    });
    void show.then(() => emitTo(PREVIEW_LABEL, 'preview-ready'));
    return () => { clearTimeout(timer); show.then(f=>f()); hover.then(f=>f()); };
  });
  function enter() { clearTimeout(timer); leaving = false; }
  /** A short grace period to reach the card, then a brief fade before the window hides. */
  function leave() {
    clearTimeout(timer);
    timer = setTimeout(() => { leaving = true; timer = setTimeout(() => { void getCurrentWindow().hide(); leaving = false; }, 140); }, 300); // 140 = --motion-fast, the fade-out above
  }
  async function open() { clearTimeout(timer); if(note) await emit('expand-note-requested',{id:note.id}); await getCurrentWindow().hide(); }
</script>
<!-- svelte-ignore a11y_no_static_element_interactions -->
{#if note}{#key note.seq}
<main class="from-{note.side}" class:leaving onpointerenter={enter} onpointerleave={leave}>
  <strong>{note.title || '未命名便签'}</strong>
  <p>{note.excerpt || '暂无可显示的摘要'}</p>
  <footer>
    {#if note.total}<small>清单 {note.done}/{note.total}</small>{/if}
    {#if note.reminderAt}<small>{shortTime(note.reminderAt)}</small>{/if}
    <button onclick={open}>打开编辑</button>
  </footer>
</main>
{/key}{/if}
<style>
 :global(html),:global(body){margin:0;height:100%;background:transparent;overflow:hidden}
 :global(body){font:13px/1.6 var(--font);color:var(--text,#171717);-webkit-font-smoothing:antialiased}
 main{box-sizing:border-box;position:absolute;inset:6px;padding:14px 16px 12px;display:flex;flex-direction:column;border:1px solid var(--border,#0000001a);border-radius:var(--radius-lg);background:var(--surface-raised,#fffffff7);animation:card-in var(--motion) cubic-bezier(.2,.85,.25,1)}
 main.from-right{--dx:8px}main.from-left{--dx:-8px}
 main{transition:opacity var(--motion-fast) ease-in,transform var(--motion-fast) ease-in}main.leaving{opacity:0;transform:translateX(var(--dx,0)) scale(.985)}
 @keyframes card-in{from{opacity:0;transform:translateX(var(--dx,0)) scale(.98)}}
 strong{font-size:14px}
 p{white-space:pre-wrap;overflow:hidden;flex:1;color:var(--muted,#737373);margin:6px 0;mask-image:linear-gradient(#000 75%,transparent)}
 footer{display:flex;align-items:center;gap:10px}
 small{color:var(--muted,#737373);font-size:11px}
 button{margin-left:auto;border:0;border-radius:var(--radius-sm);background:var(--accent-soft,#eff6ff);color:var(--accent,#2563eb);padding:4px 10px;font:inherit;font-size:12px;cursor:pointer;transition:background var(--motion-fast),transform var(--motion-fast)}button:hover{filter:brightness(.97)}button:active{transform:scale(.97)}
 @media(prefers-reduced-motion:reduce){main{animation:none}button{transition:none}}
</style>
