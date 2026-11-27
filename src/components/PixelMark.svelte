<script lang="ts">
  /** Signature pixel-art SVG marks echoing the 驻墨 InkPin pixel icon. */
  type Props = {
    variant?: 'brand' | 'nib' | 'ink' | 'pin' | 'fold';
    size?: number;
    filled?: boolean;
  };
  let { variant = 'brand', size = 18, filled = false }: Props = $props();
</script>

{#if variant === 'brand'}
  <svg width={size} height={size} viewBox="0 0 16 16" shape-rendering="crispEdges" aria-hidden="true">
    <!-- Cobalt pushpin (top-left) -->
    <rect x="2" y="1" width="3" height="2" fill="var(--accent, #2563eb)" />
    <rect x="1" y="3" width="5" height="1" fill="var(--accent, #2563eb)" />
    <rect x="3" y="4" width="1" height="1" fill="currentColor" opacity=".82" />
    <!-- Pixel folded sticky note outline -->
    <rect x="2" y="5" width="1" height="9" fill="currentColor" opacity=".82" />
    <rect x="2" y="13" width="9" height="1" fill="currentColor" opacity=".82" />
    <rect x="6" y="4" width="6" height="1" fill="currentColor" opacity=".82" />
    <rect x="13" y="6" width="1" height="5" fill="currentColor" opacity=".82" />
    <!-- Corner fold -->
    <rect x="10" y="10" width="4" height="1" fill="currentColor" opacity=".55" />
    <rect x="10" y="11" width="1" height="3" fill="currentColor" opacity=".55" />
    <rect x="12" y="11" width="1" height="1" fill="currentColor" opacity=".55" />
    <rect x="11" y="12" width="1" height="1" fill="currentColor" opacity=".55" />
    <!-- Ink lines -->
    <rect x="4" y="7" width="1" height="1" fill="var(--accent, #2563eb)" />
    <rect x="6" y="7" width="3" height="1" fill="currentColor" opacity=".48" />
    <rect x="4" y="9" width="4" height="1" fill="currentColor" opacity=".48" />
    <!-- Diagonal pixel ink nib -->
    <rect x="12" y="2" width="2" height="2" fill="currentColor" />
    <rect x="11" y="4" width="2" height="2" fill="currentColor" />
    <rect x="10" y="6" width="2" height="2" fill="currentColor" />
    <rect x="9" y="8" width="2" height="2" fill="var(--accent, #2563eb)" />
    <rect x="8" y="10" width="1" height="2" fill="var(--accent, #2563eb)" />
  </svg>
{:else if variant === 'nib'}
  <svg width={size} height={size} viewBox="0 0 16 16" shape-rendering="crispEdges" aria-hidden="true">
    <rect x="11" y="2" width="3" height="2" fill="currentColor" />
    <rect x="10" y="3" width="2" height="2" fill="currentColor" />
    <rect x="8" y="5" width="3" height="2" fill="currentColor" />
    <rect x="7" y="6" width="2" height="3" fill="currentColor" />
    <rect x="5" y="8" width="3" height="2" fill="var(--accent, #2563eb)" />
    <rect x="4" y="10" width="2" height="2" fill="var(--accent, #2563eb)" />
    <rect x="3" y="12" width="1" height="1" fill="var(--accent, #2563eb)" />
    <rect x="2" y="13" width="2" height="2" fill="var(--accent, #2563eb)" opacity=".85" />
    <rect x="6" y="13" width="6" height="1" fill="currentColor" opacity=".32" />
  </svg>
{:else if variant === 'pin'}
  <svg width={size} height={size} viewBox="0 0 16 16" shape-rendering="crispEdges" aria-hidden="true">
    {#if filled}
      <!-- Solid pinned cobalt pushpin -->
      <rect x="6" y="2" width="4" height="2" fill="currentColor" />
      <rect x="5" y="4" width="6" height="2" fill="currentColor" />
      <rect x="3" y="6" width="10" height="2" fill="currentColor" />
      <rect x="7" y="8" width="2" height="5" fill="currentColor" />
      <rect x="7" y="13" width="1" height="1" fill="currentColor" opacity=".7" />
      <!-- Pixel specular glint -->
      <rect x="6" y="3" width="1" height="1" fill="#ffffff" opacity=".8" />
      <rect x="5" y="6" width="2" height="1" fill="#ffffff" opacity=".45" />
    {:else}
      <!-- Hollow unpinned pushpin -->
      <rect x="6" y="2" width="4" height="1" fill="currentColor" />
      <rect x="5" y="3" width="1" height="3" fill="currentColor" />
      <rect x="10" y="3" width="1" height="3" fill="currentColor" />
      <rect x="3" y="6" width="10" height="1" fill="currentColor" />
      <rect x="3" y="7" width="1" height="1" fill="currentColor" />
      <rect x="12" y="7" width="1" height="1" fill="currentColor" />
      <rect x="4" y="8" width="8" height="1" fill="currentColor" />
      <rect x="7" y="9" width="2" height="4" fill="currentColor" />
    {/if}
  </svg>
{:else if variant === 'fold'}
  <!-- Stepped pixel dog-ear fold for the bottom-right corner of a sticky note -->
  <svg width={size} height={size} viewBox="0 0 16 16" shape-rendering="crispEdges" aria-hidden="true">
    <!-- Subtle shadow cast onto the paper behind the fold -->
    <rect x="0" y="2" width="2" height="14" fill="currentColor" opacity=".08" />
    <rect x="2" y="0" width="14" height="2" fill="currentColor" opacity=".08" />
    <!-- Folded paper flap (stepped pixel triangle) -->
    <rect x="2" y="2" width="12" height="2" fill="var(--pin-dot, var(--accent))" opacity=".24" />
    <rect x="2" y="4" width="10" height="2" fill="var(--pin-dot, var(--accent))" opacity=".20" />
    <rect x="2" y="6" width="8" height="2" fill="var(--pin-dot, var(--accent))" opacity=".17" />
    <rect x="2" y="8" width="6" height="2" fill="var(--pin-dot, var(--accent))" opacity=".15" />
    <rect x="2" y="10" width="4" height="2" fill="var(--pin-dot, var(--accent))" opacity=".13" />
    <rect x="2" y="12" width="2" height="2" fill="var(--pin-dot, var(--accent))" opacity=".11" />
    <!-- Crisp pixel crease edge -->
    <rect x="2" y="2" width="12" height="1" fill="var(--pin-border, var(--border))" />
    <rect x="2" y="2" width="1" height="12" fill="var(--pin-border, var(--border))" />
    <rect x="12" y="4" width="2" height="2" fill="var(--pin-border, var(--border))" opacity=".85" />
    <rect x="10" y="6" width="2" height="2" fill="var(--pin-border, var(--border))" opacity=".85" />
    <rect x="8" y="8" width="2" height="2" fill="var(--pin-border, var(--border))" opacity=".85" />
    <rect x="6" y="10" width="2" height="2" fill="var(--pin-border, var(--border))" opacity=".85" />
    <rect x="4" y="12" width="2" height="2" fill="var(--pin-border, var(--border))" opacity=".85" />
  </svg>
{:else}
  <svg width={size} height={size} viewBox="0 0 16 16" shape-rendering="crispEdges" aria-hidden="true">
    <rect x="7" y="2" width="2" height="2" fill="var(--accent, #2563eb)" />
    <rect x="6" y="4" width="4" height="2" fill="var(--accent, #2563eb)" />
    <rect x="5" y="6" width="6" height="4" fill="var(--accent, #2563eb)" />
    <rect x="6" y="10" width="4" height="2" fill="var(--accent, #2563eb)" />
    <rect x="7" y="12" width="2" height="1" fill="var(--accent, #2563eb)" />
    <rect x="6" y="6" width="1" height="2" fill="#ffffff" opacity=".75" />
  </svg>
{/if}
