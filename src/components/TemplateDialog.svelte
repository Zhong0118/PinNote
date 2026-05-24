<script lang="ts">
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

  function handleWindowKeydown(event: KeyboardEvent) {
    if (open && event.key === "Escape") onClose();
  }
</script>

<svelte:window onkeydown={handleWindowKeydown} />

{#if open}
  <div class="template-popover" aria-label="模板" role="dialog" tabindex="-1">
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
          <div class="confirm-row">
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

        <div class="template-list">
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
            <span>{status}</span>
          {/if}
        </footer>
      {:else}
        <div class="template-form">
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
            <span>{status}</span>
          {/if}
        </footer>
      {/if}
  </div>
{/if}

<style>
  .template-popover {
    position: fixed;
    top: 46px;
    right: 10px;
    z-index: 100;
    width: min(230px, calc(100vw - 20px));
    max-height: min(440px, calc(100vh - 56px));
    display: grid;
    grid-template-rows: auto minmax(0, 1fr) auto;
    border: 1px solid #d7d2c7;
    border-radius: 8px;
    overflow: hidden;
    color: var(--pin-text);
    background: #fffdf7;
    box-shadow: 0 10px 24px rgba(0, 0, 0, 0.16);
  }

  header,
  footer {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px;
    background: #fffdf7;
  }

  header {
    justify-content: space-between;
    border-bottom: 1px solid #ebe6dc;
  }

  footer {
    border-top: 1px solid #ebe6dc;
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
    color: var(--pin-muted);
    font-size: 12px;
  }

  button,
  input,
  textarea {
    font: inherit;
  }

  button {
    cursor: pointer;
  }

  button:disabled {
    cursor: not-allowed;
    opacity: 0.52;
  }

  .icon-btn,
  .delete-btn {
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    border: 1px solid transparent;
    border-radius: 5px;
    padding: 0;
    color: var(--pin-muted);
    background: transparent;
  }

  .icon-btn:hover,
  .delete-btn:hover {
    border-color: #ded8cc;
    color: #222;
    background: #f3efe7;
  }

  .template-list {
    min-height: 0;
    overflow: auto;
    padding: 4px;
  }

  .confirm-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto auto;
    align-items: center;
    gap: 6px;
    border-bottom: 1px solid #ebe6dc;
    padding: 7px 8px;
    background: #fff7e6;
  }

  .confirm-row span {
    overflow: hidden;
    color: #6c4b12;
    font-size: 12px;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .confirm-row button {
    border: 1px solid #dfc78d;
    border-radius: 5px;
    padding: 3px 7px;
    color: #4c360d;
    background: #fffdf7;
    font-size: 12px;
  }

  .confirm-row button:hover {
    background: #f5e8c6;
  }

  .template-item {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: stretch;
    gap: 2px;
    border-radius: 6px;
  }

  .template-item:hover {
    background: #f2efe8;
  }

  .template-main {
    display: grid;
    min-width: 0;
    border: 0;
    border-radius: 6px;
    padding: 8px 9px;
    text-align: left;
    color: #24231f;
    background: transparent;
  }

  .template-main:hover,
  .template-main.pending {
    color: #111;
    background: #eee8dd;
  }

  .template-main span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 13px;
    font-weight: 500;
  }

  .create-btn,
  .secondary-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    border: 1px solid #d8d2c6;
    border-radius: 6px;
    padding: 5px 8px;
    color: #222;
    background: #f7f3ea;
    font-size: 12px;
    font-weight: 600;
  }

  .secondary-btn {
    color: #555;
    background: #fffdf7;
  }

  .create-btn:hover,
  .secondary-btn:hover {
    background: #eee8dd;
  }

  .template-form {
    display: grid;
    gap: 12px;
    min-height: 0;
    overflow: auto;
    padding: 10px;
  }

  label {
    display: grid;
    gap: 6px;
    color: var(--pin-muted);
    font-size: 12px;
    font-weight: 700;
  }

  input,
  textarea {
    width: 100%;
    border: 1px solid #d8d2c6;
    border-radius: 6px;
    padding: 8px 9px;
    color: #24231f;
    background: #fff;
    outline: 0;
  }

  input:focus,
  textarea:focus {
    border-color: #8f8879;
  }

  textarea {
    min-height: 150px;
    resize: vertical;
    font-family: "Cascadia Code", "SFMono-Regular", Consolas, monospace;
    font-size: 12px;
    line-height: 1.55;
  }
</style>
