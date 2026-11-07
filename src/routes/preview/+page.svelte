<script lang="ts">
  import { onMount } from 'svelte';
  import { emit, listen } from '@tauri-apps/api/event';
  import { getCurrentWindow } from '@tauri-apps/api/window';
  import { loadNotes, type PinNote } from '$lib/notesStore';
  import { checklistProgress } from '$lib/checklist';
  let note = $state<PinNote>();
  // Re-keyed on every show so the card animates in from the tab's side each time.
  let shown = $state(0);
  let from = $state<'left' | 'right' | 'none'>('none');
  let timer: ReturnType<typeof setTimeout>;
  const progress=$derived(checklistProgress(note?.content??''));
  onMount(() => {
    const id = new URLSearchParams(location.search).get('noteId')!;
    const refresh = async () => { note = (await loadNotes()).notes[id]; };
    void refresh();
    const stop = listen('notes-changed', refresh);
    const reveal = listen<{side:'left'|'right'|'none'}>('preview-shown', e => { from = e.payload.side; shown++; });
    const hover = listen<{id:string;inside:boolean}>('preview-hover', e => { if(e.payload.id === id) e.payload.inside ? enter() : leave(); });
    return () => { clearTimeout(timer); stop.then(f=>f()); hover.then(f=>f()); reveal.then(f=>f()); };
  });
  function enter() { clearTimeout(timer); }
  function leave() { clearTimeout(timer); timer = setTimeout(() => void getCurrentWindow().hide(), 350); }
  async function open() { if(note) await emit('expand-note-requested',{id:note.id}); await getCurrentWindow().hide(); }
</script>
<!-- svelte-ignore a11y_no_static_element_interactions -->
{#key shown}
<main class="from-{from}" onpointerenter={enter} onpointerleave={leave}>
  <strong>{note?.title || '未命名便签'}</strong>
  <p>{note?.content.slice(0,700) || '空白便签'}</p>
  {#if progress.total}<small>清单 {progress.done}/{progress.total}</small>{/if}
  {#if note?.reminder}<small>{new Date(note.reminder.at).toLocaleString()}</small>{/if}
  <button onclick={open}>打开编辑</button>
</main>
{/key}
<style>
 :global(html),:global(body){margin:0;height:100%;background:transparent;overflow:hidden}
 :global(body){font:13px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI','Microsoft YaHei',sans-serif;color:#171717;-webkit-font-smoothing:antialiased}
 main{box-sizing:border-box;position:absolute;inset:6px;padding:14px 16px 12px;display:flex;flex-direction:column;border:1px solid #0000001a;border-radius:12px;background:#fffffff7;animation:card-in 200ms cubic-bezier(.2,.85,.25,1)}
 main.from-right{--dx:8px}main.from-left{--dx:-8px}
 @keyframes card-in{from{opacity:0;transform:translateX(var(--dx,0)) scale(.98)}}
 strong{font-size:14px}
 p{white-space:pre-wrap;overflow:hidden;flex:1;color:#737373;margin:6px 0;mask-image:linear-gradient(#000 75%,transparent)}
 small{color:#737373;font-size:11px}
 button{align-self:flex-end;border:0;border-radius:6px;background:#eff6ff;color:#2563eb;padding:4px 10px;font:inherit;font-size:12px;cursor:pointer;transition:background 140ms,transform 140ms}button:hover{background:#dbeafe}button:active{transform:scale(.97)}
 @media(prefers-reduced-motion:reduce){main{animation:none}button{transition:none}}
</style>
