<script lang="ts">
  // Global settings, shown only inside the note center. The notes view stays mounted
  // underneath, so returning keeps tabs, selection, scroll, drafts and undo history.
  import { onMount } from 'svelte';
  import { emit } from '@tauri-apps/api/event';
  import { invoke } from '@tauri-apps/api/core';
  import { getVersion } from '@tauri-apps/api/app';
  import { disable, enable, isEnabled } from '@tauri-apps/plugin-autostart';
  import { openPath, revealItemInDir } from '@tauri-apps/plugin-opener';
  import { ArrowLeft, Palette, AppWindow, Keyboard, Plug, Database, Check, RotateCcw, FolderOpen, Copy, RefreshCw, Download } from 'lucide-svelte';
  import IntegrationSettings from './IntegrationSettings.svelte';
  import { noteColors } from '$lib/noteAppearance';
  import { applyAppearance } from '$lib/theme';
  import { loadSettings, saveSettings, isMacPlatform, isNativeApp, normalizeShortcut, platformDefaultShortcuts, shortcutIdentity, shortcutKeyFromEvent,
    type AppSettings, type AppearanceSettings, type ShadowLevel, type ThemeMode } from '$lib/settings';

  type Category = 'appearance' | 'window' | 'shortcuts' | 'integration' | 'data';
  let { onClose, shortcutStatus = '', onExportCurrent, initial = 'appearance' }:
    { onClose: () => void; shortcutStatus?: string; onExportCurrent?: () => void; initial?: Category } = $props();

  const categories: Array<{ id: Category; label: string; icon: typeof Palette }> = [
    { id: 'appearance', label: '外观', icon: Palette },
    { id: 'window', label: '窗口与便签', icon: AppWindow },
    { id: 'shortcuts', label: '快捷键', icon: Keyboard },
    { id: 'integration', label: '集成', icon: Plug },
    { id: 'data', label: '数据与更新', icon: Database },
  ];
  // svelte-ignore state_referenced_locally
  let category = $state<Category>(initial);
  let settings = $state<AppSettings>();
  let saving = $state(false);
  let saveError = $state('');
  let saveNote = $state('');
  let pending: AppSettings | undefined;
  let recordingFor = $state<keyof AppSettings['shortcuts'] | null>(null);
  let shortcutError = $state('');
  let autoStartStatus = $state('');
  let dataPath = $state('');
  let dataStatus = $state('');
  let updateStatus = $state('');
  let version = $state('');
  let opacityPreview = $state<number>();
  const mod = isMacPlatform() ? '⌘' : 'Ctrl+';
  const inApp = [
    ['导出 Markdown', `${mod}S`], ['切换置顶', `${mod}T`], ['切换源码模式', `${mod}/`], ['打开设置', `${mod},`],
    ['加粗', `${mod}B`], ['斜体', `${mod}I`], ['切换待办', `${mod}⇧Enter`],
  ];

  onMount(() => {
    void loadSettings().then(s => { settings = s; void syncAutoStart(); });
    void invoke<string>('app_data_path').then(p => dataPath = p).catch(() => undefined);
    void getVersion().then(v => version = v).catch(() => version = '');
  });

  /** Persist natively; "saved" is broadcast only after the write succeeded. */
  async function commit(next: AppSettings) {
    settings = next; pending = next; saving = true; saveError = '';
    try {
      const result = await saveSettings($state.snapshot(next) as AppSettings);
      if (pending !== next) return;
      if (result === 'saved') { await emit('settings-changed', $state.snapshot(next)); saveNote = '已保存'; }
      else saveNote = '浏览器预览：仅保存在本页，不代表应用已保存';
      pending = undefined;
    } catch (error) {
      if (pending === next) saveError = `设置未保存：${error}`;
    } finally { if (pending === next || !pending) saving = false; }
  }
  const retry = () => { if (pending) void commit(pending); };
  function patch<K extends keyof AppSettings>(key: K, value: AppSettings[K]) { if (settings) void commit({ ...settings, [key]: value }); }
  function patchAppearance(next: Partial<AppearanceSettings>) {
    if (!settings) return;
    const appearance = { ...settings.appearance, ...next };
    applyAppearance(appearance);   // this window at once
    if (isNativeApp()) void emit('appearance-preview', appearance); // every other window, before the write lands
    patch('appearance', appearance);
  }

  async function syncAutoStart() {
    try { const on = await isEnabled(); if (settings && on !== settings.autoStart) settings = { ...settings, autoStart: on }; } catch { /* preview */ }
  }
  async function setAutoStart(value: boolean) {
    if (!settings) return;
    try {
      if (value) await enable(); else await disable();
      const on = await isEnabled();
      autoStartStatus = on === value ? '' : '系统启动项状态与设置不一致';
      patch('autoStart', on);
    } catch {
      autoStartStatus = '开机自启设置失败，请使用安装版运行后重试';
      await syncAutoStart();
    }
  }

  function setShortcut(key: keyof AppSettings['shortcuts'], value: string) {
    if (!settings) return;
    const normalized = normalizeShortcut(value), identity = shortcutIdentity(normalized);
    if (Object.entries(settings.shortcuts).some(([name, s]) => name !== key && shortcutIdentity(s) === identity)) {
      shortcutError = '这个快捷键已被另一项使用'; return;
    }
    shortcutError = '';
    patch('shortcuts', { ...settings.shortcuts, [key]: normalized });
  }
  function recordKey(event: KeyboardEvent) {
    if (!recordingFor || event.isComposing) return;
    event.preventDefault(); event.stopPropagation();
    if (event.key === 'Escape') { recordingFor = null; return; }
    if (['Control', 'Alt', 'Shift', 'Meta'].includes(event.key)) return;
    const parts: string[] = [];
    if (event.ctrlKey) parts.push('Ctrl');
    if (event.altKey) parts.push(isMacPlatform() ? 'Option' : 'Alt');
    if (event.shiftKey) parts.push('Shift');
    if (event.metaKey) parts.push('Cmd');
    if (!parts.length) { shortcutError = isMacPlatform() ? '请至少包含 Ctrl、Option、Shift 或 Cmd' : '请至少包含 Ctrl、Alt 或 Shift'; return; }
    const key = shortcutKeyFromEvent(event); if (!key) return;
    setShortcut(recordingFor, [...parts, key].join('+'));
    recordingFor = null;
  }
  const label = (s: string) => normalizeShortcut(s).replace('CmdOrCtrl', isMacPlatform() ? 'Cmd' : 'Ctrl').replaceAll('+', ' + ');

  async function openData() {
    try { await revealItemInDir(await invoke<string>('app_data_file_path', { name: 'notes.json' })); dataStatus = '已在访达中定位 notes.json'; }
    catch { try { await openPath(dataPath); dataStatus = '已打开数据目录'; } catch { dataStatus = '无法打开数据目录，可复制路径'; } }
  }
  async function copyData() {
    try { await navigator.clipboard.writeText(dataPath); dataStatus = '已复制数据目录路径'; } catch { dataStatus = '无法复制，请手动选择路径'; }
  }
  function keydown(event: KeyboardEvent) {
    if (recordingFor) { recordKey(event); return; }
    if (event.key === 'Escape' && !event.isComposing) { event.preventDefault(); onClose(); }
  }
  const themes: Array<[ThemeMode, string]> = [['system', '跟随系统'], ['light', '浅色'], ['dark', '深色']];
  const shadows: Array<[ShadowLevel, string]> = [['off', '关'], ['light', '细边'], ['standard', '标准']];
