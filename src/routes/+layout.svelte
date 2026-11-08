<script lang="ts">
  import '$lib/theme.css';
  import { onMount } from 'svelte';
  import { initAppearance } from '$lib/theme';
  let { children } = $props();
  onMount(() => initAppearance());
</script>
{@render children()}
