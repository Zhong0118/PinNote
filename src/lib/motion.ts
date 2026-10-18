import type { TransitionConfig } from "svelte/transition";

export function reveal(_node: Element): TransitionConfig {
  const reduced = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  return { duration: reduced ? 0 : 140, css: (t) => `opacity: ${t}; transform: scale(${0.97 + t * 0.03})` };
}

/** Keep compact popovers keyboard accessible without adding a UI dependency. */
export function popup(node: HTMLElement, close: () => void) {
  const previous = document.activeElement as HTMLElement | null;
  const returnTarget = previous?.closest('[role="menu"]')
    ? document.querySelector<HTMLElement>("[data-menu-trigger]")
    : previous;
  let returnFocus = true;
  const focusable = () => Array.from(node.querySelectorAll<HTMLElement>(
    'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), [tabindex="0"]',
  ));
  const frame = requestAnimationFrame(() => (focusable()[0] ?? node).focus());
  function keydown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (event.key === "Tab") {
      const controls = focusable();
      const current = controls.indexOf(document.activeElement as HTMLElement);
      if (!controls.length) { event.preventDefault(); node.focus(); return; }
      if (event.shiftKey && current <= 0) { event.preventDefault(); controls.at(-1)?.focus(); }
      if (!event.shiftKey && (current === controls.length - 1 || current < 0)) { event.preventDefault(); controls[0]?.focus(); }
    } else if (node.getAttribute("role") === "menu" && ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      const controls = focusable();
      const current = controls.indexOf(document.activeElement as HTMLElement);
      const index = event.key === "Home" ? 0 : event.key === "End" ? controls.length - 1
        : (current + (event.key === "ArrowDown" ? 1 : -1) + controls.length) % controls.length;
      controls[index]?.focus();
    }
  }
  function outside(event: PointerEvent) {
    const trigger = node.getAttribute("role") === "menu" && (event.target as Element).closest("[data-menu-trigger]");
    if (!node.contains(event.target as Node) && !trigger) {
      returnFocus = false;
      close();
    }
  }
  node.addEventListener("keydown", keydown);
  document.addEventListener("pointerdown", outside, true);
  return { destroy() {
    cancelAnimationFrame(frame);
    node.removeEventListener("keydown", keydown);
    document.removeEventListener("pointerdown", outside, true);
    if (returnFocus && (node.contains(document.activeElement) || document.activeElement === document.body)) returnTarget?.focus();
  } };
}
