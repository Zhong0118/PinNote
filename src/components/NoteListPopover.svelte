<script lang="ts">
  import { popup, reveal } from "$lib/motion";
  import { Eye, EyeOff, List, Trash2, X } from "lucide-svelte";

  export type NoteListItem = {
    id: string;
    title: string;
    visible: boolean;
    current: boolean;
    updatedAt: number;
  };

  type Props = {
    open: boolean;
    items: NoteListItem[];
    onShow: (id: string) => void;
    onHide: (id: string) => void;
    onDelete: (id: string) => void;
    onRefresh: () => void;
    onClose: () => void;
  };

  let { open, items, onShow, onHide, onDelete, onRefresh, onClose }: Props = $props();

  $effect(() => {
    if (open) onRefresh();
  });

</script>


{#if open}
  <div class="note-list-popover" use:popup={onClose} transition:reveal aria-label="便签列表" role="dialog" tabindex="-1">
    <header>
      <div class="title">
        <List size={15} />
        <h2>便签</h2>
      </div>
      <button class="icon-btn" type="button" title="关闭" aria-label="关闭" onclick={onClose}>
        <X size={16} />
      </button>
    </header>

    <div class="note-list">
      {#if items.length === 0}
        <p class="empty">暂无便签</p>
      {:else}
        {#each items as item (item.id)}
          <article class:current={item.current} class="note-item" transition:reveal>
            <button class="note-main" type="button" title={item.title} onclick={() => onShow(item.id)}>
              <span>{item.title || "未命名便签"}</span>
              {#if item.current}
                <small>当前</small>
              {/if}
            </button>
            <button
              class="icon-btn"
              type="button"
              title={item.visible ? "隐藏便签" : "显示便签"}
              aria-label={item.visible ? "隐藏便签" : "显示便签"}
              onclick={() => (item.visible ? onHide(item.id) : onShow(item.id))}
            >
              {#if item.visible}
                <Eye size={15} />
              {:else}
                <EyeOff size={15} />
              {/if}
            </button>
            <button
              class="icon-btn danger"
              type="button"
              title="删除便签"
              aria-label="删除便签"
              onclick={() => onDelete(item.id)}
            >
              <Trash2 size={15} />
            </button>
          </article>
        {/each}
      {/if}
    </div>

    <footer>
      <small>{items.length} 张便签</small>
    </footer>
  </div>
{/if}

<style>
  .note-list-popover {
    position: fixed;
    top: 43px;
    right: 10px;
    z-index: 110;
    width: min(260px, calc(100vw - 16px));
    max-height: min(390px, calc(100vh - 51px));
    display: grid;
    grid-template-rows: auto minmax(0, 1fr) auto;
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
    justify-content: space-between;
    gap: 8px;
    padding: 6px 8px;
    background: #fff;
  }

  header {
    border-bottom: 1px solid #ededee;
  }

  footer {
    border-top: 1px solid #ededee;
  }

  .title {
    display: inline-flex;
    min-width: 0;
    align-items: center;
    gap: 6px;
    color: #171717;
  }

  h2 {
    margin: 0;
    font-size: 13px;
    line-height: 1.25;
    font-weight: 750;
  }

  small,
  .empty {
    color: #737373;
    font-size: 12px;
  }

  button {
    font: inherit;
    cursor: pointer;
    transition: background 140ms, color 140ms, transform 140ms;
  }

  .note-list {
    min-height: 0;
    overflow: auto;
    padding: 3px;
  }

  .empty {
    margin: 12px;
  }

  .note-item {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto auto;
    align-items: center;
    gap: 2px;
    border-radius: 6px;
  }

  .note-item:hover,
  .note-item.current {
    background: #f5f5f5;
  }

  .note-main {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 8px;
    min-width: 0;
    min-height: 30px;
    border: 0;
    border-radius: 6px;
    padding: 5px 7px;
    text-align: left;
    color: #171717;
    background: transparent;
  }

  .note-main:hover {
    background: #eff6ff;
  }

  .note-main span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12px;
    line-height: 1.25;
    font-weight: 550;
  }

  .note-main small {
    color: #2563eb;
    font-weight: 650;
  }

  .icon-btn {
    display: grid;
    place-items: center;
    width: 27px;
    height: 27px;
    border: 1px solid transparent;
    border-radius: 5px;
    padding: 0;
    color: #737373;
    background: transparent;
  }

  .icon-btn:hover {
    border-color: #e5e7eb;
    color: #222;
    background: #f5f5f5;
  }

  .icon-btn.danger:hover {
    border-color: rgba(168, 67, 50, 0.26);
    color: #dc2626;
    background: rgba(168, 67, 50, 0.08);
  }

  button:hover { transform: scale(1.01); }
  button:active { transform: scale(0.97); }
  button:focus-visible { outline: 2px solid #2563eb; outline-offset: -2px; }
  @media (prefers-reduced-motion: reduce) { button { transition: none; } }

  @media (max-height: 360px) {
    .note-list-popover {
      top: 43px;
      right: 6px;
      width: min(240px, calc(100vw - 12px));
      max-height: calc(100vh - 49px);
    }

    header,
    footer {
      padding: 5px 6px;
    }

    .note-main {
      min-height: 27px;
      padding: 4px 6px;
    }

    .icon-btn {
      width: 24px;
      height: 24px;
    }
  }
</style>
