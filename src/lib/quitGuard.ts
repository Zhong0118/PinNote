// Save/cancel events can arrive before a late webview receives pending_quit's reply.
export function createQuitGuard() {
  let latest = 0;
  let cancelled = 0;
  return {
    begin(attempt: number) {
      if (attempt <= Math.max(latest, cancelled)) return false;
      latest = attempt;
      return true;
    },
    cancel(attempt: number) {
      cancelled = Math.max(cancelled, attempt);
      return latest <= attempt;
    },
    isCurrent(attempt: number) {
      return latest === attempt && cancelled < attempt;
    },
  };
}
