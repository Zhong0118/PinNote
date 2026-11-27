<script lang="ts">
  // Global settings, shown only inside the note center. The notes view stays mounted
  // underneath, so returning keeps tabs, selection, scroll, drafts and undo history.
  import { onMount } from 'svelte';
  import { emit } from '@tauri-apps/api/event';
  import { invoke } from '@tauri-apps/api/core';
  import { getVersion } from '@tauri-apps/api/app';
  import { disable, enable, isEnabled } from '@tauri-apps/plugin-autostart';
  import { openPath, revealItemInDir } from '@tauri-apps/plugin-opener';
  import { ArrowLeft, Palette, AppWindow, Keyboard, Plug, Database, Check, RotateCcw, FolderOpen, Copy, RefreshCw, Download, ArchiveRestore, HardDriveDownload, FolderDown } from 'lucide-svelte';
  import { open as openDialog } from '@tauri-apps/plugin-dialog';
  import { loadNotes } from '$lib/notesStore';
  import { shortTime } from '$lib/excerpt';
  import { exportFiles, exportFolderName } from '$lib/library';
  import IntegrationSettings from './IntegrationSettings.svelte';
  import PixelMark from './PixelMark.svelte';
  import { noteColors } from '$lib/noteAppearance';
  import { applyAppearance } from '$lib/theme';
  import { overlay } from '$lib/motion';
  import { loadSettings, saveSettings, isMacPlatform, isNativeApp, normalizeShortcut, platformDefaultShortcuts, shortcutIdentity, shortcutKeyFromEvent,
    trashDayOptions, type AppSettings, type AppearanceSettings, type ShadowLevel, type ThemeMode } from '$lib/settings';

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
  let glassPreview = $state<number>();
  type Backup = { name: string; at: number; beforeRestore: boolean; size: number; notes: number };
  let backups = $state<Backup[]>([]);
  let backupStatus = $state('');
  let exportStatus = $state('');
  let exportedPath = $state('');
  let restoring = $state('');
  let showAllBackups = $state(false);
  async function loadBackups() {
    try { backups = await invoke<Backup[]>('list_backups'); }
    catch (error) { backupStatus = `无法读取备份：${error}`; }
  }
  $effect(() => { if (category === 'data') void loadBackups(); });
  async function backupNow() {
    try {
      const name = await invoke<string | null>('backup_now');
      backupStatus = name ? '已备份当前全部便签' : '内容和最近一次备份相同，不需要再备份';
      await loadBackups();
    } catch (error) { backupStatus = `备份失败：${error}`; }
  }
  async function restore(backup: Backup) {
    const when = shortTime(backup.at);
    if (!window.confirm(`用 ${when} 的备份（${backup.notes} 张便签）替换当前全部便签？\n\n当前的全部便签会先另存为一份备份，然后 InkPin 会重新启动。`)) return;
    restoring = backup.name; backupStatus = '正在保存所有便签，随后恢复并重新启动…';
    try { await invoke('restore_backup', { name: backup.name }); }
    catch (error) { backupStatus = `没有恢复：${error}`; restoring = ''; }
  }
  async function exportAll() {
    exportStatus = ''; exportedPath = '';
    try {
      const dir = await openDialog({ directory: true, title: '选择导出位置' });
      if (!dir || Array.isArray(dir)) return;
      const files = exportFiles(Object.values((await loadNotes()).notes));
      exportedPath = await invoke<string>('export_notes', { dir, folder: exportFolderName(), files });
      exportStatus = `已导出 ${files.length} 张便签（归档的在「归档」文件夹里，回收站不导出）`;
    } catch (error) { exportStatus = `导出失败：${error}`; }
  }
  const kb = (bytes: number) => bytes < 1024 ? `${bytes} B` : `${Math.round(bytes / 1024)} KB`;
  const mod = isMacPlatform() ? '⌘' : 'Ctrl+';
  const inApp = [
    ['快速命令与便签跳转（中心）', `${mod}K`],
    ['新建便签（中心）', `${mod}N`],
    ['文内查找', `${mod}F`],
    ['搜索便签库（中心）', `${mod}⇧F`],
    ['调节阅读字号', `${mod}+ / ${mod}- / ${mod}0`],
    ['关闭当前 Tab（中心）', `${mod}W`],
    ['切换第 1–9 个 Tab', `${mod}1–9`],
    ['导出 Markdown', `${mod}S`],
    ['切换置顶', `${mod}T`],
    ['穿透参考模式（桌面便签）', `${mod}⇧G`],
    ['切换源码模式', `${mod}/`],
    ['打开设置', `${mod},`],
    ['加粗 / 斜体', `${mod}B / ${mod}I`],
    ['切换待办完成', `${mod}⇧Enter`],
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
    applyAppearance(appearance);
    if (isNativeApp()) void emit('appearance-preview', appearance);
    patch('appearance', appearance);
  }
  function previewGlass(value: number) {
    if (!settings) return;
    glassPreview = value;
    const appearance = { ...settings.appearance, glass: value };
    applyAppearance(appearance, false);
    if (isNativeApp()) void emit('appearance-preview', appearance);
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
  const themeIndex = $derived(Math.max(0, themes.findIndex(([v]) => v === settings?.appearance.theme)));
  const centerShadowIndex = $derived(Math.max(0, shadows.findIndex(([v]) => v === settings?.appearance.centerShadow)));
  const noteShadowIndex = $derived(Math.max(0, shadows.findIndex(([v]) => v === settings?.appearance.noteShadow)));
  const trashIndex = $derived(Math.max(0, trashDayOptions.indexOf(settings?.trashDays ?? 30)));
</script>

<svelte:window onkeydown={keydown} />

<section class="settings" aria-label="设置" transition:overlay>
  <div class="drag-strip" data-tauri-drag-region aria-hidden="true"></div>
  <nav aria-label="设置分类">
    <button class="back" onclick={onClose}><ArrowLeft size={15} />返回便签</button>
    {#each categories as item}
      <button class="category" class:current={category === item.id} aria-current={category === item.id ? 'page' : undefined} onclick={() => category = item.id}>
        <item.icon size={15} />{item.label}
      </button>
    {/each}
  </nav>
  <div class="content">
    <div class="content-inner">
      {#if saveError}
        <div class="save-error" role="alert">{saveError}<button onclick={retry} disabled={saving}><RefreshCw size={13} />重试</button></div>
      {:else if saveNote}
        <div class="save-note" role="status"><Check size={13} />{saveNote}</div>
      {/if}
      {#if !settings}
        <p class="muted">正在读取设置…</p>
      {:else if category === 'appearance'}
        <h2>外观</h2>
        <div class="row"><div><b>主题</b></div>
          <div class="segmented" style:--seg-count={themes.length} style:--seg-idx={themeIndex} role="radiogroup" aria-label="主题">
            <i class="seg-pill" aria-hidden="true"></i>
            {#each themes as [value, text]}<button role="radio" aria-checked={settings.appearance.theme === value} class:on={settings.appearance.theme === value} onclick={() => patchAppearance({ theme: value })}>{text}</button>{/each}
          </div></div>
        <div class="row"><div><b>中心窗口阴影</b><small>细边只显示边框</small></div>
          <div class="segmented" style:--seg-count={shadows.length} style:--seg-idx={centerShadowIndex} role="radiogroup" aria-label="中心窗口阴影">
            <i class="seg-pill" aria-hidden="true"></i>
            {#each shadows as [value, text]}<button role="radio" aria-checked={settings.appearance.centerShadow === value} class:on={settings.appearance.centerShadow === value} onclick={() => patchAppearance({ centerShadow: value })}>{text}</button>{/each}
          </div></div>
        <div class="row"><div><b>便签与胶囊阴影</b><small>贴边标签始终无阴影</small></div>
          <div class="segmented" style:--seg-count={shadows.length} style:--seg-idx={noteShadowIndex} role="radiogroup" aria-label="便签与胶囊阴影">
            <i class="seg-pill" aria-hidden="true"></i>
            {#each shadows as [value, text]}<button role="radio" aria-checked={settings.appearance.noteShadow === value} class:on={settings.appearance.noteShadow === value} onclick={() => patchAppearance({ noteShadow: value })}>{text}</button>{/each}
          </div></div>
        {#if isMacPlatform()}
          <label class="row">
            <div><b>毛玻璃</b><small>0% 为不透明。系统开启「降低透明度」时也会不透明</small></div>
            <span class="glass-range">
              <small>不透明</small>
              <input type="range" min="0" max="100" step="5" value={glassPreview ?? settings.appearance.glass} aria-label="毛玻璃透明度"
                oninput={e => previewGlass(Number(e.currentTarget.value))}
                onchange={e => { const val = Number(e.currentTarget.value); glassPreview = undefined; patchAppearance({ glass: val }); }} />
              <small class="pct">{glassPreview ?? settings.appearance.glass}%</small>
            </span>
          </label>
        {/if}
        <label class="row"><div><b>点阵纸纹</b><small>正文和源码都显示方点</small></div>
          <span class="paper-grid-control">
            <i class="paper-grid-sample" aria-hidden="true"></i>
            <input type="checkbox" role="switch" checked={settings.appearance.paperGrid} onchange={e => patchAppearance({ paperGrid: e.currentTarget.checked })} />
          </span>
        </label>
        <label class="row"><div><b>像素粒子</b><small>完成清单、收藏便签或连续记录满 7 天、30 天时播放</small></div>
          <input type="checkbox" role="switch" checked={settings.appearance.celebrate} onchange={e => patchAppearance({ celebrate: e.currentTarget.checked })} /></label>
        <label class="row"><div><b>减少动态效果</b><small>停用滑动、缩放和淡入淡出</small></div>
          <input type="checkbox" role="switch" checked={settings.appearance.reduceMotion} onchange={e => patchAppearance({ reduceMotion: e.currentTarget.checked })} /></label>
      {:else if category === 'window'}
        <h2>窗口与便签</h2>
        <label class="row"><div><b>开机自启</b>{#if autoStartStatus}<small class="warn">{autoStartStatus}</small>{/if}</div>
          <input type="checkbox" role="switch" checked={settings.autoStart} onchange={e => void setAutoStart(e.currentTarget.checked)} /></label>
        <label class="row"><div><b>拖到边缘时收起</b><small>拖到屏幕左侧或右侧即可收起</small></div>
          <input type="checkbox" role="switch" checked={settings.behavior.edgeSnap} onchange={e => patch('behavior', { ...settings!.behavior, edgeSnap: e.currentTarget.checked })} /></label>
        <label class="row"><div><b>悬停预览</b><small>指针停在胶囊或贴边标签上时显示预览</small></div>
          <input type="checkbox" role="switch" checked={settings.behavior.hoverPreview} onchange={e => patch('behavior', { ...settings!.behavior, hoverPreview: e.currentTarget.checked })} /></label>
        <label class="row"><div><b>闲置便签变淡</b><small>窗口失焦且指针移开时变淡</small></div>
          <input type="checkbox" role="switch" checked={settings.behavior.fadeOnBlur} onchange={e => patch('behavior', { ...settings!.behavior, fadeOnBlur: e.currentTarget.checked })} /></label>
        <label class="row"><div><b>共享屏幕时隐藏</b><small>也适用于截屏和录屏。macOS 的效果取决于录制软件</small></div>
          <input type="checkbox" role="switch" checked={settings.behavior.hideFromCapture} onchange={e => patch('behavior', { ...settings!.behavior, hideFromCapture: e.currentTarget.checked })} /></label>
        <label class="row"><div><b>恢复上次打开的标签页</b><small>重新打开中心时恢复所选便签</small></div>
          <input type="checkbox" role="switch" checked={settings.behavior.restoreSession} onchange={e => patch('behavior', { ...settings!.behavior, restoreSession: e.currentTarget.checked })} /></label>
        <h3>新便签默认值</h3>
        <div class="row"><div><b>颜色</b></div>
          <div class="swatches" role="radiogroup" aria-label="默认颜色">
            {#each noteColors as color}<button role="radio" aria-checked={settings.defaultNote.theme === color.theme} aria-label={color.label} title={color.label}
              class:on={settings.defaultNote.theme === color.theme} style:background={color.swatch} onclick={() => patch('defaultNote', { ...settings!.defaultNote, theme: color.theme })}></button>{/each}
            <label class="custom-swatch" class:on={settings.defaultNote.theme === 'custom'} style:background={settings.defaultNote.customColor} title="自定义颜色">
              <input type="color" aria-label="自定义默认颜色" value={settings.defaultNote.customColor}
                onchange={e => patch('defaultNote', { ...settings!.defaultNote, theme: 'custom', customColor: e.currentTarget.value })} />
            </label>
          </div></div>
        <label class="row"><div><b>不透明度</b><small>{Math.round((opacityPreview ?? settings.defaultNote.opacity) * 100)}%</small></div>
          <input type="range" min="0.72" max="1" step="0.01" value={settings.defaultNote.opacity}
            oninput={e => opacityPreview = Number(e.currentTarget.value)}
            onchange={e => { opacityPreview = undefined; patch('defaultNote', { ...settings!.defaultNote, opacity: Number(e.currentTarget.value) }); }} /></label>
        <label class="row"><div><b>默认置顶</b></div>
          <input type="checkbox" role="switch" checked={settings.defaultNote.alwaysOnTop} onchange={e => patch('defaultNote', { ...settings!.defaultNote, alwaysOnTop: e.currentTarget.checked })} /></label>
      {:else if category === 'shortcuts'}
        <h2>快捷键</h2>
        {#each [['toggleWindow', '显示或隐藏全部便签'], ['newNote', '新建便签'], ['quickCapture', '快速速记']] as [key, text]}
          {@const k = key as keyof AppSettings['shortcuts']}
          <div class="row"><div><b>{text}</b></div>
            <div class="shortcut">
              <button class="keys" class:recording={recordingFor === k} onclick={() => { shortcutError = ''; recordingFor = recordingFor === k ? null : k; }}>
                {recordingFor === k ? '按下组合键' : label(settings.shortcuts[k])}</button>
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
        <div class="row"><div><b>导出便签</b><small>每张便签一个 Markdown 文件，归档另存</small>
            {#if exportStatus}<small>{exportStatus}{#if exportedPath} <button class="link" onclick={() => void revealItemInDir(exportedPath).catch(() => undefined)}>在文件夹中显示</button>{/if}</small>{/if}</div>
          <div class="actions">{#if onExportCurrent}<button class="text" onclick={onExportCurrent}><Download size={13} />当前便签</button>{/if}<button class="text" onclick={exportAll}><FolderDown size={13} />导出全部</button></div></div>
        <div class="row"><div><b>回收站保留天数</b><small>到期后自动删除，删除前的内容仍在当天的备份里</small></div>
          <div class="segmented" style:--seg-count={trashDayOptions.length} style:--seg-idx={trashIndex} role="radiogroup" aria-label="回收站保留天数">
            <i class="seg-pill" aria-hidden="true"></i>
            {#each trashDayOptions as days}<button role="radio" aria-checked={settings.trashDays === days} class:on={settings.trashDays === days} onclick={() => patch('trashDays', days)}>{days ? `${days} 天` : '永不'}</button>{/each}
          </div></div>
        <div class="block">
          <div class="head"><div><b>自动备份</b><small>有改动时每天备份一次，保留最近 14 份。恢复前会先备份当前便签</small></div>
            <div class="actions">{#if backups.length > 5}<button class="text" onclick={() => showAllBackups = !showAllBackups}>{showAllBackups ? '收起' : `全部 ${backups.length} 份`}</button>{/if}<button class="text" onclick={backupNow}><HardDriveDownload size={13} />立即备份</button></div></div>
          <div class="backups">
            {#each showAllBackups ? backups : backups.slice(0, 5) as backup (backup.name)}
              <div class="backup"><span class="when">{shortTime(backup.at)}</span>
                <small>{backup.notes} 张便签 · {kb(backup.size)}</small>{#if backup.beforeRestore}<span class="label" title="恢复备份之前自动另存的内容">恢复前</span>{/if}
                <button class="text" disabled={Boolean(restoring)} onclick={() => restore(backup)}><ArchiveRestore size={13} />{restoring === backup.name ? '恢复中…' : '恢复'}</button></div>
            {:else}<p class="muted">暂无备份</p>{/each}
          </div>
          {#if backupStatus}<small class="status" role="status">{backupStatus}</small>{/if}
        </div>
        <div class="row"><div><b>版本</b><small class="brand-ver"><PixelMark variant="brand" size={14} />驻墨 InkPin {version}</small></div><button class="text" onclick={() => { updateStatus = '正在检查，结果会在系统对话框中显示'; void invoke('check_updates').catch(e => updateStatus = `检查失败：${e}`); }}><RefreshCw size={13} />检查更新</button></div>
        {#if updateStatus}<p class="muted" role="status">{updateStatus}</p>{/if}
      {/if}
    </div>
  </div>
</section>

<style>
  .settings { --nav-w: 200px; position: absolute; inset: 0; z-index: 40; display: grid; grid-template-columns: var(--nav-w) minmax(0, 1fr); background: var(--surface); color: var(--text); }
  .drag-strip { position: absolute; top: 0; left: 0; right: 0; height: 36px; z-index: 2; }
  nav { display: flex; flex-direction: column; gap: 2px; padding: 44px 10px 10px; background: var(--surface-muted); border-right: 1px solid var(--hairline); }
  nav button { position: relative; z-index: 3; display: flex; align-items: center; gap: 9px; justify-content: flex-start; width: 100%; padding: 7px 10px; border: 0; border-radius: var(--px-radius); background: transparent; color: var(--text); font: inherit; font-size: 13px; cursor: pointer; transition: background var(--motion-fast), color var(--motion-fast), box-shadow var(--motion-fast), transform var(--motion-fast); }
  nav button:hover { background: var(--hover); }
  nav button:active { transform: scale(.98); }
  nav .current { background: var(--px-selected); color: var(--text-strong); font-weight: 600; box-shadow: var(--px-selected-edge); }
  nav .back { color: var(--muted); margin-bottom: 10px; }
  .content { position: relative; overflow: auto; background: var(--surface); }
  .content-inner { position: relative; padding: 44px 36px 32px; max-width: 720px; width: 100%; }
  h2 { margin: 0 0 18px; font-size: 18px; font-weight: 600; color: var(--text-strong); }
  h3 { margin: 26px 0 4px; font-size: 13px; font-weight: 600; color: var(--text-strong); }
  .row { display: flex; align-items: center; justify-content: space-between; gap: 20px; padding: 12px 0; border-bottom: 1px solid var(--hairline); }
  .brand-ver { display: inline-flex; align-items: center; gap: 5px; }
  .row > div:first-child { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  b { font-weight: 500; font-size: 13px; }
  small, .muted { color: var(--muted); font-size: 12px; line-height: 1.5; }
  .muted { margin: 0 0 4px; }
  .warn { color: var(--danger); }
  .path { overflow-wrap: anywhere; font-family: ui-monospace, Menlo, monospace; font-size: 11px; }
  .segmented { position: relative; display: inline-grid; grid-auto-flow: column; grid-auto-columns: 1fr; flex: 0 0 auto; padding: 2px; border-radius: var(--px-radius); background: var(--surface-sunken); box-shadow: inset 0 0 0 1px var(--border); }
  .segmented .seg-pill { position: absolute; top: 2px; bottom: 2px; left: 2px; width: calc((100% - 4px) / var(--seg-count, 3)); border-radius: var(--px-radius); background: var(--px-selected); box-shadow: var(--px-selected-edge); transform: translateX(calc(var(--seg-idx, 0) * 100%)); transition: transform var(--motion) var(--ease-out); pointer-events: none; }
  .segmented button { position: relative; z-index: 1; border: 0; border-radius: var(--px-radius); padding: 4px 12px; font: inherit; font-size: 12px; color: var(--muted); background: transparent; cursor: pointer; white-space: nowrap; transition: color var(--motion-fast), transform var(--motion-fast); }
  .segmented button:hover { color: var(--text); }
  .segmented button:active { transform: scale(.96); }
  .segmented button.on { color: var(--text-strong); font-weight: 600; }
  .paper-grid-control { display: flex; align-items: center; gap: 10px; flex: 0 0 auto; }
  .paper-grid-sample { width: 36px; height: 24px; border: 1px solid var(--border); border-radius: var(--px-radius);
    background: var(--paper-grid) 4px 4px / 10px 10px var(--surface-raised); box-shadow: var(--px-shadow); }
  input:focus-visible, button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  input[type="range"] { width: 180px; accent-color: var(--accent); cursor: pointer; }
  @supports selector(input::-webkit-slider-thumb) {
    @media not (forced-colors: active) {
      input[type="range"] { appearance: none; height: 24px; background: transparent; }
      input[type="range"]::-webkit-slider-runnable-track { height: 4px; background: var(--px-rule); border-block-end: 1px solid var(--border); }
      input[type="range"]::-webkit-slider-thumb { appearance: none; width: 12px; height: 12px; margin-top: -4px; border-radius: var(--px-radius); background: var(--accent); box-shadow: var(--px-shadow-accent); }
    }
  }
  .glass-range { display: inline-flex; flex: 0 0 auto; align-items: center; gap: 8px; }
  .glass-range input[type="range"] { width: 146px; }
  .glass-range .pct { min-width: 34px; text-align: right; font-variant-numeric: tabular-nums; color: var(--text); }
  .swatches { display: flex; flex-wrap: wrap; align-items: center; gap: 7px; }
  .swatches button, .custom-swatch { width: 22px; height: 22px; padding: 0; border-radius: var(--px-radius); border: 1px solid var(--border); cursor: pointer; transition: transform var(--motion-fast), box-shadow var(--motion-fast); }
  .swatches button:hover, .custom-swatch:hover { transform: scale(1.1); }
  .swatches button.on, .custom-swatch.on { box-shadow: var(--px-swatch-edge); }
  .custom-swatch { position: relative; overflow: hidden; display: inline-block; }
  .custom-swatch input { position: absolute; inset: -4px; width: 32px; height: 32px; opacity: 0; cursor: pointer; border: 0; }
  .shortcut, .actions { display: flex; align-items: center; gap: 6px; flex: 0 0 auto; }
  .keys { min-width: 150px; padding: 5px 10px; border: 1px solid var(--border); border-radius: var(--px-radius); background: var(--surface-raised); color: var(--text); font: 12px/1.5 var(--font-pixel); box-shadow: var(--px-shadow); cursor: pointer; }
  .keys.recording { border-color: var(--accent); color: var(--accent); }
  .icon, .text { display: inline-flex; align-items: center; gap: 5px; border: 0; border-radius: var(--radius-sm); padding: 5px 8px; background: transparent; color: var(--accent); font: inherit; font-size: 12px; cursor: pointer; transition: background var(--motion-fast), transform var(--motion-fast); }
  .icon { color: var(--muted); }
  .icon:hover, .text:hover { background: var(--accent-soft); }
  .icon:active, .text:active { transform: scale(.96); }
  .text { margin-top: 10px; }
  .row .text { margin-top: 0; }
  .link { border: 0; padding: 0; background: none; color: var(--accent); font: inherit; font-size: 12px; cursor: pointer; text-decoration: underline; text-underline-offset: 2px; }
  .block { padding: 12px 0; border-bottom: 1px solid var(--hairline); }
  .block .head { display: flex; align-items: center; justify-content: space-between; gap: 20px; }
  .block .head > div:first-child { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .block .text { margin-top: 0; }
  .backups { display: flex; flex-direction: column; margin-top: 10px; border-radius: var(--radius); background: color-mix(in srgb, var(--surface-muted) 80%, transparent); box-shadow: inset 0 0 0 .5px var(--hairline); overflow: hidden; }
  .backup { display: flex; align-items: center; gap: 12px; min-height: 34px; padding: 0 4px 0 12px; }
  .backup + .backup { border-top: 1px solid var(--hairline); }
  .backup .when { flex: 0 0 112px; color: var(--text); font-size: 12.5px; font-variant-numeric: tabular-nums; }
  .backup small { font-variant-numeric: tabular-nums; }
  .backup .text { margin-left: auto; }
  .backup .label { padding: 1px 6px; border-radius: 999px; background: var(--accent-soft); color: var(--accent); font-size: 11px; line-height: 16px; }
  .backups .muted { margin: 0; padding: 10px 12px; }
  .block .status { display: block; margin-top: 8px; }
  button:disabled { opacity: .5; cursor: default; }
  dl { display: grid; grid-template-columns: 1fr auto; gap: 8px 16px; margin: 10px 0 0; font-size: 12px; }
  dt { color: var(--text); } dd { margin: 0; }
  kbd { font: 11px ui-monospace, Menlo, monospace; padding: 2px 6px; border-radius: var(--radius-sm); background: var(--fill); border: 1px solid var(--hairline); }
  .save-error, .save-note { z-index: 4; display: flex; align-items: center; gap: 8px; padding: 7px 10px; border-radius: var(--radius); font-size: 12px; }
  .save-error { position: sticky; top: 8px; margin: -30px 0 14px; color: var(--danger); background: var(--danger-soft); }
  .save-note { position: absolute; top: 8px; left: 26px; color: var(--muted); }
  .save-error button { display: inline-flex; align-items: center; gap: 4px; margin-left: auto; border: 0; border-radius: var(--radius-sm); padding: 3px 8px; font: inherit; font-size: 12px; color: var(--danger); background: transparent; cursor: pointer; }
  /* macOS glass: both panes live-track --glass-chrome / --glass-page so dragging the slider previews immediately. */
  :global(:root[data-glass]) .settings { background: transparent; }
  :global(:root[data-glass]) .settings > nav {
    background: color-mix(in srgb, var(--surface-muted) var(--glass-chrome, 56%), transparent);
    box-shadow: inset 0 1px 0 var(--glass-edge), inset -1px 0 0 var(--glass-divider-light);
  }
  :global(:root[data-glass]) .settings > .content {
    background: color-mix(in srgb, var(--surface) var(--glass-page, 85%), transparent);
    box-shadow: inset 0 1px 0 var(--glass-edge);
  }
  @media (max-width: 640px) { .settings { --nav-w: 150px; } .content-inner { padding: 44px 18px 24px; } .row { flex-wrap: wrap; } }
  @media (prefers-reduced-motion: reduce) { .segmented .seg-pill { transition: none; } }
</style>
