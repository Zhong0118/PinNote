import { emit, emitTo, listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

const REQUEST_EVENT = "window-visibility-request";
const ACK_EVENT = "window-visibility-complete";
type VisibilityRequest = { requestId: string; visible: boolean; expiresAt: number };
type VisibilityAck = { requestId: string; success: boolean; message?: string };

export async function requestWindowVisibility(label: string, visible: boolean): Promise<void> {
  const requestId = crypto.randomUUID();
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const completed = new Promise<void>((done, fail) => { resolve = done; reject = fail; });
  const unlisten = await listen<VisibilityAck>(ACK_EVENT, ({ payload }) => {
    if (payload.requestId !== requestId) return;
    if (payload.success) resolve();
    else reject(new Error(payload.message || "窗口显示状态切换失败"));
  });
  const request: VisibilityRequest = { requestId, visible, expiresAt: Date.now() + 5000 };
  const timeout = setTimeout(() => reject(new Error("窗口响应超时，请重试")), 5000);
  let retry: ReturnType<typeof setTimeout>;
  function send() {
    void emitTo(label, REQUEST_EVENT, request).catch(reject);
    retry = setTimeout(send, 250);
  }
  try {
    // Delivery only starts the operation. Its acknowledgement completes it.
    send();
    await completed;
  } finally {
    clearTimeout(timeout);
    clearTimeout(retry!);
    unlisten();
  }
}

export async function listenWindowVisibility(handler: (visible: boolean, expiresAt: number) => Promise<void>): Promise<UnlistenFn> {
  let pending = Promise.resolve();
  let disposed = false;
  const results = new Map<string, Promise<VisibilityAck>>();
  const cleanupTimers = new Set<ReturnType<typeof setTimeout>>();
  const unlisten = await listen<VisibilityRequest>(REQUEST_EVENT, ({ payload }) => {
    let result = results.get(payload.requestId);
    if (!result) {
      result = pending.then(async (): Promise<VisibilityAck> => {
        try {
          if (Date.now() >= payload.expiresAt) throw new Error("窗口请求已超时，请重试");
          await handler(payload.visible, payload.expiresAt);
          return { requestId: payload.requestId, success: true };
        } catch (error) {
          return { requestId: payload.requestId, success: false,
            message: error instanceof Error ? error.message : String(error) };
        }
      });
      // Cache before the queued handler starts, including while it is still running.
      results.set(payload.requestId, result);
      pending = result.then(() => {});
      void result.then(() => {
        if (disposed) return;
        const timer = setTimeout(() => {
          results.delete(payload.requestId);
          cleanupTimers.delete(timer);
        }, 5000);
        cleanupTimers.add(timer);
      });
    }
    // Duplicates replay the same result without enqueuing another operation.
    void result.then(ack => emit(ACK_EVENT, ack)).catch(() => {
      // A lost acknowledgement is retried by the caller without blocking the queue.
    });
  }, { target: getCurrentWindow().label });
  return () => {
    disposed = true;
    unlisten();
    cleanupTimers.forEach(clearTimeout);
    cleanupTimers.clear();
    results.clear();
  };
}
