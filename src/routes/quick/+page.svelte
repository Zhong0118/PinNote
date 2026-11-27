<script lang="ts">
  import { onMount } from 'svelte';
  import { emit, emitTo, listen } from '@tauri-apps/api/event';
  import { getCurrentWindow } from '@tauri-apps/api/window';
  import { invoke } from '@tauri-apps/api/core';
  import { Bell, Check, Hash, Monitor, CornerDownLeft } from 'lucide-svelte';
  import PixelMark from '../../components/PixelMark.svelte';
  import { QUICK_LABEL } from '$lib/quickWindow';
  import { parseQuickCapture } from '$lib/quickCapture';
  import { createNote, discardPendingSave, noteOperation, saveNoteNow } from '$lib/notesStore';
  import { noteColors } from '$lib/noteAppearance';
  import { defaultSettings, isMacPlatform, loadSettings, type NoteTheme } from '$lib/settings';
  import { applyWindowGlass, effectiveGlass, onAppearance } from '$lib/theme';
  import { reveal } from '$lib/motion';

  let raw = $state('');
  let theme = $state<NoteTheme>('paper');
  let customColor = $state('#2d7d74');
  let opacity = $state(0.96);
  let alwaysOnTop = $state(true);
  let toDesktop = $state(false);
  let savedFlash = $state(false);
  let saving = $state(false);
  let feedback = $state('');
  let hideTimer: ReturnType<typeof setTimeout>;
  let input = $state<HTMLTextAreaElement>();

  const mac = isMacPlatform();
  let glassLevel = $state(0);
  const glass = $derived(mac && glassLevel > 0);
  const parsed = $derived(parseQuickCapture(raw));
  const currentSwatch = $derived(noteColors.find(c => c.theme === theme)?.swatch ?? customColor);

  $effect(() => {
    document.documentElement.toggleAttribute('data-glass', glass);
    void applyWindowGlass(glass, 16);
  });

  async function syncDefaults() {
    const s = await loadSettings().catch(() => defaultSettings);
    theme = s.defaultNote.theme;
    customColor = s.defaultNote.customColor;
    opacity = s.defaultNote.opacity;
    alwaysOnTop = s.defaultNote.alwaysOnTop;
  }

  onMount(() => {
    void syncDefaults();
    const stopGlass = onAppearance(a => { glassLevel = effectiveGlass(a); });
    const openListener = listen('quick-open', () => {
      clearTimeout(hideTimer);
      savedFlash = false;
      if (!raw.trim()) { feedback = ''; void syncDefaults(); }
      requestAnimationFrame(() => input?.focus());
    });
    const blurListener = getCurrentWindow().onFocusChanged(({ payload }) => {
      if (!payload && !raw.trim() && !saving && !feedback) {
        void getCurrentWindow().hide();
      }
    });
    void openListener.then(() => emitTo(QUICK_LABEL, 'quick-ready'));
    return () => {
      stopGlass();
      clearTimeout(hideTimer);
      openListener.then(f => f());
      blurListener.then(f => f());
    };
  });

  function cycleColor() {
    const idx = noteColors.findIndex(c => c.theme === theme);
    theme = noteColors[(idx + 1) % noteColors.length].theme;
  }

  async function submit(pinToDesktop = toDesktop) {
    if (saving) return;
    const result = parseQuickCapture(raw);
    if (!result.content) return;
    saving = true;
    feedback = '';
    try {
      const created = createNote({
        title: '',
        content: result.content,
        placement: pinToDesktop ? 'desktop' : 'center',
        theme,
        customColor,
        opacity,
        alwaysOnTop,
        tags: result.tags,
      });
      try {
        await saveNoteNow(created);
      } catch {
        discardPendingSave(created.id);
        feedback = '速记未保存，请重试';
        requestAnimationFrame(() => input?.focus());
        return;
      }
      if (result.reminderAt) {
        const permission = await invoke<string>('reminder_permission').catch(() => null);
        if (permission === null) {
          feedback = '便签已保存，未能确认通知权限。请检查系统通知设置。';
        } else if (permission !== 'Granted') {
          feedback = '便签已保存，提醒未设置。请在系统设置中允许通知，再到便签中设置提醒。';
        } else {
          try {
            await noteOperation(created, 'reminder', { at: result.reminderAt });
          } catch {
            feedback = '便签已保存，提醒设置失败。可在便签中重试。';
          }
        }
      }
      raw = '';
      if (pinToDesktop) {
        try {
          await emit('open-note-requested', { id: created.id });
        } catch {
          feedback = feedback ? `${feedback} 桌面窗口未打开。` : '便签已保存，桌面窗口未打开';
          return;
        }
      }
      if (feedback) return;
      savedFlash = true;
      hideTimer = setTimeout(() => {
        savedFlash = false;
        void getCurrentWindow().hide();
      }, 240);
    } finally {
      saving = false;
    }
  }

  function keydown(e: KeyboardEvent) {
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      if (saving) return;
      raw = '';
      feedback = '';
      clearTimeout(hideTimer);
      savedFlash = false;
      void getCurrentWindow().hide();
    } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void submit(true);
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void submit(toDesktop);
    }
  }
</script>

