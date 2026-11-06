<script lang="ts">
  import { onMount } from 'svelte';
  import { emit, listen } from '@tauri-apps/api/event';
  import { getCurrentWindow } from '@tauri-apps/api/window';
  import { loadNotes, type PinNote } from '$lib/notesStore';
  import { checklistProgress } from '$lib/checklist';
  let note = $state<PinNote>();
  let timer: ReturnType<typeof setTimeout>;
  const progress=$derived(checklistProgress(note?.content??''));
  onMount(() => {
    const id = new URLSearchParams(location.search).get('noteId')!;
    const refresh = async () => { note = (await loadNotes()).notes[id]; };
    void refresh();
    const stop = listen('notes-changed', refresh);
    const hover = listen<{id:string;inside:boolean}>('preview-hover', e => { if(e.payload.id === id) e.payload.inside ? enter() : leave(); });
    return () => { clearTimeout(timer); stop.then(f=>f()); hover.then(f=>f()); };
  });
  function enter() { clearTimeout(timer); }
  function leave() { clearTimeout(timer); timer = setTimeout(() => void getCurrentWindow().hide(), 350); }
  async function open() { if(note) await emit('expand-note-requested',{id:note.id}); await getCurrentWindow().hide(); }
</script>
<!-- svelte-ignore a11y_no_static_element_interactions -->
<main onpointerenter={enter} onpointerleave={leave}>
  <strong>{note?.title || '未命名便签'}</strong>
  <p>{note?.content.slice(0,700) || '空白便签'}</p>
  {#if progress.total}<small>清单 {progress.done}/{progress.total}</small>{/if}
  {#if note?.reminder}<small>{new Date(note.reminder.at).toLocaleString()}</small>{/if}
  <button onclick={open}>打开编辑</button>
</main>
<style>
 :global(body){margin:0;font:13px/1.6 -apple-system,BlinkMacSystemFont,sans-serif;color:#171717;background:white} main{padding:16px;height:208px;display:flex;flex-direction:column}p{white-space:pre-wrap;overflow:hidden;flex:1;color:#737373;margin:8px 0}button{align-self:flex-end;border:0;border-radius:6px;background:#eff6ff;color:#2563eb;padding:5px 10px;cursor:pointer;transition:transform 140ms}button:active{transform:scale(.97)}@media(prefers-reduced-motion:reduce){button{transition:none}}
</style>
