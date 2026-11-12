// Pointer-driven reordering for the note list and the tab strip. HTML5 drag-and-drop is not
// reliable inside the Tauri webview (the native file-drop handler takes the drag), so the
// pointer is followed directly. A press only becomes a drag after a few pixels, so clicks stay clicks.

/** Insertion index (0..mids.length) for a pointer coordinate, given item midpoints in display order. */
export function insertionIndex(mids: number[], at: number) {
  let index = 0;
  while (index < mids.length && at > mids[index]) index++;
  return index;
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

export type SortDrag = { id: string; index: number | null };
type Options = {
  axis: 'x' | 'y';
  /** Called whenever the dragged item or its drop slot changes; null when the drag ends. */
  onDrag: (drag: SortDrag | null) => void;
  /** `index` is null when released outside the container; `target` is the element under the pointer. */
  onDrop: (id: string, index: number | null, target: Element | null) => void;
};

const THRESHOLD = 5;
const EDGE = 28;

/** Svelte action for a container whose direct sortable children carry `data-sort-id`. */
export function sortable(node: HTMLElement, options: Options) {
  let opts = options;
  let press: { id: string; x: number; y: number; pointer: number } | null = null;
  let drag: SortDrag | null = null;
  let last = { x: 0, y: 0 };
  let frame = 0;

  const items = () => Array.from(node.querySelectorAll<HTMLElement>(':scope > [data-sort-id]'));
  function slot(x: number, y: number) {
    const box = node.getBoundingClientRect();
    // Outside the container (with a little slack) there is no slot: the drop may go elsewhere.
    if (x < box.left - 24 || x > box.right + 24 || y < box.top - 24 || y > box.bottom + 24) return null;
    const mids = items().map(el => { const r = el.getBoundingClientRect(); return opts.axis === 'y' ? r.top + r.height / 2 : r.left + r.width / 2; });
    return insertionIndex(mids, opts.axis === 'y' ? y : x);
  }
  function update(x: number, y: number) {
    if (!drag) return;
    const index = slot(x, y);
    if (index !== drag.index) { drag = { id: drag.id, index }; opts.onDrag(drag); }
  }
  // Long lists scroll while the pointer rests near their top or bottom edge.
  function scroll() {
    frame = 0;
    if (!drag || opts.axis !== 'y' || node.scrollHeight <= node.clientHeight) return;
    const box = node.getBoundingClientRect();
    const step = last.y < box.top + EDGE ? -8 : last.y > box.bottom - EDGE ? 8 : 0;
    if (!step || last.x < box.left || last.x > box.right) return;
    node.scrollTop += step; update(last.x, last.y);
    frame = requestAnimationFrame(scroll);
  }
  function down(event: PointerEvent) {
    if (event.button !== 0 || drag) return;
    const item = (event.target as Element).closest<HTMLElement>('[data-sort-id]');
    if (!item || item.parentElement !== node) return;
    press = { id: item.dataset.sortId!, x: event.clientX, y: event.clientY, pointer: event.pointerId };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('keydown', key, true);
  }
  function move(event: PointerEvent) {
    if (!press || event.pointerId !== press.pointer) return;
    last = { x: event.clientX, y: event.clientY };
    if (!drag) {
      if (Math.hypot(event.clientX - press.x, event.clientY - press.y) < THRESHOLD) return;
      drag = { id: press.id, index: null };
      document.documentElement.dataset.sorting = '';
      opts.onDrag(drag);
    }
    event.preventDefault();
    update(event.clientX, event.clientY);
    if (!frame) frame = requestAnimationFrame(scroll);
  }
  function finish() {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', cancel);
    window.removeEventListener('keydown', key, true);
    cancelAnimationFrame(frame); frame = 0;
    delete document.documentElement.dataset.sorting;
    const was = drag;
    press = null; drag = null;
    if (was) {
      opts.onDrag(null);
      // The release after a drag is not a click on the row or tab underneath.
      const swallow = (e: Event) => { e.stopPropagation(); e.preventDefault(); };
      window.addEventListener('click', swallow, { capture: true, once: true });
      setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0);
    }
    return was;
  }
  function up(event: PointerEvent) {
    if (!press || event.pointerId !== press.pointer) return;
    const was = finish();
    if (was) opts.onDrop(was.id, slot(event.clientX, event.clientY), document.elementFromPoint(event.clientX, event.clientY));
  }
  function cancel() { finish(); }
  function key(event: KeyboardEvent) {
    if (event.key === 'Escape' && drag) { event.preventDefault(); event.stopPropagation(); finish(); }
  }
  node.addEventListener('pointerdown', down);
  return {
    update(next: Options) { opts = next; },
    destroy() { finish(); node.removeEventListener('pointerdown', down); },
  };
}
