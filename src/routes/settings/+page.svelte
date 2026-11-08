<script lang="ts">
  // Old settings windows (`settings`, `settings-{noteId}`) are retired: forward to the
  // center's settings view and close this window.
  import { onMount } from 'svelte';
  import { getCurrentWindow } from '@tauri-apps/api/window';
  import { openSettingsWindow } from '$lib/settingsWindow';
  onMount(() => { void openSettingsWindow().finally(() => getCurrentWindow().destroy().catch(() => undefined)); });
</script>
<p style="font:13px -apple-system,sans-serif;color:#737373;padding:16px">设置已移到便签中心…</p>
