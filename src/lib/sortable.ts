// Pointer-driven reordering for the note list and the tab strip. HTML5 drag-and-drop is not
// reliable inside the Tauri webview (the native file-drop handler takes the drag), so the
// pointer is followed directly.
//
// A press lifts the item after a few pixels of movement or a short hold. A floating copy then
// follows the pointer, the item's own place stays as a gap, and the other items slide to open
// a gap where it would land. On release the copy glides into its new place.

import { motionReduced, MOTION } from './motion';

/** Final position (0..mids.length-1) of the dragged item `from`, given layout midpoints of all
 * items in display order and the dragged item's centre `at`: the number of other items above it. */
export function targetIndex(mids: number[], from: number, at: number) {
  let index = 0;
  for (let i = 0; i < mids.length; i++) if (i !== from && mids[i] < at) index++;
  return index;
}

/** How far item `i` slides while `from` hovers at `target`: neighbours in between make room. */
export function slideFor(i: number, from: number, target: number, step: number) {
  if (from < i && i <= target) return -step;
  if (target <= i && i < from) return step;
  return 0;
}

/** Move `id` to insertion `index` of `shown` (a display-ordered subset of `order`, `id` included).
 * Items outside `shown` (other filters) keep their places in `order`. */
export function moveAmong(order: string[], shown: string[], id: string, index: number): string[] {
  const from = shown.indexOf(id);
  if (from < 0 || index === from || index === from + 1) return order;
  const rest = order.filter(x => x !== id);
  const before = shown[index];
  const at = before !== undefined ? rest.indexOf(before) : rest.indexOf(shown.filter(x => x !== id).at(-1)!) + 1;
  if (at < 0) return order;
  rest.splice(at, 0, id);
  return rest;
}

/** Display order: notes without a manual place first (input order, newest edit first), then the
 * user's arrangement. `order` entries that no longer exist are ignored. */
export function arrange<T extends { id: string }>(items: T[], order: string[]): T[] {
  const place = new Map(order.map((id, i) => [id, i]));
  const loose = items.filter(n => !place.has(n.id));
  const placed = items.filter(n => place.has(n.id)).sort((a, b) => place.get(a.id)! - place.get(b.id)!);
  return [...loose, ...placed];
}

/** `index` is the insertion slot (0..n, the dragged item's own slots `from`/`from+1` mean "no
 * move"), or null while the pointer is outside the container. */
export type SortDrag = { id: string; index: number | null };
type Options = {
  axis: 'x' | 'y';
  /** Called when a drag starts, when its slot changes, and with null when it ends. */
  onDrag?: (drag: SortDrag | null) => void;
  /** Called on release after a real move; `target` is the element under the pointer. */
  onDrop: (id: string, index: number | null, target: Element | null) => void;
};

const THRESHOLD = 5;
const HOLD = 300;
const EDGE = 28;
const SLACK = 24;
const EASE = 'cubic-bezier(.2,.8,.2,1)';

type Drag = {
  id: string;
  el: HTMLElement;
  ghost: HTMLElement;
  items: HTMLElement[];
  from: number;
  /** Item midpoints along the axis in the container's scroll coordinates, taken at lift. */
  mids: number[];
  /** Distance an item slides to make room: the dragged item's size plus the gap. */
  step: number;
  origin: DOMRect;
  target: number;
  index: number | null;
  slides: number[];
  moved: boolean;
};

