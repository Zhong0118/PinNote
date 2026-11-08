// Debug-only resource counters (PINNOTE_PERF=1 on a debug build). Counting is a
// cheap in-memory increment; reports are only sent when the backend enables them.
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';

const counters: Record<string, { n: number; ms: number }> = {};
let dirty = false;
type PerfConfig = { enabled: boolean; scenario: boolean; check: boolean; tour: boolean };
let enabled: Promise<PerfConfig> | undefined;

export function perfConfig() {
  enabled ??= invoke<Partial<PerfConfig> | undefined>('perf_enabled')
    .then(c => ({ enabled: Boolean(c?.enabled), scenario: Boolean(c?.scenario), check: Boolean(c?.check), tour: Boolean(c?.tour) }), () => ({ enabled: false, scenario: false, check: false, tour: false }));
  return enabled;
}

export function perfCount(name: string, ms = 0) {
  const entry = (counters[name] ??= { n: 0, ms: 0 });
  entry.n += 1; entry.ms += ms; dirty = true;
}

/** Time a synchronous call and count it. */
export function perfTime<T>(name: string, run: () => T): T {
  const start = performance.now();
  try { return run(); } finally { perfCount(name, performance.now() - start); }
}

export function perfMark(name: string) { return invoke('perf_mark', { name }).catch(() => undefined); }

void perfConfig().then(({ enabled }) => {
  if (!enabled) return;
  const label = getCurrentWindow().label;
  setInterval(() => {
    if (!dirty) return; dirty = false;
    const rounded = Object.fromEntries(Object.entries(counters).map(([k, v]) => [k, { n: v.n, ms: Math.round(v.ms * 100) / 100 }]));
    void invoke('perf_log', { label, counters: rounded }).catch(() => undefined);
  }, 1000);
});
