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
  let editor: { destroy: () => void } | undefined;

  onMount(() => {
    void setup();

    return () => {
      editor?.destroy();
    };
  });

  async function setup() {
    if (!browser || !root) return;

    try {
      const [{ Editor, rootCtx, defaultValueCtx }, { gfm }, { listener, listenerCtx }] =
        await Promise.all([
          import("@milkdown/core"),
          import("@milkdown/preset-gfm"),
          import("@milkdown/plugin-listener"),
        ]);

      editor = await Editor.make()
        .config((ctx: any) => {
          ctx.set(rootCtx, root);
          ctx.set(defaultValueCtx, value);
          ctx.get(listenerCtx).markdownUpdated((_ctx: unknown, markdown: string) => {
            onChange(markdown);
          });
        })
        .use(gfm)
        .use(listener)
        .create();
    } catch {
      failed = true;
    }
  }
</script>

{#if failed}
  <SourceEditor {value} {onChange} />
{:else}
  <div class="milkdown-host" bind:this={root}></div>
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

  .milkdown-host :global(li[data-checked]),
  .milkdown-host :global(li.task-list-item) {
    list-style: none;
    margin-left: -1.2rem;
  }

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
