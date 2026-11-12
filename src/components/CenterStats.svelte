<script lang="ts">
  // The center's overview: how much is kept, how actively, and what is still open. Counted
  // locally from the notes and the activity log (see journal.rs); nothing leaves the device.
  import { onMount } from 'svelte';
  import { invoke } from '@tauri-apps/api/core';
  import { ArrowLeft, StickyNote, PenLine, CircleCheck, Flame, Hash } from 'lucide-svelte';
  import type { PinNote } from '$lib/notesStore';
  import { dailyActivity, streaks, heatmap, recent, tagCounts, dayKey, type Activity } from '$lib/library';
  let { notes, openTodos, onClose, onTag }:
    { notes: PinNote[]; openTodos: (n: PinNote) => number; onClose: () => void; onTag: (tag: string) => void } = $props();
  let activity = $state<Activity>({});
  let now = $state(Date.now());
  onMount(() => {
    void invoke<Activity>('load_activity').then(a => activity = a).catch(() => undefined);
    const timer = setInterval(() => now = Date.now(), 60000);
    return () => clearInterval(timer);
  });
  const live = $derived(notes.filter(n => n.lifecycle !== 'trash'));
  const activeNotes = $derived(notes.filter(n => n.lifecycle === 'active'));
  const days = $derived(dailyActivity(activity, live));
  const run = $derived(streaks(days, now));
  const grid = $derived(heatmap(days, now, 26));
  const today = $derived(days.get(dayKey(now)));
  const open = $derived(activeNotes.reduce((sum, n) => sum + openTodos(n), 0));
  const monthDone = $derived(recent(days, now, new Date(now).getDate(), 'done'));
  const tags = $derived(tagCounts(notes).slice(0, 6));
  const total = (d?: { edits: number; created: number; done: number }) => d ? d.edits + d.created + d.done : 0;
  // A label at each month's first week; the leading partial month is dropped when the next label is too close.
  const months = $derived.by(() => {
    const labels = grid.map((week, i) => {
      const m = new Date(week[0].at).getMonth();
      return i === 0 || new Date(grid[i - 1][0].at).getMonth() !== m ? `${m + 1}月` : '';
    });
    if (labels.slice(1, 3).some(Boolean)) labels[0] = '';
    return labels;
  });
  const since = $derived(activity.since ? new Date(activity.since) : null);
  function cellTitle(cell: (typeof grid)[number][number]) {
    const d = new Date(cell.at), date = `${d.getMonth() + 1}月${d.getDate()}日`;
    if (cell.future) return date;
    const parts = [cell.day.edits && `编辑 ${cell.day.edits} 次`, cell.day.created && `新建 ${cell.day.created} 张`, cell.day.done && `完成 ${cell.day.done} 项`].filter(Boolean);
    return `${date} · ${parts.join(' · ') || '没有记录'}`;
  }
  function keydown(event: KeyboardEvent) { if (event.key === 'Escape' && !event.isComposing) { event.preventDefault(); onClose(); } }
</script>