/** Svelte action for a container whose direct sortable children carry `data-sort-id`. */
export function sortable(node: HTMLElement, options: Options) {
  let opts = options;
  let press: { el: HTMLElement; id: string; x: number; y: number; pointer: number; timer: number } | null = null;
  let drag: Drag | null = null;
  let last = { x: 0, y: 0 };
  let frame = 0;
  const y = () => opts.axis === 'y';

  const items = () => Array.from(node.querySelectorAll<HTMLElement>(':scope > [data-sort-id]'));
  const scrollOffset = () => (y() ? node.scrollTop : node.scrollLeft);
  const boxStart = () => { const b = node.getBoundingClientRect(); return y() ? b.top : b.left; };

  function lift() {
    if (!press || drag) return;
    clearTimeout(press.timer);
    const list = items();
    const from = list.indexOf(press.el);
    if (from < 0) return;
    const rects = list.map(el => el.getBoundingClientRect());
    const start = boxStart(), offset = scrollOffset();
    const mids = rects.map(r => (y() ? r.top + r.height / 2 : r.left + r.width / 2) - start + offset);
    const origin = rects[from];
    const gap = list.length > 1 ? Math.max(0, y() ? rects[1].top - rects[0].bottom : rects[1].left - rects[0].right) : 0;

    // The copy lives on <body> so it can leave the scrolling list (onto the tab bar or 放到桌面).
    const ghost = press.el.cloneNode(true) as HTMLElement;
    const look = getComputedStyle(press.el);
    ghost.removeAttribute('data-sort-id');
    ghost.setAttribute('aria-hidden', 'true');
    ghost.classList.add('sort-ghost');
    // Placement is inline so the item's own (more specific) component styles cannot override it.
    Object.assign(ghost.style, {
      position: 'fixed', zIndex: '1000', margin: '0', pointerEvents: 'none', boxSizing: 'border-box',
      left: `${origin.left}px`, top: `${origin.top}px`, width: `${origin.width}px`, height: `${origin.height}px`,
      font: look.font, color: look.color, letterSpacing: look.letterSpacing,
    });
    // A transparent item (plain list row) gets the raised surface so it reads as lifted.
    if (/rgba\(.*,\s*0\)$|transparent/.test(look.backgroundColor)) ghost.style.background = 'var(--surface-raised)';
    document.body.append(ghost);
    requestAnimationFrame(() => ghost.classList.add('lifted'));

    press.el.style.visibility = 'hidden';
    const motion = motionReduced() ? 'none' : `transform ${MOTION}ms ${EASE}`;
    for (const el of list) if (el !== press.el) el.style.transition = motion;
    document.documentElement.dataset.sorting = '';

    drag = {
      id: press.id, el: press.el, ghost, items: list, from, mids, origin,
      step: (y() ? origin.height : origin.width) + gap,
      target: from, index: from, slides: list.map(() => 0), moved: false,
    };
    opts.onDrag?.({ id: drag.id, index: drag.index });
  }

  function place(x: number, py: number) {
    if (!drag || !press) return;
    const dx = x - press.x, dy = py - press.y;
    drag.ghost.style.transform = `translate(${dx}px, ${dy}px)`;
    const box = node.getBoundingClientRect();
    const outside = x < box.left - SLACK || x > box.right + SLACK || py < box.top - SLACK || py > box.bottom + SLACK;
    let target = drag.from, index: number | null = null;
    if (!outside) {
      const centre = (y() ? drag.origin.top + drag.origin.height / 2 + dy : drag.origin.left + drag.origin.width / 2 + dx) - boxStart() + scrollOffset();
      target = targetIndex(drag.mids, drag.from, centre);
      index = target <= drag.from ? target : target + 1;
    }
    drag.target = target;
    drag.items.forEach((el, i) => {
      if (i === drag!.from) return;
      const slide = slideFor(i, drag!.from, target, drag!.step);
      if (slide === drag!.slides[i]) return;
      drag!.slides[i] = slide;
      el.style.transform = slide ? (y() ? `translateY(${slide}px)` : `translateX(${slide}px)`) : '';
    });
    if (index !== drag.index) { drag.index = index; opts.onDrag?.({ id: drag.id, index }); }
  }

  // Long lists scroll while the pointer rests near their top or bottom edge.
  function scroll() {
    frame = 0;
    if (!drag || !y() || node.scrollHeight <= node.clientHeight) return;
    const box = node.getBoundingClientRect();
    const step = last.y < box.top + EDGE ? -8 : last.y > box.bottom - EDGE ? 8 : 0;
    if (!step || last.x < box.left || last.x > box.right) return;
    node.scrollTop += step; place(last.x, last.y);
    frame = requestAnimationFrame(scroll);
  }

  function down(event: PointerEvent) {
    if (event.button !== 0 || press || drag) return;
    const el = (event.target as Element).closest<HTMLElement>('[data-sort-id]');
    if (!el || el.parentElement !== node) return;
    press = { el, id: el.dataset.sortId!, x: event.clientX, y: event.clientY, pointer: event.pointerId, timer: window.setTimeout(lift, HOLD) };
    last = { x: event.clientX, y: event.clientY };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('keydown', key, true);
  }
  function move(event: PointerEvent) {
    if (!press || event.pointerId !== press.pointer) return;
    last = { x: event.clientX, y: event.clientY };
    const far = Math.hypot(event.clientX - press.x, event.clientY - press.y) >= THRESHOLD;
    if (!drag && far) lift();
    if (!drag) return;
    if (far) drag.moved = true;
    event.preventDefault();
    place(event.clientX, event.clientY);
    if (!frame) frame = requestAnimationFrame(scroll);
  }
  function unlisten() {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', cancel);
    window.removeEventListener('keydown', key, true);
    cancelAnimationFrame(frame); frame = 0;
    if (press) clearTimeout(press.timer);
    press = null;
  }

  /** End a drag. With `commit`, the owner reorders first; the copy then glides into the slot. */
  function settle(commit: { index: number | null; target: Element | null } | null) {
    const was = drag;
    unlisten();
    drag = null;
    delete document.documentElement.dataset.sorting;
    if (!was) return;
    opts.onDrag?.(null);
    if (was.moved) {
      // The release after a drag is not a click on the row or tab underneath.
      const swallow = (e: Event) => { e.stopPropagation(); e.preventDefault(); };
      window.addEventListener('click', swallow, { capture: true, once: true });
      setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0);
    }
    // Items already stand where the reorder puts them; the list animation must not replay it.
    document.documentElement.dataset.sortSettle = '';
    if (commit && was.moved) opts.onDrop(was.id, commit.index, commit.target);
    // By the next frame the owner's state change has re-rendered the list.
    requestAnimationFrame(() => {
      delete document.documentElement.dataset.sortSettle;
      const now = items();
      const reordered = now.length !== was.items.length || now.some((el, i) => el !== was.items[i]);
      for (const el of was.items) {
        if (reordered) el.style.transition = 'none';
        el.style.transform = '';
      }
      if (reordered) {
        void node.offsetWidth;
        for (const el of was.items) el.style.transition = '';
      } else {
        setTimeout(() => { for (const el of was.items) if (!el.style.transform) el.style.transition = ''; }, MOTION);
      }
      const finish = () => { was.ghost.remove(); was.el.style.visibility = ''; };
      if (motionReduced() || !was.el.isConnected) { finish(); return; }
      const to = was.el.getBoundingClientRect();
      was.ghost.classList.remove('lifted');
      was.ghost.classList.add('settling');
      was.ghost.style.transform = `translate(${to.left - was.origin.left}px, ${to.top - was.origin.top}px)`;
      setTimeout(finish, MOTION);
    });
  }

  function up(event: PointerEvent) {
    if (!press || event.pointerId !== press.pointer) return;
    if (!drag) { unlisten(); return; }
    place(event.clientX, event.clientY);
    const index = drag.index;
    settle({ index, target: document.elementFromPoint(event.clientX, event.clientY) });
  }
  function cancel() { if (drag) settle(null); else unlisten(); }
  function key(event: KeyboardEvent) {
    if (event.key === 'Escape' && drag) { event.preventDefault(); event.stopPropagation(); drag.moved = true; settle(null); }
  }
  node.addEventListener('pointerdown', down);
  return {
    update(next: Options) { opts = next; },
    destroy() {
      const was = drag;
      unlisten(); drag = null;
      delete document.documentElement.dataset.sorting;
      if (was) { was.ghost.remove(); was.el.style.visibility = ''; for (const el of was.items) { el.style.transform = ''; el.style.transition = ''; } }
      node.removeEventListener('pointerdown', down);
    },
  };
}
