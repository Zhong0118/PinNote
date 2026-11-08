<script lang="ts">
  import { onMount } from 'svelte';
  import { emit, emitTo, listen } from '@tauri-apps/api/event';
  import { getCurrentWindow } from '@tauri-apps/api/window';
  import { PREVIEW_LABEL, type PreviewSummary } from '$lib/previewWindow';
  // A summary pushed by the hovered capsule; nothing is loaded or refreshed while hidden.
  let note = $state<PreviewSummary>();
  let timer: ReturnType<typeof setTimeout>;
  onMount(() => {
    const show = listen<PreviewSummary>('preview-show', e => { clearTimeout(timer); note = e.payload; });
    const hover = listen<{id:string;inside:boolean}>('preview-hover', e => {
      // Only the capsule currently shown may keep or dismiss the card.
      if (e.payload.id !== note?.id) return;
      if (e.payload.inside) enter(); else leave();
    });
    void show.then(() => emitTo(PREVIEW_LABEL, 'preview-ready'));
    return () => { clearTimeout(timer); show.then(f=>f()); hover.then(f=>f()); };
  });
  function enter() { clearTimeout(timer); }
  function leave() { clearTimeout(timer); timer = setTimeout(() => void getCurrentWindow().hide(), 350); }
  async function open() { clearTimeout(timer); if(note) await emit('expand-note-requested',{id:note.id}); await getCurrentWindow().hide(); }
</script>
<!-- svelte-ignore a11y_no_static_element_interactions -->
{#if note}{#key note.seq}
<main class="from-{note.side}" onpointerenter={enter} onpointerleave={leave}>
  <strong>{note.title || '未命名便签'}</strong>
  <p>{note.excerpt || '空白便签'}</p>
  {#if note.total}<small>清单 {note.done}/{note.total}</small>{/if}
  {#if note.reminderAt}<small>{new Date(note.reminderAt).toLocaleString()}</small>{/if}
  <button onclick={open}>打开编辑</button>
</main>
{/key}{/if}
<style>
 :global(html),:global(body){margin:0;height:100%;background:transparent;overflow:hidden}
 :global(body){font:13px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI','Microsoft YaHei',sans-serif;color:var(--text,#171717);-webkit-font-smoothing:antialiased}
 main{box-sizing:border-box;position:absolute;inset:6px;padding:14px 16px 12px;display:flex;flex-direction:column;border:1px solid var(--border,#0000001a);border-radius:12px;background:var(--surface-raised,#fffffff7);animation:card-in 200ms cubic-bezier(.2,.85,.25,1)}
 main.from-right{--dx:8px}main.from-left{--dx:-8px}
 @keyframes card-in{from{opacity:0;transform:translateX(var(--dx,0)) scale(.98)}}
 strong{font-size:14px}
 p{white-space:pre-wrap;overflow:hidden;flex:1;color:var(--muted,#737373);margin:6px 0;mask-image:linear-gradient(#000 75%,transparent)}
 small{color:var(--muted,#737373);font-size:11px}
 button{align-self:flex-end;border:0;border-radius:6px;background:var(--accent-soft,#eff6ff);color:var(--accent,#2563eb);padding:4px 10px;font:inherit;font-size:12px;cursor:pointer;transition:background 140ms,transform 140ms}button:hover{filter:brightness(.97)}button:active{transform:scale(.97)}
 @media(prefers-reduced-motion:reduce){main{animation:none}button{transition:none}}
</style>