<svelte:window onkeydown={keydown} />
<section class="stats" aria-label="记录概览">
  <div class="content">
    <button class="back" onclick={onClose}><ArrowLeft size={15} />返回便签</button>
    <h2>记录概览</h2>
    <p class="lead">{run.current ? `已连续记录 ${run.current} 天，继续保持。` : today ? '今天已经开始记录了。' : '今天还没有记录，写下第一件事吧。'}</p>

    <div class="cards">
      <div class="card"><span class="icon"><StickyNote size={15} /></span><b>{activeNotes.length}</b><span>张便签</span>
        <small>桌面 {activeNotes.filter(n => n.placement === 'desktop').length} · 收藏 {activeNotes.filter(n => n.starredAt).length} · 归档 {notes.filter(n => n.lifecycle === 'archived').length}</small></div>
      <div class="card"><span class="icon"><PenLine size={15} /></span><b>{recent(days, now, 7, 'edits') + recent(days, now, 7, 'created')}</b><span>近 7 天编辑</span>
        <small>今天 {total(today)} 次</small></div>
      <div class="card"><span class="icon"><CircleCheck size={15} /></span><b>{monthDone}</b><span>本月完成待办</span>
        <small>{open ? `还有 ${open} 项未完成` : '没有未完成的待办'}</small></div>
      <div class="card"><span class="icon"><Flame size={15} /></span><b>{run.current}</b><span>天连续记录</span>
        <small>最长 {run.longest} 天</small></div>
    </div>

    <div class="panel">
      <div class="panel-head"><h3>最近半年</h3>
        <span class="legend">少<i class="l0"></i><i class="l1"></i><i class="l2"></i><i class="l3"></i><i class="l4"></i>多</span></div>
      <div class="heat" role="img" aria-label="最近 26 周每天的记录热力图">
        <div class="months">{#each months as label}<span>{label}</span>{/each}</div>
        <div class="weekdays"><span>一</span><span></span><span>三</span><span></span><span>五</span><span></span><span>日</span></div>
        <div class="grid">
          {#each grid as week}<div class="week">{#each week as cell (cell.key)}<i class="l{cell.level}" class:future={cell.future} class:today={cell.key === dayKey(now)} title={cellTitle(cell)}></i>{/each}</div>{/each}
        </div>
      </div>
      <p class="note">{since ? `从 ${since.getMonth() + 1}月${since.getDate()}日起逐日记录编辑、新建和勾选待办；更早的日子按便签的创建和最后编辑时间估算。` : '从现在起逐日记录编辑、新建和勾选待办；更早的日子按便签的创建和最后编辑时间估算。'}统计只在本机进行。</p>
    </div>

    {#if tags.length}
      <div class="panel">
        <div class="panel-head"><h3>常用标签</h3></div>
        <ul class="tags">
          {#each tags as item}
            <li><button onclick={() => onTag(item.tag)} title="在列表中只看「{item.tag}」"><Hash size={12} />{item.tag}</button>
              <span class="bar"><i style:width="{Math.max(8, item.count / tags[0].count * 100)}%"></i></span><small>{item.count}</small></li>
          {/each}
        </ul>
      </div>
    {/if}
  </div>
</section>

<style>
  .stats { position: absolute; inset: 0; z-index: 40; overflow: auto; background: var(--surface); color: var(--text); animation: stats-in var(--motion) var(--ease-out); }
  @keyframes stats-in { from { opacity: 0; transform: translateY(4px); } }
  .content { max-width: 760px; margin: 0 auto; padding: 44px 32px 32px; }
  .back { display: inline-flex; align-items: center; gap: 6px; margin: 0 0 14px -8px; padding: 5px 8px; border: 0; border-radius: var(--radius-sm); background: transparent; color: var(--muted); font: inherit; font-size: 12.5px; cursor: pointer; }
  .back:hover { background: var(--hover); color: var(--text); }
  h2 { margin: 0; font-size: 20px; font-weight: 600; color: var(--text-strong); }
  .lead { margin: 4px 0 20px; color: var(--muted); }
  .cards { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
  .card { display: grid; grid-template-columns: auto 1fr; grid-template-areas: "icon icon" "num num" "label label" "sub sub"; padding: 14px; border-radius: var(--radius-lg); background: var(--surface-muted); box-shadow: inset 0 0 0 .5px var(--hairline); }
  .card .icon { grid-area: icon; display: grid; place-items: center; width: 26px; height: 26px; margin-bottom: 8px; border-radius: var(--radius-sm); background: var(--accent-soft); color: var(--accent); }
  .card b { grid-area: num; font-size: 24px; font-weight: 600; line-height: 1.2; color: var(--text-strong); font-variant-numeric: tabular-nums; }
  .card > span:not(.icon) { grid-area: label; font-size: 12px; color: var(--text); }
  .card small { grid-area: sub; margin-top: 4px; font-size: 11px; color: var(--muted); }
  .panel { margin-top: 14px; padding: 16px; border-radius: var(--radius-lg); background: var(--surface-muted); box-shadow: inset 0 0 0 .5px var(--hairline); }
  .panel-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
  h3 { margin: 0; font-size: 13px; font-weight: 600; color: var(--text-strong); }
  .legend { display: inline-flex; align-items: center; gap: 3px; color: var(--muted); font-size: 11px; }
  .legend i { margin: 0 1px; }
  .heat { --cell: 12px; display: grid; grid-template-columns: auto 1fr; grid-template-areas: ". months" "days grid"; gap: 4px 6px; overflow-x: auto; }
  .months span { overflow: visible; }
  .months { grid-area: months; display: grid; grid-auto-flow: column; grid-auto-columns: var(--cell); gap: 3px; font-size: 10px; color: var(--muted); white-space: nowrap; height: 14px; }
  .weekdays { grid-area: days; display: grid; grid-template-rows: repeat(7, var(--cell)); gap: 3px; font-size: 9.5px; line-height: var(--cell); color: var(--muted); }
  .grid { grid-area: grid; display: grid; grid-auto-flow: column; grid-auto-columns: var(--cell); gap: 3px; }
  .week { display: grid; grid-template-rows: repeat(7, var(--cell)); gap: 3px; }
  i { display: block; width: var(--cell, 11px); height: var(--cell, 11px); border-radius: 3px; }
  .legend i { --cell: 11px; }
  .l0 { background: var(--surface-sunken); box-shadow: inset 0 0 0 .5px var(--hairline); }
  .l1 { background: color-mix(in srgb, var(--accent) 28%, var(--surface-muted)); }
  .l2 { background: color-mix(in srgb, var(--accent) 50%, var(--surface-muted)); }
  .l3 { background: color-mix(in srgb, var(--accent) 74%, var(--surface-muted)); }
  .l4 { background: var(--accent); }
  .future { opacity: .35; }
  .today { outline: 1.5px solid var(--text); outline-offset: 1px; }
  .note { margin: 12px 0 0; color: var(--muted); font-size: 11px; line-height: 1.6; }
  .tags { margin: 0; padding: 0; list-style: none; display: grid; gap: 6px; }
  .tags li { display: grid; grid-template-columns: 140px 1fr 32px; align-items: center; gap: 10px; }
  .tags button { display: inline-flex; align-items: center; gap: 5px; min-width: 0; padding: 3px 6px; border: 0; border-radius: var(--radius-sm); background: transparent; color: var(--text); font: inherit; font-size: 12px; cursor: pointer; justify-self: start; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .tags button:hover { background: var(--accent-soft); color: var(--accent); }
  .bar { height: 6px; border-radius: 3px; background: var(--surface-sunken); overflow: hidden; }
  .bar i { height: 100%; width: 0; border-radius: 3px; background: color-mix(in srgb, var(--accent) 70%, var(--surface-muted)); }
  .tags small { color: var(--muted); font-size: 11px; text-align: right; font-variant-numeric: tabular-nums; }
  @media (max-width: 720px) { .cards { grid-template-columns: repeat(2, minmax(0, 1fr)); } .content { padding: 44px 18px 24px; } }
</style>
