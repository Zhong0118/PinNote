<script lang="ts">
  import { popup, reveal } from "$lib/motion";
  import { Plus, Trash2, X } from "lucide-svelte";
  import {
    createTemplateId,
    customTemplateLimit,
    deleteCustomTemplate,
    loadTemplates,
    saveCustomTemplate,
    type NoteTemplate,
  } from "$lib/templates";

  type Props = {
    open: boolean;
    hasContent: boolean;
    onApply: (template: NoteTemplate) => void;
    onClose: () => void;
  };

  let { open, hasContent, onApply, onClose }: Props = $props();

  let templates = $state<NoteTemplate[]>([]);
  let mode = $state<"list" | "create">("list");
  let name = $state("");
  let title = $state("");
  let content = $state("");
  let status = $state("");
  let pendingTemplate = $state<NoteTemplate | null>(null);

  const customCount = $derived(templates.filter((template) => !template.builtIn).length);
  const customLimitReached = $derived(customCount >= customTemplateLimit);

  $effect(() => {
    if (!open) return;
    mode = "list";
    status = "";
    pendingTemplate = null;
    void refreshTemplates();
  });

  async function refreshTemplates() {
    templates = await loadTemplates();
  }

  function applyTemplate(template: NoteTemplate) {
    if (hasContent && pendingTemplate?.id !== template.id) {
      pendingTemplate = template;
      status = `确认替换为「${template.name}」？`;
      return;
    }
    onApply(template);
    pendingTemplate = null;
    onClose();
  }

  async function createTemplate() {
    const templateName = name.trim();
    const templateContent = content.trimEnd();

    if (!templateName) {
      status = "请填写模板名称";
      return;
    }

    if (customLimitReached) {
      status = `最多只能保存 ${customTemplateLimit} 个自定义模板`;
      return;
    }

    try {
      await saveCustomTemplate({
        id: createTemplateId(),
        name: templateName,
        title: title.trim() || templateName,
        content: templateContent,
      });
      name = "";
      title = "";
      content = "";
      mode = "list";
      status = "模板已保存";
      await refreshTemplates();
    } catch (error) {
      status = error instanceof Error ? error.message : "模板保存失败";
    }
  }

  async function removeTemplate(template: NoteTemplate) {
    if (template.builtIn) return;
    if (!window.confirm(`删除模板「${template.name}」？`)) return;

    try {
      await deleteCustomTemplate(template.id);
      status = "模板已删除";
      await refreshTemplates();
    } catch {
      status = "模板删除失败";
    }
  }

</script>


