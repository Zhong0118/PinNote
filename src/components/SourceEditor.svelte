<script lang="ts">
  type Props = {
    value: string;
    onChange: (value: string) => void;
  };

  let { value, onChange }: Props = $props();
</script>

<textarea
  class="source-editor"
  aria-label="Markdown 源码编辑"
  value={value}
  oninput={(event) => onChange(event.currentTarget.value)}
></textarea>

<style>
  .source-editor {
    width: 100%;
    height: 100%;
    min-height: 0;
    resize: none;
    border: 0;
    outline: 0;
    padding: 18px 22px 30px;
    color: var(--pin-text);
    background: transparent;
    font-family: "Cascadia Code", "SFMono-Regular", Consolas, monospace;
    font-size: 13px;
    line-height: 1.68;
  }
</style>
