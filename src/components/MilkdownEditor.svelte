<script lang="ts">
  import { browser } from "$app/environment";
  import { onMount } from "svelte";
  import SourceEditor from "./SourceEditor.svelte";

  type Props = {
    value: string;
    onChange: (value: string) => void;
  };

  let { value, onChange }: Props = $props();
  let root = $state<HTMLDivElement>();
  let failed = $state(false);
  let editorInstance: any;
  let editorViewCtxRef: any;

  onMount(() => {
    void setup();

    return () => {
      editorInstance?.destroy();
    };
  });

  function handleTaskClick(event: MouseEvent) {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const li = target.closest('li[data-item-type="task"]') as HTMLElement | null;
    if (!li) return;

    // Only toggle when clicking in the checkbox zone (left 28px)
    const rect = li.getBoundingClientRect();
    if (event.clientX > rect.left + 28) return;

    if (!editorInstance || !editorViewCtxRef) return;
    let view: any;
    try {
      view = editorInstance.action((ctx: any) => ctx.get(editorViewCtxRef));
    } catch {
      return;
    }
    if (!view?.state) return;

    // Walk the document to find the matching list_item node by DOM index
    const liElements = root?.querySelectorAll('li[data-item-type="task"]');
    if (!liElements) return;
    const liIndex = Array.from(liElements).indexOf(li);
    if (liIndex < 0) return;

    let count = 0;
    let found = false;
    view.state.doc.descendants((node: any, pos: number) => {
      if (found) return false;
      if (node.type.name === "list_item" && node.attrs.checked != null) {
        if (count === liIndex) {
          const tr = view.state.tr.setNodeMarkup(pos, undefined, {
            ...node.attrs,
            checked: !node.attrs.checked,
          });
          view.dispatch(tr);
          found = true;
          return false;
        }
        count++;
      }
    });
  }

  async function setup() {
    if (!browser || !root) return;

    try {
      const [
        { Editor, rootCtx, defaultValueCtx, editorViewCtx },
        { commonmark },
        { gfm },
        { listener, listenerCtx },
      ] = await Promise.all([
        import("@milkdown/kit/core"),
        import("@milkdown/kit/preset/commonmark"),
        import("@milkdown/kit/preset/gfm"),
        import("@milkdown/kit/plugin/listener"),
      ]);

      editorViewCtxRef = editorViewCtx;

      editorInstance = await Editor.make()
        .config((ctx: any) => {
          ctx.set(rootCtx, root);
          ctx.set(defaultValueCtx, value);
          ctx.get(listenerCtx).markdownUpdated((_ctx: unknown, markdown: string) => {
            onChange(markdown);
          });
        })
        .use(commonmark)
        .use(gfm)
        .use(listener)
        .create();
    } catch (e) {
      console.error("Milkdown setup failed:", e);
      failed = true;
    }
  }
</script>

{#if failed}
  <SourceEditor {value} {onChange} />
{:else}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions, a11y_no_noninteractive_element_interactions -->
  <div class="milkdown-host" bind:this={root} role="application" onclick={handleTaskClick}></div>
{/if}

<style>
  .milkdown-host {
    height: 100%;
    min-height: 0;
    overflow: auto;
    padding: 18px 22px 34px;
    scrollbar-gutter: stable;
  }

  .milkdown-host :global(.milkdown) {
    min-height: 100%;
  }

  .milkdown-host :global(.editor) {
    min-height: calc(100vh - 112px);
    outline: 0;
    color: var(--pin-text);
    caret-color: var(--pin-accent-strong);
    font-size: 15px;
    line-height: 1.68;
  }

  .milkdown-host :global(h1) {
    margin: 0.15em 0 0.55em;
    color: var(--pin-heading);
    font-size: 1.55rem;
    line-height: 1.2;
  }

  .milkdown-host :global(h2) {
    margin: 1em 0 0.45em;
    color: var(--pin-heading);
    font-size: 1.18rem;
  }

  .milkdown-host :global(p) {
    margin: 0.55em 0;
  }

  .milkdown-host :global(ul),
  .milkdown-host :global(ol) {
    padding-left: 1.25rem;
  }

  .milkdown-host :global(input[type="checkbox"]) {
    width: 15px;
    height: 15px;
    margin: 0 7px 0 0;
    vertical-align: -2px;
    accent-color: var(--pin-accent);
  }

  .milkdown-host :global(li[data-item-type="task"]),
  .milkdown-host :global(li[data-checked]),
  .milkdown-host :global(li.task-list-item) {
    list-style: none;
    margin-left: -1.2rem;
    position: relative;
    padding-left: 1.5rem;
  }

  .milkdown-host :global(li[data-item-type="task"])::before {
    content: "";
    position: absolute;
    left: 0;
    top: 0.32em;
    width: 15px;
    height: 15px;
    border: 2px solid var(--pin-accent);
    border-radius: 3px;
    cursor: pointer;
    background: transparent;
  }

  .milkdown-host :global(li[data-item-type="task"][data-checked="true"])::before {
    background: var(--pin-accent);
    border-color: var(--pin-accent);
    /* Checkmark via background image */
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath fill='white' d='M6.5 11.5L3 8l1-1 2.5 2.5L12 4l1 1z'/%3E%3C/svg%3E");
    background-size: 13px;
    background-position: center;
    background-repeat: no-repeat;
  }

  .milkdown-host :global(li[data-item-type="task"][data-checked="true"]),
  .milkdown-host :global(li[data-checked="true"]) {
    color: color-mix(in srgb, var(--pin-text), transparent 38%);
    text-decoration: line-through;
  }

  .milkdown-host :global(blockquote) {
    margin: 0.85em 0;
    border-left: 3px solid var(--pin-accent);
    padding: 0.2rem 0 0.2rem 0.75rem;
    color: color-mix(in srgb, var(--pin-text), transparent 24%);
    background: color-mix(in srgb, var(--pin-accent), transparent 91%);
  }

  .milkdown-host :global(code) {
    border-radius: 5px;
    padding: 0.08rem 0.28rem;
    color: var(--pin-accent-strong);
    background: rgba(32, 33, 36, 0.08);
    font-family: "Cascadia Code", "SFMono-Regular", Consolas, monospace;
    font-size: 0.9em;
  }

  .milkdown-host :global(pre) {
    overflow: auto;
    border-radius: 8px;
    padding: 0.85rem;
    background: rgba(32, 33, 36, 0.08);
  }
</style>