{#if open}
  <div class="template-popover" use:popup={onClose} transition:reveal aria-label="模板" role="dialog" tabindex="-1">
      <header>
        <div>
          <h2>模板</h2>
        </div>
        <button class="icon-btn" type="button" title="关闭" aria-label="关闭" onclick={onClose}>
          <X size={16} />
        </button>
      </header>

      {#if mode === "list"}
        {#if pendingTemplate}
          <div class="confirm-row" transition:reveal>
            <span>替换当前内容？</span>
            <button type="button" onclick={() => applyTemplate(pendingTemplate!)}>替换</button>
            <button
              type="button"
              onclick={() => {
                pendingTemplate = null;
                status = "";
              }}
            >
              取消
            </button>
          </div>
        {/if}

        <div class="template-list" transition:reveal>
          {#each templates as template}
            <article class="template-item">
              <button
                class="template-main"
                class:pending={pendingTemplate?.id === template.id}
                type="button"
                onclick={() => applyTemplate(template)}
              >
                <span>{template.name}</span>
              </button>
              {#if !template.builtIn}
                <button
                  class="delete-btn"
                  type="button"
                  title="删除模板"
                  aria-label="删除模板"
                  onclick={() => removeTemplate(template)}
                >
                  <Trash2 size={14} />
                </button>
              {/if}
            </article>
          {/each}
        </div>

        <footer>
          <button
            class="create-btn"
            type="button"
            disabled={customLimitReached}
            onclick={() => {
              mode = "create";
              status = "";
            }}
          >
            <Plus size={15} />
            新增
          </button>
          <small>{customCount}/{customTemplateLimit}</small>
          {#if status}
            <span role={/失败|错误|请填写|最多/.test(status) ? "alert" : "status"}>{status}</span>
          {/if}
        </footer>
      {:else}
        <div class="template-form" transition:reveal>
          <label>
            模板名称
            <input bind:value={name} maxlength="28" placeholder="例如：日报" />
          </label>
          <label>
            默认标题
            <input bind:value={title} maxlength="40" placeholder="默认使用模板名称" />
          </label>
          <label>
            Markdown 内容
            <textarea bind:value={content} placeholder="# 标题&#10;&#10;- [ ] 待办"></textarea>
          </label>
        </div>

        <footer>
          <button class="secondary-btn" type="button" onclick={() => (mode = "list")}>返回</button>
          <button class="create-btn" type="button" onclick={createTemplate}>保存模板</button>
          {#if status}
            <span role={/失败|错误|请填写|最多/.test(status) ? "alert" : "status"}>{status}</span>
          {/if}
        </footer>
      {/if}
  </div>
{/if}

<style>
  .template-popover {
    position: fixed;
    top: 43px;
    right: 10px;
    z-index: 100;
    width: min(220px, calc(100vw - 16px));
    max-height: min(380px, calc(100vh - 51px));
    display: flex;
    flex-direction: column;
    border: 1px solid #e5e7eb;
    border-radius: 12px;
    overflow: hidden;
    color: #171717;
    background: #fff;
    box-shadow: 0 8px 28px #00000014;
  }

  header,
  footer {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    background: #fff;
    flex: 0 0 auto;
  }

  header {
    justify-content: space-between;
    border-bottom: 1px solid #ededee;
  }

  footer {
    flex-wrap: wrap;
    border-top: 1px solid #ededee;
  }

  h2 {
    margin: 0;
  }

  h2 {
    font-size: 13px;
    line-height: 1.25;
    font-weight: 750;
  }

  small,
  footer span {
    color: #737373;
    font-size: 12px;
  }

  button,
  input,
  textarea {
    font: inherit;
  }

  button {
    cursor: pointer;
    transition: background 140ms, color 140ms, transform 140ms;
  }

  button:disabled {
    cursor: not-allowed;
    opacity: 0.52;
  }

  .icon-btn,
  .delete-btn {
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    border: 1px solid transparent;
    border-radius: 5px;
    padding: 0;
    color: #737373;
    background: transparent;
  }

  .icon-btn:hover,
  .delete-btn:hover {
    border-color: #e5e7eb;
    color: #222;
    background: #f5f5f5;
  }

  .template-list {
    min-height: 0;
    overflow: auto;
    padding: 3px;
  }

  .confirm-row {
    flex: 0 0 auto;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto auto;
    align-items: center;
    gap: 6px;
    border-bottom: 1px solid #ededee;
    padding: 5px 7px;
    background: #eff6ff;
  }

  .confirm-row span {
    overflow: hidden;
    color: #1d4ed8;
    font-size: 12px;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .confirm-row button {
    border: 1px solid #bfdbfe;
    border-radius: 5px;
    padding: 2px 6px;
    color: #1d4ed8;
    background: #fff;
    font-size: 12px;
  }

  .confirm-row button:hover {
    background: #dbeafe;
  }

  .template-item {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: stretch;
    gap: 1px;
    border-radius: 5px;
  }

  .template-item:hover {
    background: #f5f5f5;
  }

  .template-main {
    display: grid;
    min-width: 0;
    border: 0;
    border-radius: 5px;
    padding: 5px 7px;
    min-height: 28px;
    text-align: left;
    color: #171717;
    background: transparent;
  }

  .template-main:hover,
  .template-main.pending {
    color: #111;
    background: #eff6ff;
  }

  .template-main span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12px;
    line-height: 1.25;
    font-weight: 500;
  }

  .create-btn,
  .secondary-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    border: 1px solid #e5e7eb;
    border-radius: 6px;
    padding: 4px 7px;
    color: #222;
    background: #eff6ff;
    font-size: 12px;
    font-weight: 600;
  }

  .secondary-btn {
    color: #555;
    background: #fff;
  }

  .create-btn:hover,
  .secondary-btn:hover {
    background: #eff6ff;
  }

  .template-form {
    display: grid;
    gap: 8px;
    min-height: 0;
    overflow: auto;
    padding: 8px;
  }

  label {
    display: grid;
    gap: 6px;
    color: #737373;
    font-size: 12px;
    font-weight: 700;
  }

  input,
  textarea {
    width: 100%;
    border: 1px solid #e5e7eb;
    border-radius: 6px;
    padding: 6px 8px;
    color: #171717;
    background: #fff;
    outline: 0;
  }

  input:focus,
  textarea:focus {
    outline: 2px solid #2563eb;
    outline-offset: 1px;
    border-color: #2563eb;
  }

  textarea {
    min-height: 96px;
    resize: vertical;
    font-family: "Cascadia Code", "SFMono-Regular", Consolas, monospace;
    font-size: 12px;
    line-height: 1.55;
  }

  button:hover { transform: scale(1.01); }
  button:active { transform: scale(0.97); }
  button:focus-visible { outline: 2px solid #2563eb; outline-offset: -2px; }
  @media (prefers-reduced-motion: reduce) { button { transition: none; } }

  @media (max-height: 360px) {
    .template-popover {
      top: 43px;
      right: 6px;
      width: min(210px, calc(100vw - 12px));
      max-height: calc(100vh - 49px);
    }

    header,
    footer {
      padding: 5px 6px;
    }

    .template-main {
      min-height: 25px;
      padding: 4px 6px;
    }

    .delete-btn,
    .icon-btn {
      width: 24px;
      height: 24px;
    }

    .template-form {
      gap: 6px;
      padding: 6px;
    }

    textarea {
      min-height: 72px;
    }
  }
</style>