</script>

<svelte:window onkeydown={keydown} />

<section class="settings" aria-label="设置">
  <nav aria-label="设置分类">
    <button class="back" onclick={onClose}><ArrowLeft size={15} />返回便签</button>
    {#each categories as item}
      <button class="category" class:current={category === item.id} aria-current={category === item.id ? 'page' : undefined} onclick={() => category = item.id}>
        <item.icon size={15} />{item.label}
      </button>
    {/each}
  </nav>
  <div class="content">
    {#if saveError}
      <div class="save-error" role="alert">{saveError}<button onclick={retry} disabled={saving}><RefreshCw size={13} />重试</button></div>
    {:else if saveNote}
      <div class="save-note" role="status"><Check size={13} />{saveNote}</div>
    {/if}
    {#if !settings}
      <p class="muted">正在读取设置…</p>
    {:else if category === 'appearance'}
      <h2>外观</h2>
      <div class="row"><div><b>主题</b><small>跟随系统时随系统外观实时切换。便签自己的颜色不会被改写。</small></div>
        <div class="segmented" role="radiogroup" aria-label="主题">{#each themes as [value, text]}<button role="radio" aria-checked={settings.appearance.theme === value} class:on={settings.appearance.theme === value} onclick={() => patchAppearance({ theme: value })}>{text}</button>{/each}</div></div>
      <div class="row"><div><b>中心窗口阴影</b><small>标准：系统窗口阴影；细边：一圈细线，无阴影；关：都不显示。</small></div>
        <div class="segmented" role="radiogroup" aria-label="中心窗口阴影">{#each shadows as [value, text]}<button role="radio" aria-checked={settings.appearance.centerShadow === value} class:on={settings.appearance.centerShadow === value} onclick={() => patchAppearance({ centerShadow: value })}>{text}</button>{/each}</div></div>
      <div class="row"><div><b>便签与胶囊阴影</b><small>标准：系统阴影加细线；细边：更清楚的描边，无阴影；关：极淡的边。贴边标签始终保持扁平。</small></div>
        <div class="segmented" role="radiogroup" aria-label="便签与胶囊阴影">{#each shadows as [value, text]}<button role="radio" aria-checked={settings.appearance.noteShadow === value} class:on={settings.appearance.noteShadow === value} onclick={() => patchAppearance({ noteShadow: value })}>{text}</button>{/each}</div></div>
      <label class="row"><div><b>减少动态</b><small>关闭窗口滑动与淡入；系统开启“减弱动态效果”时也会生效。</small></div>
        <input type="checkbox" role="switch" checked={settings.appearance.reduceMotion} onchange={e => patchAppearance({ reduceMotion: e.currentTarget.checked })} /></label>
    {:else if category === 'window'}
      <h2>窗口与便签</h2>
      <label class="row"><div><b>开机自启</b>{#if autoStartStatus}<small class="warn">{autoStartStatus}</small>{/if}</div>
        <input type="checkbox" role="switch" checked={settings.autoStart} onchange={e => void setAutoStart(e.currentTarget.checked)} /></label>
      <label class="row"><div><b>边缘自动吸附</b><small>把中心或便签拖到屏幕左右边缘时收起为把手或标签。菜单里的“收起到边缘”不受影响。</small></div>
        <input type="checkbox" role="switch" checked={settings.behavior.edgeSnap} onchange={e => patch('behavior', { ...settings!.behavior, edgeSnap: e.currentTarget.checked })} /></label>
      <label class="row"><div><b>悬停预览</b><small>指针停在胶囊或边缘标签上时显示摘要。</small></div>
        <input type="checkbox" role="switch" checked={settings.behavior.hoverPreview} onchange={e => patch('behavior', { ...settings!.behavior, hoverPreview: e.currentTarget.checked })} /></label>
      <label class="row"><div><b>恢复上次工作状态</b><small>重新打开时恢复中心的 Tab 和选中的便签。</small></div>
        <input type="checkbox" role="switch" checked={settings.behavior.restoreSession} onchange={e => patch('behavior', { ...settings!.behavior, restoreSession: e.currentTarget.checked })} /></label>
      <h3>新便签默认值</h3>
      <p class="muted">只影响之后新建的便签，不会修改已有便签。</p>
      <div class="row"><div><b>颜色</b></div>
        <div class="swatches" role="radiogroup" aria-label="默认颜色">{#each noteColors as color}<button role="radio" aria-checked={settings.defaultNote.theme === color.theme} aria-label={color.label} title={color.label}
          class:on={settings.defaultNote.theme === color.theme} style:background={color.swatch} onclick={() => patch('defaultNote', { ...settings!.defaultNote, theme: color.theme })}></button>{/each}</div></div>
      <label class="row"><div><b>不透明度</b><small>{Math.round((opacityPreview ?? settings.defaultNote.opacity) * 100)}%</small></div>
        <input type="range" min="0.72" max="1" step="0.01" value={settings.defaultNote.opacity}
          oninput={e => opacityPreview = Number(e.currentTarget.value)}
          onchange={e => { opacityPreview = undefined; patch('defaultNote', { ...settings!.defaultNote, opacity: Number(e.currentTarget.value) }); }} /></label>
      <label class="row"><div><b>默认置顶</b></div>
        <input type="checkbox" role="switch" checked={settings.defaultNote.alwaysOnTop} onchange={e => patch('defaultNote', { ...settings!.defaultNote, alwaysOnTop: e.currentTarget.checked })} /></label>
    {:else if category === 'shortcuts'}
      <h2>快捷键</h2>
      {#each [['toggleWindow', '显示 / 隐藏全部便签'], ['newNote', '新建便签']] as [key, text]}
        {@const k = key as keyof AppSettings['shortcuts']}
        <div class="row"><div><b>{text}</b></div>
          <div class="shortcut">
            <button class="keys" class:recording={recordingFor === k} onclick={() => { shortcutError = ''; recordingFor = recordingFor === k ? null : k; }}>
              {recordingFor === k ? '请按下新的组合键…' : label(settings.shortcuts[k])}</button>
            <button class="icon" title="恢复默认" aria-label="恢复默认" onclick={() => setShortcut(k, platformDefaultShortcuts()[k])}><RotateCcw size={13} /></button>
          </div></div>
      {/each}
      {#if shortcutError}<p class="warn" role="alert">{shortcutError}</p>{/if}
      {#if shortcutStatus}<p class="warn" role="alert">{shortcutStatus}</p>{/if}
      <button class="text" onclick={() => patch('shortcuts', { ...platformDefaultShortcuts() })}><RotateCcw size={13} />全部恢复默认</button>
      <h3>应用内快捷键</h3>
      <dl>{#each inApp as [name, keys]}<dt>{name}</dt><dd><kbd>{keys}</kbd></dd>{/each}</dl>
    {:else if category === 'integration'}
      <h2>集成</h2>
      <IntegrationSettings />
    {:else}
      <h2>数据与更新</h2>
      <div class="row"><div><b>数据目录</b><small class="path">{dataPath || '不可用'}</small>{#if dataStatus}<small>{dataStatus}</small>{/if}</div>
        <div class="actions"><button class="text" onclick={openData}><FolderOpen size={13} />打开</button><button class="text" onclick={copyData}><Copy size={13} />复制路径</button></div></div>
      {#if onExportCurrent}<div class="row"><div><b>导出</b><small>把当前便签导出为 Markdown 文件。</small></div><button class="text" onclick={onExportCurrent}><Download size={13} />导出当前便签</button></div>{/if}
      <div class="row"><div><b>版本</b><small>PinNote {version}</small></div><button class="text" onclick={() => { updateStatus = '正在检查，结果会在系统对话框中显示'; void invoke('check_updates').catch(e => updateStatus = `检查失败：${e}`); }}><RefreshCw size={13} />检查更新</button></div>
      {#if updateStatus}<p class="muted" role="status">{updateStatus}</p>{/if}
    {/if}
  </div>
</section>

<style>
  .settings { position: absolute; inset: 0; z-index: 40; display: grid; grid-template-columns: 200px minmax(0, 1fr); background: var(--surface); color: var(--text); animation: settings-in var(--motion) var(--ease-out); }
  @keyframes settings-in { from { opacity: 0; transform: translateY(4px); } }
  nav { display: flex; flex-direction: column; gap: 2px; padding: 44px 10px 10px; background: var(--surface-muted); border-right: 1px solid var(--hairline); }
  nav button { display: flex; align-items: center; gap: 9px; justify-content: flex-start; width: 100%; padding: 7px 10px; border: 0; border-radius: var(--radius-sm); background: transparent; color: var(--text); font: inherit; font-size: 13px; cursor: pointer; transition: background var(--motion-fast); }
  nav button:hover { background: var(--hover); }
  nav .current { background: var(--accent-soft); color: var(--accent); }
  nav .back { color: var(--muted); margin-bottom: 10px; }
  .content { position: relative; overflow: auto; padding: 44px 36px 32px; max-width: 720px; width: 100%; }
  h2 { margin: 0 0 18px; font-size: 18px; font-weight: 600; color: var(--text-strong); }
  h3 { margin: 26px 0 4px; font-size: 13px; font-weight: 600; color: var(--text-strong); }
  .row { display: flex; align-items: center; justify-content: space-between; gap: 20px; padding: 12px 0; border-bottom: 1px solid var(--hairline); }
  .row > div:first-child { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  b { font-weight: 500; font-size: 13px; }
  small, .muted { color: var(--muted); font-size: 12px; line-height: 1.5; }
  .muted { margin: 0 0 4px; }
  .warn { color: var(--danger); }
  .path { overflow-wrap: anywhere; font-family: ui-monospace, Menlo, monospace; font-size: 11px; }
  .segmented { display: inline-flex; flex: 0 0 auto; padding: 2px; border-radius: var(--radius); background: var(--surface-sunken); box-shadow: inset 0 0 0 .5px var(--hairline); }
  .segmented button { border: 0; border-radius: var(--radius-sm); padding: 4px 12px; font: inherit; font-size: 12px; color: var(--muted); background: transparent; cursor: pointer; transition: background var(--motion-fast), color var(--motion-fast); }
  .segmented button.on { background: var(--tab-current); color: var(--text); box-shadow: var(--tab-current-shadow); }
  input[type="checkbox"][role="switch"] { appearance: none; flex: 0 0 auto; width: 32px; height: 19px; border-radius: 999px; background: var(--hover-strong); position: relative; cursor: pointer; transition: background var(--motion-fast); margin: 0; }
  input[type="checkbox"][role="switch"]::after { content: ''; position: absolute; top: 2px; left: 2px; width: 15px; height: 15px; border-radius: 50%; background: #fff; box-shadow: 0 1px 2px #0000003d; transition: transform var(--motion-fast) var(--ease-out); }
  input[type="checkbox"][role="switch"]:checked { background: var(--accent); }
  input[type="checkbox"][role="switch"]:checked::after { transform: translateX(13px); }
  input:focus-visible, button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  input[type="range"] { width: 180px; accent-color: var(--accent); }
  .swatches { display: flex; gap: 7px; }
  .swatches button { width: 22px; height: 22px; padding: 0; border-radius: 50%; border: 1px solid var(--hairline); cursor: pointer; }
  .swatches button.on { outline: 2px solid var(--accent); outline-offset: 2px; }
  .shortcut, .actions { display: flex; align-items: center; gap: 6px; flex: 0 0 auto; }
  .keys { min-width: 150px; padding: 5px 10px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface-raised); color: var(--text); font: inherit; font-size: 12px; cursor: pointer; }
  .keys.recording { border-color: var(--accent); color: var(--accent); }
  .icon, .text { display: inline-flex; align-items: center; gap: 5px; border: 0; border-radius: var(--radius-sm); padding: 5px 8px; background: transparent; color: var(--accent); font: inherit; font-size: 12px; cursor: pointer; transition: background var(--motion-fast); }
  .icon { color: var(--muted); }
  .icon:hover, .text:hover { background: var(--accent-soft); }
  .text { margin-top: 10px; }
  .row .text { margin-top: 0; }
  dl { display: grid; grid-template-columns: 1fr auto; gap: 8px 16px; margin: 10px 0 0; font-size: 12px; }
  dt { color: var(--text); } dd { margin: 0; }
  kbd { font: 11px ui-monospace, Menlo, monospace; padding: 2px 6px; border-radius: var(--radius-sm); background: var(--surface-sunken); border: 1px solid var(--border); }
  .save-error, .save-note { z-index: 1; display: flex; align-items: center; gap: 8px; padding: 7px 10px; border-radius: var(--radius); font-size: 12px; }
  /* The error stays in view while scrolling; the confirmation floats so the page doesn't jump. */
  .save-error { position: sticky; top: -44px; margin: -30px 0 14px; }
  .save-note { position: absolute; top: 8px; left: 26px; }
  .save-error { color: var(--danger); background: var(--danger-soft); }
  .save-error button { display: inline-flex; align-items: center; gap: 4px; margin-left: auto; border: 0; border-radius: var(--radius-sm); padding: 3px 8px; font: inherit; font-size: 12px; color: var(--danger); background: transparent; cursor: pointer; }
  .save-note { color: var(--muted); }
  @media (max-width: 640px) { .settings { grid-template-columns: 150px minmax(0, 1fr); } .content { padding: 44px 18px 24px; } .row { flex-wrap: wrap; } }
</style>
