<script lang="ts">
  import '$lib/theme.css';
  import { onMount } from 'svelte';
  import { initAppearance } from '$lib/theme';
  let { children } = $props();
  onMount(() => {
    const stop = initAppearance();
    // Focus rings only after real keyboard use. A native window that gains focus makes WebKit
    // focus its first control as if tabbed to, which would ring every capsule and title bar.
    const root = document.documentElement;
    const key = (e: KeyboardEvent) => { if (!e.metaKey && !e.ctrlKey) root.dataset.input = 'keyboard'; };
    const pointer = () => { root.dataset.input = 'pointer'; };
    addEventListener('keydown', key, true); addEventListener('pointerdown', pointer, true);
    return () => { stop?.(); removeEventListener('keydown', key, true); removeEventListener('pointerdown', pointer, true); };
  });
</script>
{@render children()}