<main class="hud" class:glass class:flashed={savedFlash}>
  <div class="input-row">
    <span class="mark" data-tauri-drag-region>
      {#if savedFlash}<Check size={17} />{:else}<PixelMark variant="nib" size={18} />{/if}
    </span>
    <textarea
      bind:this={input}
      bind:value={raw}
      rows="2"
      placeholder="写便签，可加 #标签、@30m 提醒或 [] 待办"
      aria-label="快速速记输入"
      readonly={saving || savedFlash}
      onkeydown={keydown}
    ></textarea>
  </div>
  {#if parsed.tags.length || parsed.reminderLabel}
    <div class="chips" aria-label="已识别标记" transition:reveal>
      {#if parsed.reminderLabel}
        <span class="chip reminder" transition:reveal><Bell size={11} />{parsed.reminderLabel}</span>
      {/if}
      {#each parsed.tags as tag (tag)}
        <span class="chip" transition:reveal><Hash size={11} />{tag}</span>
      {/each}
    </div>
  {/if}
  <div class="feedback" role="alert">
    {#if feedback}<span transition:reveal>{feedback}</span>{/if}
  </div>
  <footer>
    <button type="button" class="color-btn" title="切换便签纸色" aria-label="切换便签纸色" onclick={cycleColor}>
      <i style:background={currentSwatch}></i>
    </button>
    <button type="button" class="dest-btn" class:desktop={toDesktop} onclick={() => (toDesktop = !toDesktop)}>
      <Monitor size={12} />{toDesktop ? '直接贴到桌面' : '存入便签中心'}
    </button>
    <span class="hint">{mac ? '⌘' : 'Ctrl+'}Enter 贴桌面 · Shift+Enter 换行</span>
    <button type="button" class="send-btn" disabled={!parsed.content || saving} onclick={() => void submit(toDesktop)}>
      {#if savedFlash}已保存{:else}<CornerDownLeft size={12} />保存{/if}
    </button>
  </footer>
</main>

<style>
  :global(html), :global(body) { margin: 0; width: 100%; height: 100%; overflow: hidden; background: transparent; }
  :global(body) { font: 14px/1.5 var(--font); color: var(--text); -webkit-font-smoothing: antialiased; }
  .hud {
    box-sizing: border-box;
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    border-radius: 16px;
    border: 1px solid var(--border);
    background: var(--surface-raised);
    overflow: hidden;
    animation: hud-in 180ms var(--ease-out);
    transition: border-color var(--motion-fast);
  }
  .hud.glass {
    background: var(--glass-sheen), color-mix(in srgb, var(--surface-raised) var(--glass-note, 60%), transparent);
    box-shadow: inset 0 1px 0 var(--glass-edge), inset 1px 0 0 var(--glass-rim), inset 0 0 0 .5px var(--glass-rim);
  }
  .hud.flashed { border-color: var(--accent); }
  @keyframes hud-in { from { opacity: 0; transform: translateY(-6px) scale(.985); } }
  .input-row {
    flex: 1;
    min-height: 0;
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 14px 16px 8px;
  }
  .mark {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    margin-top: 2px;
    color: var(--accent);
    flex: 0 0 auto;
    cursor: grab;
    clip-path: var(--px-cut);
    background: var(--accent-soft);
    transition: background var(--motion-fast), transform var(--motion-fast) var(--ease-spring);
  }
  .flashed .mark { background: var(--accent-soft-strong); transform: scale(1.08); }
  textarea {
    flex: 1;
    min-width: 0;
    height: 100%;
    resize: none;
    border: 0;
    outline: 0;
    background: transparent;
    color: var(--text-strong);
    font: 15px/1.55 var(--font);
  }
  textarea::placeholder { color: var(--subtle); font-size: 13.5px; }
  .chips {
    display: flex;
    flex: 0 0 auto;
    overflow-x: auto;
    scrollbar-width: none;
    gap: 5px;
    padding: 0 16px 8px 54px;
  }
  .chips::-webkit-scrollbar { display: none; }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    padding: 1px 8px;
    border-radius: var(--radius-sm);
    flex: 0 0 auto;
    background: var(--accent-soft);
    color: var(--accent);
    font-size: 11px;
  }
  footer {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px 9px 14px;
    background: var(--px-rule) top / 100% 1px no-repeat, color-mix(in srgb, var(--fill) 70%, transparent);
  }
  button {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--muted);
    font: 11.5px/1.3 var(--font);
    cursor: pointer;
    transition: background var(--motion-fast), color var(--motion-fast), transform var(--motion-fast);
  }
  button:active { transform: scale(.96); }
  .color-btn { width: 24px; height: 24px; justify-content: center; padding: 0; }
  .color-btn:hover { background: var(--hover-strong); }
  .color-btn i { width: 12px; height: 12px; clip-path: var(--px-cut); box-shadow: inset 0 0 0 1px var(--hairline); }
  .dest-btn { padding: 4px 8px; background: var(--fill); color: var(--text); }
  .dest-btn:hover { background: var(--hover-strong); }
  .dest-btn.desktop { background: var(--accent-soft); color: var(--accent); }
  .hint { flex: 1; font-size: 10.5px; color: var(--muted); text-align: right; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .feedback span { display: block; padding: 0 16px 6px; color: var(--danger); font-size: 12px; }
  .send-btn {
    padding: 4px 11px;
    background: var(--accent);
    color: var(--on-accent);
    font-weight: 500;
    box-shadow: var(--px-shadow-accent);
  }
  .send-btn:hover:not(:disabled) { background: var(--accent-strong); }
  .send-btn:disabled { opacity: .4; cursor: default; }
  .flashed .send-btn { opacity: 1; }
</style>
