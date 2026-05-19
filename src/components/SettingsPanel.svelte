<script lang="ts">
  import { Palette, Pin, Rocket, SlidersHorizontal } from "lucide-svelte";
  import type { AppSettings, NoteTheme } from "$lib/settings";

  type Props = {
    settings: AppSettings;
    onChange: (settings: AppSettings) => void;
  };

  const themes: Array<{ value: NoteTheme; label: string; color: string }> = [
    { value: "paper", label: "纸张", color: "#d7b87c" },
    { value: "mint", label: "薄荷", color: "#2d9c7c" },
    { value: "rose", label: "玫瑰", color: "#c56b79" },
    { value: "sky", label: "天空", color: "#5f8fcf" },
    { value: "grape", label: "葡萄", color: "#7b65b7" },
    { value: "ink", label: "深色", color: "#30363a" },
  ];

  let { settings, onChange }: Props = $props();

  function patch(next: Partial<AppSettings>) {
    onChange({ ...settings, ...next });
  }
</script>

<aside class="settings-panel" aria-label="便签设置">
  <div class="panel-head">
    <SlidersHorizontal size={15} />
    <span>设置</span>
  </div>

  <label class="switch-row" title="启动系统时自动运行 PinNote">
    <span class="label-with-icon"><Rocket size={14} /> 开机自启</span>
    <input
      type="checkbox"
      checked={settings.autoStart}
      onchange={(event) => patch({ autoStart: event.currentTarget.checked })}
    />
  </label>

  <label class="switch-row" title="让便签保持在其他窗口上方">
    <span class="label-with-icon"><Pin size={14} /> 窗口置顶</span>
    <input
      type="checkbox"
      checked={settings.alwaysOnTop}
      onchange={(event) => patch({ alwaysOnTop: event.currentTarget.checked })}
    />
  </label>

  <label class="field">
    <span class="label-with-icon"><SlidersHorizontal size={14} /> 透明度</span>
    <input
      type="range"
      min="0.72"
      max="1"
      step="0.01"
      value={settings.opacity}
      oninput={(event) => patch({ opacity: Number(event.currentTarget.value) })}
    />
  </label>

  <div class="field">
    <span class="label-with-icon"><Palette size={14} /> 背景颜色</span>
    <div class="color-grid" aria-label="背景颜色">
      {#each themes as theme}
        <button
          class:active={settings.theme === theme.value}
          type="button"
          title={theme.label}
          aria-label={theme.label}
          style:--swatch={theme.color}
          onclick={() => patch({ theme: theme.value })}
        ></button>
      {/each}

      <label
        class="custom-swatch"
        class:active={settings.theme === "custom"}
        title="自定义颜色"
        style:--custom-color={settings.customColor}
      >
        <input
          type="color"
          value={settings.customColor}
          oninput={(event) =>
            patch({ theme: "custom", customColor: event.currentTarget.value })}
        />
      </label>
    </div>
  </div>
</aside>

<style>
  .settings-panel {
    position: absolute;
    top: 42px;
    right: 10px;
    z-index: 5;
    width: 224px;
    border: 1px solid color-mix(in srgb, var(--pin-border), transparent 10%);
    border-radius: 10px;
    padding: 12px;
    color: var(--pin-text);
    background:
      linear-gradient(180deg, color-mix(in srgb, var(--pin-bg), white 18%), var(--pin-bg));
    box-shadow:
      0 18px 42px rgba(22, 18, 12, 0.2),
      inset 0 1px 0 rgba(255, 255, 255, 0.48);
  }

  .panel-head {
    display: flex;
    align-items: center;
    gap: 7px;
    margin-bottom: 10px;
    color: var(--pin-heading);
    font-size: 12px;
    font-weight: 850;
  }

  .field,
  .switch-row {
    display: grid;
    gap: 8px;
    margin: 0 0 12px;
    color: color-mix(in srgb, var(--pin-text), transparent 20%);
    font-size: 12px;
    font-weight: 750;
  }

  .switch-row {
    grid-template-columns: 1fr auto;
    align-items: center;
    min-height: 28px;
  }

  .label-with-icon {
    display: inline-flex;
    align-items: center;
    gap: 7px;
  }

  input[type="checkbox"] {
    width: 34px;
    height: 20px;
    margin: 0;
    appearance: none;
    border: 1px solid color-mix(in srgb, var(--pin-border), transparent 10%);
    border-radius: 999px;
    background: color-mix(in srgb, var(--pin-text), transparent 88%);
    cursor: pointer;
    transition: 0.16s ease;
  }

  input[type="checkbox"]::before {
    content: "";
    display: block;
    width: 14px;
    height: 14px;
    margin: 2px;
    border-radius: 999px;
    background: white;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.18);
    transition: 0.16s ease;
  }

  input[type="checkbox"]:checked {
    border-color: color-mix(in srgb, var(--pin-accent), transparent 40%);
    background: var(--pin-accent);
  }

  input[type="checkbox"]:checked::before {
    transform: translateX(14px);
  }

  input[type="range"] {
    width: 100%;
    height: 24px;
    margin: 0;
    padding: 0;
    appearance: auto;
    -webkit-appearance: auto;
    accent-color: var(--pin-accent);
    cursor: pointer;
    pointer-events: auto;
  }

  .color-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 9px;
    align-items: center;
  }

  .color-grid button,
  .custom-swatch {
    position: relative;
    display: block;
    width: 26px;
    height: 26px;
    border: 2px solid transparent;
    border-radius: 999px;
    padding: 0;
    background: var(--swatch);
    box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.1);
    cursor: pointer;
  }

  .color-grid button.active,
  .custom-swatch.active {
    border-color: var(--pin-accent-strong);
  }

  .custom-swatch {
    --swatch: var(--custom-color);
    overflow: hidden;
  }

  .custom-swatch input {
    position: absolute;
    inset: -8px;
    width: 42px;
    height: 42px;
    opacity: 0;
    cursor: pointer;
  }
</style>
