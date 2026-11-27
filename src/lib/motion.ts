import type { TransitionConfig } from "svelte/transition";
import type { AnimationConfig, FlipParams } from "svelte/animate";
import { flip } from "svelte/animate";
import { cubicOut } from "svelte/easing";

/** The app's "reduce motion" setting or the system preference. */
export function motionReduced() {
  if (typeof window === "undefined") return false;
  return document.documentElement.dataset.motion === "reduce" || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
/** Shared durations (ms), mirrored by --motion-fast / --motion in theme.css. */
export const MOTION_FAST = 140, MOTION = 220;

/** Menus and popovers settle in like a pane of glass: a short drop and grow, then rest. */
export function reveal(_node: Element): TransitionConfig {
  return { duration: motionReduced() ? 0 : 180, easing: cubicOut,
    css: (t) => `opacity: ${Math.min(1, t * 1.6)}; transform: translateY(${(1 - t) * -4}px) scale(${0.96 + t * 0.04})` };
}

/** Full-pane overlays (Settings, Stats): symmetric in and out scale + fade. */
export function overlay(_node: Element): TransitionConfig {
  return { duration: motionReduced() ? 0 : 200, easing: cubicOut,
    css: (t) => `opacity: ${t}; transform: translateY(${(1 - t) * 5}px) scale(${0.988 + t * 0.012})` };
}

/** Symmetric backdrop fade for modal scrims. */
export function backdropFade(_node: Element): TransitionConfig {
  return { duration: motionReduced() ? 0 : MOTION_FAST, easing: cubicOut, css: (t) => `opacity: ${t}` };
}

/** List and tab reordering: one duration and curve everywhere, none when motion is reduced.
 * A finished drag (sortable.ts) has already slid every item into place, so it is not replayed. */
export function shift(node: Element, rects: { from: DOMRect; to: DOMRect }, params: FlipParams = {}): AnimationConfig {
  const settled = document.documentElement.dataset.sortSettle !== undefined;
  return flip(node, rects, { duration: motionReduced() || settled ? 0 : MOTION, easing: cubicOut, ...params });
}

export type PopupOptions = (() => void) | { close: () => void; trigger?: HTMLElement | null };

/** Keep compact popovers and menus keyboard accessible without adding a UI dependency. */
export function popup(node: HTMLElement, options: PopupOptions) {
  let close = typeof options === "function" ? options : options.close;
  let explicitTrigger = typeof options === "function" ? undefined : options.trigger;
  const previous = document.activeElement as HTMLElement | null;
  const returnTarget = explicitTrigger
    ?? (previous?.closest('[role="menu"]')
      ? document.querySelector<HTMLElement>("[data-menu-trigger]")
      : previous);
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
    const target = event.target instanceof Node ? event.target : null;
    if (!target) return;
    const hitTrigger = explicitTrigger
      ? explicitTrigger.contains(target)
      : (node.getAttribute("role") === "menu" && target instanceof Element && Boolean(target.closest("[data-menu-trigger]")));
    if (!node.contains(target) && !hitTrigger) {
      returnFocus = false;
      close();
    }
  }
  node.addEventListener("keydown", keydown);
  document.addEventListener("pointerdown", outside, true);
  return {
    update(next: PopupOptions) {
      close = typeof next === "function" ? next : next.close;
      explicitTrigger = typeof next === "function" ? undefined : next.trigger;
    },
    destroy() {
      cancelAnimationFrame(frame);
      node.removeEventListener("keydown", keydown);
      document.removeEventListener("pointerdown", outside, true);
      if (returnFocus && (node.contains(document.activeElement) || document.activeElement === document.body)) returnTarget?.focus();
    },
  };
}
