// The note center's window form: a normal window that collapses straight to an edge
// handle (or, from the window menu only, a free strip). The hidden window always keeps
// its normal frame, so any outside show (tray, relaunch, shortcut) restores it as is.
import { invoke } from '@tauri-apps/api/core';
import { emitTo } from '@tauri-apps/api/event';
import { getCurrentWindow, availableMonitors, LogicalPosition, LogicalSize, PhysicalPosition } from '@tauri-apps/api/window';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { animateWindow, canAnimateWindow } from './nativeMotion';
import { isMacPlatform } from './settings';
import { displayFor, normalizeBounds, normalizeDisplays, type Bounds, type Display } from './windowGeometry';
import { edgeLayout } from './edgeQueue';
import type { PinNote } from './notesStore';
import { CENTER_WINDOW_MIN, barBounds, detachedBounds, dockAt, dockDisplay, handleBounds, isResize, migrateSession, nearestSide,
  restoreFrame, snapSide, validWindow, LIST_WIDTH, type CenterDock, type CenterMode, type CenterSide, type Range } from './centerLayout';

const STORE = 'pinnote.center';
const mac = isMacPlatform();
type Pointer = { x: number; y: number };
type DockAction = { action: 'expand' | 'new' | 'detach' | 'drag' | 'drop' | 'cancel' | 'moved'; pointer?: Pointer };

export type CenterFormHost = {
  /** Save the open draft before the window changes form. */
  persist: () => Promise<void>;
  notes: () => PinNote[];
  title: () => string;
  status: (text: string) => void;
  edgeSnap: () => boolean;
};

export class CenterForm {
  mode = $state<CenterMode>('window');
  dock = $state<CenterDock>({ display: '', side: 'right', ratio: 0.78 });
  pinned = $state(false);
  /** Shown while a drag would collapse the window into a handle on that side. */
  snapHint = $state<CenterSide | null>(null);
  tabs: string[] = [];
  selected = '';
  order: string[] = [];
  listWidth = LIST_WIDTH.default;
  /** The remembered normal frame (outer, normalized). */
  normal: Bounds | undefined;
  #busy = false;
  #programmaticUntil = 0;
  #tracking = false;
  #rememberTimer: ReturnType<typeof setTimeout> | undefined;
  #dockKind: 'bar' | 'handle' | undefined;
  #detaching: Promise<void> | undefined;
  constructor(private host: CenterFormHost) {}

  // ---- persistence ----
  restore() {
    let raw: unknown;
    try { raw = JSON.parse(localStorage.getItem(STORE) ?? '{}'); } catch { raw = {}; }
    const session = migrateSession(raw);
    this.mode = session.mode; this.dock = session.dock; this.pinned = session.pinned;
    this.normal = session.window; this.tabs = session.tabs; this.selected = session.selected;
    this.order = session.order; this.listWidth = session.listWidth;
    return session;
  }
  save() {
    try {
      localStorage.setItem(STORE, JSON.stringify({ mode: this.mode, dock: this.dock, pinned: this.pinned,
        window: this.normal, tabs: this.tabs, selected: this.selected, order: this.order, listWidth: this.listWidth }));
    } catch { /* storage full: only the remembered layout is lost */ }
  }

