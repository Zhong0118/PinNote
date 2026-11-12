<script lang="ts">
  // The center's overview: how much is kept, how actively, and what is still open. Counted
  // locally from the notes and the activity log (see journal.rs); nothing leaves the device.
  import { onMount } from 'svelte';
  import { invoke } from '@tauri-apps/api/core';
  import { ArrowLeft, StickyNote, PenLine, CircleCheck, Flame, Hash } from 'lucide-svelte';
  import type { PinNote } from '$lib/notesStore';
  import { dailyActivity, streaks, heatmap, recent, tagCounts, dayKey, notesOnDay, heatTotals, type Activity, type HeatCell } from '$lib/library';
  import { plainExcerpt } from '$lib/excerpt';
  let { notes, openTodos, onClose, onTag, onOpen }:
    { notes: PinNote[]; openTodos: (n: PinNote) => number; onClose: () => void; onTag: (tag: string) => void; onOpen: (id: string) => void } = $props();
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
  const WEEKS = 26, GAP = 3, LABELS = 24;
  const grid = $derived(heatmap(days, now, WEEKS));
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
  const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const dateLabel = (at: number) => { const d = new Date(at); return `${d.getMonth() + 1}月${d.getDate()}日 ${WEEKDAYS[d.getDay()]}`; };
  const dayParts = (day: HeatCell['day']) => [day.edits && `编辑 ${day.edits} 次`, day.created && `新建 ${day.created} 张`, day.done && `完成 ${day.done} 项`].filter(Boolean).join(' · ') || '没有记录';
  const cellLabel = (cell: HeatCell) => `${dateLabel(cell.at)}：${cell.future ? '还没到' : dayParts(cell.day)}`;

  // Hovering shows a tooltip; clicking (or arrow keys) selects the day shown in detail below.
  const cells = $derived(grid.flat());
  const totals = $derived(heatTotals(grid));
  let selectedKey = $state(dayKey(Date.now()));
  const selected = $derived(cells.find(c => c.key === selectedKey) ?? cells.findLast(c => !c.future));
  const touched = $derived(selected ? notesOnDay(notes, selected.key) : []);
  const estimated = $derived(Boolean(selected && (activity.since === undefined || selected.at < new Date(activity.since).setHours(0, 0, 0, 0))));
  let panel = $state<HTMLElement>();
  // Cells grow with the panel (10–20px) so the half year fills the width instead of a corner.
  let areaWidth = $state(0);
  const cellSize = $derived(Math.max(10, Math.min(20, Math.floor((areaWidth - LABELS - (WEEKS - 1) * GAP) / WEEKS))));
  let tip = $state<{ cell: HeatCell; x: number; y: number }>();
  function showTip(cell: HeatCell, el: HTMLElement) {
    if (!panel) return;
    const box = panel.getBoundingClientRect(), r = el.getBoundingClientRect();
    tip = { cell, x: r.left + r.width / 2 - box.left, y: r.top - box.top };
  }
  function choose(cell: HeatCell | undefined, focus = false) {
    if (!cell || cell.future) return;
    selectedKey = cell.key;
    if (focus) queueMicrotask(() => panel?.querySelector<HTMLElement>(`[data-key="${cell.key}"]`)?.focus());
  }
  function gridKey(event: KeyboardEvent) {
    const step = ({ ArrowUp: -1, ArrowDown: 1, ArrowLeft: -7, ArrowRight: 7 } as Record<string, number>)[event.key];
    if (!step || !selected) return;
    event.preventDefault();
    const next = cells[cells.indexOf(selected) + step];
    choose(next, true);
    if (next && !next.future) tip = undefined;
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
      <div class="panel-head"><div><h3>最近半年</h3><small class="sum">{totals.days} 天有记录 · 编辑 {totals.edits} 次 · 新建 {totals.created} 张 · 完成 {totals.done} 项</small></div>
        <span class="legend" aria-hidden="true">少<i class="l0"></i><i class="l1"></i><i class="l2"></i><i class="l3"></i><i class="l4"></i>多</span></div>
      <div class="heat-area" bind:this={panel} bind:clientWidth={areaWidth}>
        <div class="heat" style:--cell="{cellSize}px">
          <div class="months" aria-hidden="true">{#each months as label}<span>{label}</span>{/each}</div>
          <div class="weekdays" aria-hidden="true"><span>一</span><span></span><span>三</span><span></span><span>五</span><span></span><span>日</span></div>
          <div class="grid" role="grid" aria-label="最近 26 周每天的记录，方向键切换日期" tabindex="-1" onkeydown={gridKey} onmouseleave={() => tip = undefined}>
            {#each grid as week}<div class="week" role="row">{#each week as cell (cell.key)}<button role="gridcell" class="cell l{cell.level}" class:future={cell.future} class:today={cell.key === dayKey(now)} class:chosen={cell.key === selected?.key}
              data-key={cell.key} disabled={cell.future} tabindex={cell.key === selected?.key ? 0 : -1} aria-label={cellLabel(cell)} aria-selected={cell.key === selected?.key}
              onmouseenter={e => showTip(cell, e.currentTarget)} onfocus={e => showTip(cell, e.currentTarget)} onblur={() => tip = undefined} onclick={() => choose(cell)}></button>{/each}</div>{/each}
          </div>
        </div>
        {#if tip}<div class="tip" style:left="{tip.x}px" style:top="{tip.y}px" role="tooltip"><b>{dateLabel(tip.cell.at)}</b><span>{tip.cell.future ? '还没到' : dayParts(tip.cell.day)}</span></div>{/if}
      </div>
      {#if selected}
        <div class="day" aria-live="polite">
          <div class="day-head"><b>{dateLabel(selected.at)}{selected.key === dayKey(now) ? ' · 今天' : ''}</b>
            <span class="pills"><span><em>{selected.day.edits}</em>编辑</span><span><em>{selected.day.created}</em>新建</span><span><em>{selected.day.done}</em>完成待办</span></span></div>
          {#if touched.length}
            <ul class="touched">
              {#each touched.slice(0, 6) as hit (hit.note.id)}
                <li><button onclick={() => onOpen(hit.note.id)}><span class="kind" class:new={hit.created}>{hit.created ? '新建' : '编辑'}</span>
                  <b>{hit.note.title || '未命名便签'}</b><small>{plainExcerpt(hit.note.content, 60, { title: hit.note.title }).replace(/\s*\n+\s*/g, ' ')}</small>
                  {#if hit.note.lifecycle === 'archived'}<span class="archived">已归档</span>{/if}</button></li>
              {/each}
            </ul>
            {#if touched.length > 6}<small class="more">还有 {touched.length - 6} 张</small>{/if}
          {:else}<p class="quiet">{selected.day.edits + selected.day.created + selected.day.done ? '这一天的便签后来又编辑过，显示在更晚的日期里。' : '这一天没有记录。'}</p>{/if}
          {#if estimated}<small class="more">这一天在开始逐日记录之前，数字按便签的创建和最后编辑时间估算。</small>{/if}
        </div>
      {/if}
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
  .sum { display: block; margin-top: 2px; color: var(--muted); font-size: 11px; font-variant-numeric: tabular-nums; }
  .heat-area { position: relative; user-select: none; -webkit-user-select: none; }
  .heat { --cell: 12px; display: grid; grid-template-columns: auto 1fr; grid-template-areas: ". months" "days grid"; gap: 4px 6px; overflow-x: auto; }
  .months span { overflow: visible; }
  .months { grid-area: months; display: grid; grid-auto-flow: column; grid-auto-columns: var(--cell); gap: 3px; font-size: 10px; color: var(--muted); white-space: nowrap; height: 14px; }
  .weekdays { grid-area: days; display: grid; grid-template-rows: repeat(7, var(--cell)); gap: 3px; min-width: 12px; font-size: 9.5px; line-height: var(--cell); color: var(--muted); }
  .grid { grid-area: grid; display: grid; grid-auto-flow: column; grid-auto-columns: var(--cell); gap: 3px; }
  .week { display: grid; grid-template-rows: repeat(7, var(--cell)); gap: 3px; }
  i, .cell { display: block; width: var(--cell, 11px); height: var(--cell, 11px); border-radius: 3px; }
  .legend i { --cell: 11px; }
  .cell { padding: 0; border: 0; cursor: pointer; transition: transform var(--motion-fast) var(--ease-out), box-shadow var(--motion-fast); }
  .cell:not(:disabled):hover { transform: scale(1.25); box-shadow: 0 0 0 1.5px var(--surface-muted), 0 0 0 2.5px var(--accent); position: relative; z-index: 1; }
  .cell:disabled { cursor: default; }
  .cell.chosen { box-shadow: 0 0 0 1.5px var(--surface-muted), 0 0 0 3px var(--text-strong); }
  .cell:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .grid:focus { outline: none; }
  .tip { position: absolute; z-index: 5; translate: -50% calc(-100% - 8px); display: flex; flex-direction: column; gap: 1px; padding: 6px 9px; border-radius: var(--radius-sm); background: var(--text-strong); color: var(--surface); font-size: 11px; line-height: 1.4; white-space: nowrap; pointer-events: none; box-shadow: var(--menu-shadow); }
  .tip b { font-weight: 600; }
  .tip::after { content: ''; position: absolute; left: 50%; bottom: -4px; width: 8px; height: 8px; translate: -50% 0; rotate: 45deg; background: inherit; border-radius: 1px; }
  .day { margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--hairline); }
  .day-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
  .day-head b { font-size: 13px; font-weight: 600; color: var(--text-strong); }
  .pills { display: inline-flex; gap: 6px; }
  .pills span { display: inline-flex; align-items: baseline; gap: 4px; padding: 2px 9px; border-radius: 999px; background: var(--surface-sunken); color: var(--muted); font-size: 11px; }
  .pills em { font-style: normal; font-size: 13px; font-weight: 600; color: var(--text-strong); font-variant-numeric: tabular-nums; }
  .touched { margin: 10px 0 0; padding: 0; list-style: none; display: grid; gap: 2px; }
  .touched button { display: flex; align-items: center; gap: 8px; width: 100%; min-width: 0; padding: 6px 8px; border: 0; border-radius: var(--radius-sm); background: transparent; color: var(--text); font: inherit; font-size: 12.5px; text-align: left; cursor: pointer; }
  .touched button:hover { background: var(--hover); }
  .touched b { flex: 0 1 auto; max-width: 40%; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .touched small { flex: 1; min-width: 0; color: var(--muted); font-size: 11.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .kind { flex: 0 0 auto; padding: 0 6px; border-radius: 999px; background: var(--surface-sunken); color: var(--muted); font-size: 10.5px; line-height: 17px; }
  .kind.new { background: var(--accent-soft); color: var(--accent); }
  .archived { flex: 0 0 auto; color: var(--subtle); font-size: 10.5px; }
  .quiet { margin: 10px 0 0; color: var(--muted); font-size: 12px; }
  .more { display: block; margin-top: 6px; color: var(--muted); font-size: 11px; }
  .l0 { background: var(--surface-sunken); box-shadow: inset 0 0 0 .5px var(--hairline); }
  .l1 { background: color-mix(in srgb, var(--accent) 28%, var(--surface-muted)); }
  .l2 { background: color-mix(in srgb, var(--accent) 50%, var(--surface-muted)); }
  .l3 { background: color-mix(in srgb, var(--accent) 74%, var(--surface-muted)); }
  .l4 { background: var(--accent); }
  .future { opacity: .35; }
  .today:not(.chosen) { box-shadow: inset 0 0 0 1.5px var(--text-strong); }
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
