<script lang="ts">
  type Props = {
    value: string;
    onChange: (value: string) => void;
  };

  let { value, onChange }: Props = $props();
  let textarea = $state<HTMLTextAreaElement>();
  let history: string[] = [];
  let historyIndex = 0;
  let lastKnownValue = "";
  let lastInputAt = 0;
  let lastInputKind = "";
  let lastInputLength = 0;
  let canMergeInput = false;
  let initializedHistory = false;
  let lastExternalValue = "";

  $effect(() => {
    const current = value;

    if (!initializedHistory) {
      resetHistory(current);
      initializedHistory = true;
      lastExternalValue = current;
      return;
    }

    if (current !== lastExternalValue && current !== lastKnownValue) {
      resetHistory(current);
    }

    lastExternalValue = current;
  });

  function handleKeydown(event: KeyboardEvent) {
    if (!textarea) return;

    const mod = event.metaKey || event.ctrlKey;

    if (mod && event.key.toLowerCase() === "z") {
      event.preventDefault();
      if (event.shiftKey) {
        redo();
      } else {
        undo();
      }
    } else if (mod && event.key.toLowerCase() === "y") {
      event.preventDefault();
      redo();
    } else if (event.key === "Tab") {
      event.preventDefault();
      updateSelection(event.shiftKey ? unindentSelection(value, textarea) : indentSelection(value, textarea));
    } else if (mod && event.key.toLowerCase() === "b") {
      event.preventDefault();
      wrapSelection("**");
    } else if (mod && event.key.toLowerCase() === "i") {
      event.preventDefault();
      wrapSelection("*");
    } else if (event.key === "Enter") {
      const insertion = nextListMarker(value, textarea.selectionStart);
      if (!insertion) return;
      event.preventDefault();
      insertText(`\n${insertion}`);
    }
  }

  function handleInput(event: Event) {
    const next = event.currentTarget instanceof HTMLTextAreaElement ? event.currentTarget.value : value;
    const inputEvent = event instanceof InputEvent ? event : undefined;
    const merge = shouldMergeInput(next, inputEvent?.inputType ?? "input");
    commit(next, {
      merge,
      inputChange: true,
    });
  }

  function wrapSelection(mark: string) {
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = value.slice(start, end);
    const next = `${value.slice(0, start)}${mark}${selected}${mark}${value.slice(end)}`;
    commit(next, { merge: false, inputChange: false });
    queueSelection(start + mark.length, end + mark.length);
  }

  function insertText(text: string) {
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    commit(`${value.slice(0, start)}${text}${value.slice(end)}`, {
      merge: false,
      inputChange: false,
    });
    queueSelection(start + text.length, start + text.length);
  }

  function updateSelection(result: EditResult) {
    commit(result.value, { merge: false, inputChange: false });
    queueSelection(result.start, result.end);
  }

  function commit(next: string, options: { merge: boolean; inputChange: boolean }) {
    lastKnownValue = next;
    if (next === history[historyIndex]) return;

    if (options.merge && canMergeInput && history.length > 1) {
      history = [...history.slice(0, historyIndex), next, ...history.slice(historyIndex + 1)];
    } else {
      history = [...history.slice(0, historyIndex + 1), next].slice(-100);
      historyIndex = history.length - 1;
    }

    canMergeInput = options.inputChange;
    lastExternalValue = next;
    onChange(next);
  }

  function resetHistory(next: string) {
    history = [next];
    historyIndex = 0;
    lastKnownValue = next;
    lastExternalValue = next;
    lastInputAt = 0;
    lastInputKind = "";
    lastInputLength = next.length;
    canMergeInput = false;
  }

  function shouldMergeInput(next: string, inputType: string) {
    const now = Date.now();
    const lengthDelta = Math.abs(next.length - lastInputLength);
    const sameInputKind = inputType === lastInputKind;
    const merge =
      canMergeInput &&
      sameInputKind &&
      now - lastInputAt < 900 &&
      (inputType.startsWith("insertText") ||
        inputType === "insertCompositionText" ||
        inputType === "deleteContentBackward" ||
        inputType === "deleteContentForward") &&
      lengthDelta <= 6;

    lastInputAt = now;
    lastInputKind = inputType;
    lastInputLength = next.length;
    return merge;
  }

  function undo() {
    if (historyIndex <= 0) return;
    historyIndex -= 1;
    applyHistoryValue(history[historyIndex]);
  }

  function redo() {
    if (historyIndex >= history.length - 1) return;
    historyIndex += 1;
    applyHistoryValue(history[historyIndex]);
  }

  function applyHistoryValue(next: string) {
    lastKnownValue = next;
    lastExternalValue = next;
    lastInputAt = 0;
    canMergeInput = false;
    onChange(next);
    queueSelection(next.length, next.length);
  }

  function queueSelection(start: number, end: number) {
    requestAnimationFrame(() => {
      textarea?.setSelectionRange(start, end);
    });
  }

  type EditResult = {
    value: string;
    start: number;
    end: number;
  };

  function indentSelection(text: string, input: HTMLTextAreaElement): EditResult {
    const { lineStart, lineEnd, selectedLines } = selectedLineRange(text, input);
    const replacement = selectedLines.map((line) => `  ${line}`).join("\n");

    return {
      value: text.slice(0, lineStart) + replacement + text.slice(lineEnd),
      start: input.selectionStart + 2,
      end: input.selectionEnd + selectedLines.length * 2,
    };
  }

  function unindentSelection(text: string, input: HTMLTextAreaElement): EditResult {
    const { lineStart, lineEnd, selectedLines } = selectedLineRange(text, input);
    let removedBeforeStart = 0;
    let removedTotal = 0;
    let offset = 0;

    const replacement = selectedLines
      .map((line) => {
        const removeCount = line.startsWith("  ") ? 2 : line.startsWith("\t") ? 1 : line.startsWith(" ") ? 1 : 0;
        if (lineStart + offset < input.selectionStart) removedBeforeStart += removeCount;
        removedTotal += removeCount;
        offset += line.length + 1;
        return line.slice(removeCount);
      })
      .join("\n");

    return {
      value: text.slice(0, lineStart) + replacement + text.slice(lineEnd),
      start: Math.max(lineStart, input.selectionStart - removedBeforeStart),
      end: Math.max(lineStart, input.selectionEnd - removedTotal),
    };
  }

  function selectedLineRange(text: string, input: HTMLTextAreaElement) {
    const lineStart = text.lastIndexOf("\n", input.selectionStart - 1) + 1;
    const lineEndIndex = text.indexOf("\n", input.selectionEnd);
    const lineEnd = lineEndIndex === -1 ? text.length : lineEndIndex;
    const selectedLines = text.slice(lineStart, lineEnd).split("\n");

    return { lineStart, lineEnd, selectedLines };
  }

  function nextListMarker(text: string, cursor: number) {
    const lineStart = text.lastIndexOf("\n", cursor - 1) + 1;
    const line = text.slice(lineStart, cursor);
    const unordered = line.match(/^(\s*)([-*+])\s+(.*)$/);
    const ordered = line.match(/^(\s*)(\d+)\.\s+(.*)$/);
    const task = line.match(/^(\s*)-\s+\[( |x|X)\]\s+(.*)$/);

    if (task) return task[3] ? `${task[1]}- [ ] ` : "";
    if (unordered) return unordered[3] ? `${unordered[1]}${unordered[2]} ` : "";
    if (ordered) return ordered[3] ? `${ordered[1]}${Number(ordered[2]) + 1}. ` : "";
    return "";
  }
</script>

<textarea
  bind:this={textarea}
  class="source-editor"
  aria-label="Markdown 源码编辑"
  value={value}
  oninput={handleInput}
  onkeydown={handleKeydown}
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