  // ---- native helpers ----
  async displays(): Promise<Display[]> { return normalizeDisplays(await availableMonitors(), mac); }
  async readOuter() {
    const win = getCurrentWindow();
    const [p, outer, inner, scale] = await Promise.all([win.outerPosition(), win.outerSize(), win.innerSize(), win.scaleFactor()]);
    const o = outer.toLogical(scale), i = inner.toLogical(scale);
    return { bounds: normalizeBounds({ x: p.x, y: p.y, width: o.width, height: o.height, scaleFactor: scale }, mac),
      chrome: { width: o.width - i.width, height: o.height - i.height } };
  }
  /** Marks the next window events as ours, so they neither overwrite the remembered frame nor snap. */
  #quiet(ms: number) { this.#programmaticUntil = Math.max(this.#programmaticUntil, Date.now() + ms); }
  async applyOuter(bounds: Bounds) {
    this.#quiet(400);
    const win = getCurrentWindow();
    if (mac) { await animateWindow({ bounds, duration: 0 }); return; }
    const { chrome } = await this.readOuter();
    const position = new PhysicalPosition(bounds.x, bounds.y);
    await win.setPosition(position);
    await win.setSize(new LogicalSize(bounds.width - chrome.width, bounds.height - chrome.height));
    await win.setPosition(position);
  }
  async #animate(options: Parameters<typeof animateWindow>[0]) {
    this.#quiet((options.duration ?? 0) + 400);
    if (canAnimateWindow() || options.duration === 0) await animateWindow(options);
  }
  #nudge(b: Bounds, toward: CenterSide | 'up', d = 24): Bounds {
    return toward === 'up' ? { ...b, y: b.y + 8 * b.scaleFactor } : { ...b, x: b.x + (toward === 'left' ? -d : d) * b.scaleFactor };
  }
  async #showFaded(to: Bounds, from: Bounds = to, ms = 240) {
    const win = getCurrentWindow();
    if (!canAnimateWindow()) { await this.applyOuter(to); await win.show(); return; }
    await this.#animate({ bounds: from, alpha: 0, duration: 0 });
    await win.show();
    await this.#animate({ bounds: to, alpha: 1, duration: ms, curve: 'out' });
  }
  /**
   * Fade a short way toward `side` from where the window is now (`from`, e.g. where a
   * drag was released), hide, then park the hidden frame at `restore` for the next show.
   * The exit motion never travels to the remembered frame.
   */
  async #hideFaded(from: Bounds, restore: Bounds, toward: CenterSide | 'up') {
    const win = getCurrentWindow();
    if (canAnimateWindow()) await this.#animate({ bounds: this.#nudge(from, toward), alpha: 0, duration: 170, curve: 'in' });
    await win.hide();
    if (mac) await this.#animate({ alpha: 1, duration: 0 });
    await this.applyOuter(restore);
  }

  // ---- the handle/strip proxy window ----
  /** Note tabs on the dock's edge; the handle keeps clear of them. */
  #tabRanges(displays: Display[], dock = this.dock): Range[] {
    const display = dockDisplay(dock, displays);
    return [...edgeLayout(this.host.notes(), displays).values()]
      .filter(s => !s.overflow && s.side === dock.side && s.display === display)
      .map(s => ({ top: s.bounds.y, bottom: s.bounds.y + s.bounds.height * s.bounds.scaleFactor }));
  }
  async handleFrame(dock = this.dock) {
    const displays = await this.displays();
    return handleBounds(dock, displays, this.#tabRanges(displays, dock));
  }
  async syncDock() {
    if (!this.#dockKind) return;
    await emitTo('center-dock', 'center-dock-state', { kind: this.#dockKind, side: this.dock.side, title: this.host.title(),
      count: this.host.notes().filter(n => n.lifecycle === 'active').length });
  }
  async #showDock(kind: 'bar' | 'handle', bounds: Bounds) {
    let dock = await WebviewWindow.getByLabel('center-dock');
    if (!dock) {
      dock = new WebviewWindow('center-dock', { url: '/dock', title: 'PinNote', width: bounds.width, height: bounds.height, decorations: false,
        transparent: true, backgroundColor: '#00000000', shadow: false, resizable: false, alwaysOnTop: this.pinned, skipTaskbar: true,
        visible: false, focus: false, visibleOnAllWorkspaces: mac });
      await new Promise<void>((resolve, reject) => { dock!.once('tauri://created', () => resolve()); dock!.once('tauri://error', e => reject(e.payload)); });
    }
    this.#dockKind = kind;
    // The proxy follows the center's own pin: it never floats above other apps on its own.
    await dock.setAlwaysOnTop(this.pinned);
    await dock.setSize(new LogicalSize(bounds.width, bounds.height));
    await dock.setPosition(mac ? new LogicalPosition(bounds.x, bounds.y) : new PhysicalPosition(bounds.x, bounds.y));
    await this.syncDock();
    await dock.show();
  }
  async #hideDock() { this.#dockKind = undefined; await (await WebviewWindow.getByLabel('center-dock'))?.hide(); }
  /** Re-place the handle after its display, work area or neighbouring tabs changed. */
  async relayoutHandle() {
    if (this.mode === 'window' || this.#busy) return;
    const displays = await this.displays();
    // The hidden normal frame follows display changes too, so a later show lands on screen.
    if (this.normal && !validWindow(this.normal, displays)) {
      this.normal = restoreFrame(this.normal, this.normal, displays);
      await this.applyOuter(this.normal); this.save();
    }
    if (this.mode !== 'handle') return;
    const dock = await WebviewWindow.getByLabel('center-dock');
    const b = handleBounds(this.dock, displays, this.#tabRanges(displays));
    await dock?.setPosition(mac ? new LogicalPosition(b.x, b.y) : new PhysicalPosition(b.x, b.y));
  }

  // ---- transitions ----
  #next: (() => Promise<void>) | undefined;
  /** One transition at a time; a request made meanwhile replaces any older queued one,
   * so rapid clicks settle on the latest intent instead of replaying every step. */
  async #run(step: () => Promise<void>) {
    if (this.#busy) { this.#next = step; return; }
    this.#busy = true;
    try {
      for (let current: (() => Promise<void>) | undefined = step; current; current = this.#next, this.#next = undefined) {
        try { await current(); }
        catch (error) {
          this.host.status(`窗口切换失败：${error}`);
          if (mac) await animateWindow({ alpha: 1, duration: 0 }).catch(() => {});
          await getCurrentWindow().show().catch(() => {}); await this.#hideDock().catch(() => {});
          this.mode = 'window';
        }
      }
    } finally { this.#busy = false; this.save(); }
  }
  /**
   * Collapse straight to the edge handle. `pointer` comes from a drag released at an edge;
   * `normal` is the frame to come back to (the one before that drag); `dock` re-docks exactly.
   */
  collapse(side?: CenterSide, pointer?: Pointer, normal?: Bounds, dock?: CenterDock) {
    return this.#run(async () => {
      if (this.mode === 'handle' && side && side !== this.dock.side) {
        this.dock = { ...this.dock, side };
        await this.#showDock('handle', await this.handleFrame());
        return;
      }
      if (this.mode !== 'window') return;
      if (!await this.#saved()) return;
      const current = (await this.readOuter()).bounds;
      const displays = await this.displays();
      const keep = restoreFrame(normal, current, displays);
      this.normal = keep;
      const nextSide = side ?? dock?.side ?? nearestSide(current, displayFor(current, displays) ?? displays[0]);
      this.dock = dock ?? (pointer ? dockAt(pointer, nextSide, displays)
        : { ...this.dock, side: nextSide, display: dockAt({ x: current.x + current.width * current.scaleFactor / 2, y: current.y }, nextSide, displays).display });
      await this.#showDock('handle', await this.handleFrame());
      await this.#hideFaded(current, keep, nextSide);
      this.mode = 'handle';
      this.host.status('已收起到边缘 · 点击把手恢复');
    });
  }
  collapseToBar() {
    return this.#run(async () => {
      if (this.mode !== 'window') return;
      if (!await this.#saved()) return;
      const current = (await this.readOuter()).bounds;
      const displays = await this.displays();
      this.normal = restoreFrame(current, current, displays);
      await this.#showDock('bar', barBounds(current, displays));
      await this.#hideFaded(current, this.normal, 'up');
      this.mode = 'bar';
      this.host.status('已收起为条 · 点击条恢复');
    });
  }
  /**
   * The open draft must be saved before the window hides: a failed save or an open version
   * conflict keeps the center expanded, so its banner and retry stay in view.
   */
  async #saved() {
    try { await this.host.persist(); return true; }
    catch (error) {
      await this.#hideDock();
      this.host.status(String((error as Error)?.message ?? error).startsWith('VERSION_CONFLICT') ? '先处理版本冲突，再收起' : '草稿未保存，便签中心保持展开 · 重试后再收起');
      return false;
    }
  }
  /** Restore the remembered normal frame from the handle or strip. */
  expand() {
    return this.#run(async () => {
      if (this.mode === 'window') { await getCurrentWindow().show(); await getCurrentWindow().setFocus(); return; }
      const from = this.mode;
      const displays = await this.displays();
      // The remembered frame, or (if it was lost) the hidden one, always on an available display.
      const target = restoreFrame(this.normal, (await this.readOuter()).bounds, displays);
      this.normal = target;
      await getCurrentWindow().setMinSize(new LogicalSize(CENTER_WINDOW_MIN.width, CENTER_WINDOW_MIN.height));
      await this.#showFaded(target, this.#nudge(target, from === 'handle' ? this.dock.side : 'up'), 240);
      await this.#hideDock();
      this.mode = 'window';
      await getCurrentWindow().setFocus();
      this.host.status('已恢复便签中心');
    });
  }
  /** Shown from outside (tray, relaunch) while collapsed: the hidden frame is already normal. */
  async adoptShown() {
    if (this.#busy || this.#detaching || this.mode === 'window') return;
    this.mode = 'window';
    if (mac) await animateWindow({ alpha: 1, duration: 0 }).catch(() => {});
    // A display may have gone while hidden: pull the frame back onto one.
    const displays = await this.displays();
    const { bounds } = await this.readOuter();
    if (!validWindow(bounds, displays)) await this.applyOuter(restoreFrame(this.normal, bounds, displays));
    await this.#hideDock(); this.save();
  }
  async setPinned(next: boolean) {
    const previous = this.pinned;
    this.pinned = next;
    try {
      await getCurrentWindow().setAlwaysOnTop(next);
      await (await WebviewWindow.getByLabel('center-dock'))?.setAlwaysOnTop(next);
      this.host.status(next ? '便签中心已置顶' : '已取消中心置顶');
    } catch (error) { this.pinned = previous; this.host.status(`置顶失败：${error}`); }
    this.save();
  }

  // ---- handle drag (events from the dock page) ----
  async dockAction({ action, pointer }: DockAction) {
    if (action === 'expand') return this.expand();
    if (action === 'moved' && pointer && this.mode === 'handle') {
      this.dock = dockAt(pointer, this.dock.side, await this.displays()); this.save();
      return this.relayoutHandle();
    }
    if (action === 'detach' && pointer && this.mode === 'handle' && !this.#busy) {
      this.#busy = true;
      this.#gesture++;
      this.#detachDock = this.dock;
      this.#detaching = (async () => {
        const displays = await this.displays();
        const size = this.normal ?? (await this.readOuter()).bounds;
        const target = detachedBounds({ width: size.width, height: size.height }, pointer, this.dock.side, displays);
        await this.#animate({ bounds: target, alpha: 0, duration: 0 });
        await getCurrentWindow().show();
        await this.#animate({ alpha: 1, duration: 120, curve: 'out' });
        this.mode = 'window';
      })().catch(error => { this.host.status(`展开失败：${error}`); });
      return;
    }
    if (action === 'drag' && pointer && this.#detaching) {
      const gesture = this.#gesture;
      await this.#detaching;
      return this.#dragTo(pointer, gesture);
    }
    if (action === 'drop' && this.#detaching) {
      await this.#detaching;
      // Release ends the gesture: drag steps still in flight must not move the window after it.
      const gesture = ++this.#gesture;
      if (pointer) await this.#dragTo(pointer, gesture);
      await this.#moves;
      const side = this.snapHint;
      this.#detaching = undefined; this.#busy = false; this.snapHint = null;
      if (side && this.mode === 'window') {
        // Released at an edge (this one, the other one, or on another display): dock there.
        // The frame to come back to stays the one from before the handle was pulled out.
        return this.collapse(side, pointer, this.normal);
      }
      // Released in the open: a free window where it was dropped, remembered as normal.
      this.normal = (await this.readOuter()).bounds;
      await this.#hideDock();
      await getCurrentWindow().setFocus();
      this.save();
      return;
    }
    if (action === 'cancel' && this.#detaching) {
      // A cancelled pull (Escape, lost pointer) goes back to the handle it came from.
      await this.#detaching;
      this.#gesture++;
      await this.#moves;
      const dock = this.#detachDock;
      this.#detaching = undefined; this.#busy = false; this.snapHint = null;
      return this.collapse(dock?.side, undefined, this.normal, dock);
    }
  }
  #detachDock: CenterDock | undefined;
  /** Bumped on detach, drop and cancel: a drag step from an ended gesture is dropped. */
  #gesture = 0;
  /** Window moves of a pull-out, applied strictly in order. */
  #moves: Promise<unknown> = Promise.resolve();
  async #dragTo(pointer: Pointer, gesture: number) {
    if (gesture !== this.#gesture) return;
    const displays = await this.displays();
    const size = this.normal ?? (await this.readOuter()).bounds;
    if (gesture !== this.#gesture) return; // released or cancelled while measuring
    const target = detachedBounds({ width: size.width, height: size.height }, pointer, this.#detachDock?.side ?? this.dock.side, displays);
    // The same gesture may carry the window to another edge or display: hint where it would dock.
    this.snapHint = this.host.edgeSnap() ? snapSide(target, pointer, displays) : null;
    const move = this.#moves.then(() => gesture === this.#gesture ? this.applyOuter(target) : undefined);
    this.#moves = move.catch(() => undefined);
    return move;
  }

  // ---- user moves/resizes of the normal window ----
  /** Call from the window's moved/resized events. Programmatic changes are ignored. */
  windowChanged(kind: 'moved' | 'resized' = 'moved') {
    if (this.mode !== 'window' || this.#busy || Date.now() < this.#programmaticUntil) return;
    // Only a move can be a drag toward an edge; a resize never snaps.
    if (kind === 'moved' && !this.#tracking && this.host.edgeSnap()) void this.#trackDrag();
    clearTimeout(this.#rememberTimer);
    this.#rememberTimer = setTimeout(() => void this.#remember(), 200);
  }
  async #remember() {
    if (this.mode !== 'window' || this.#busy || this.#tracking || Date.now() < this.#programmaticUntil) return;
    const { bounds } = await this.readOuter();
    if (validWindow(bounds, await this.displays())) { this.normal = bounds; this.save(); }
  }
  /** Follows a native title-bar drag until release, hinting and then snapping at an edge. */
  async #trackDrag() {
    const first = await invoke<{ pressed: boolean; x?: number; y?: number }>('pointer_state').catch(() => ({ pressed: false }));
    if (!first.pressed) return;
    this.#tracking = true;
    const start = this.normal;
    const startFrame = (await this.readOuter()).bounds;
    let side: CenterSide | null = null;
    let pointer: Pointer | undefined;
    let resizing = false;
    try {
      for (;;) {
        const state = await invoke<{ pressed: boolean; x?: number; y?: number }>('pointer_state');
        if (state.x != null && state.y != null) pointer = { x: state.x, y: state.y };
        const frame = (await this.readOuter()).bounds;
        // Dragging a border at the screen edge changes the size: that is a resize, not a snap.
        resizing ||= isResize(startFrame, frame);
        side = resizing || this.mode !== 'window' || Date.now() < this.#programmaticUntil ? null : snapSide(frame, pointer, await this.displays());
        this.snapHint = side;
        if (!state.pressed) break;
        await new Promise(r => setTimeout(r, 50));
      }
    } finally { this.#tracking = false; this.snapHint = null; }
    // Collapse from where it was released; the frame from before the drag is the one to come back to.
    if (side && this.mode === 'window') await this.collapse(side, pointer, start);
    else void this.#remember();
  }
}
