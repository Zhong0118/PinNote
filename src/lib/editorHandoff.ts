import { emit, emitTo, listen } from '@tauri-apps/api/event';

type Released = { id: string; ok: boolean; message?: string };

/**
 * A desktop note window asks the center to save and give up its editor for `id`
 * before the window shows its own editor again. Resolves once the center's draft
 * is on disk; rejects (and the window stays collapsed) if it cannot be saved.
 */
export async function releaseCenterEditor(id: string, timeout = 3000) {
  let unlisten: (() => void) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    let settle!: (value: Released) => void;
    const reply = new Promise<Released>(resolve => { settle = resolve; });
    unlisten = await listen<Released>('note-editor-released', ({ payload }) => { if (payload.id === id) settle(payload); });
    timer = setTimeout(() => settle({ id, ok: false, message: '便签中心未响应，请稍后重试' }), timeout);
    await emitTo('main', 'release-note-editor', { id });
    const result = await reply;
    if (!result.ok) throw new Error(result.message || '便签中心的草稿尚未保存');
  } finally {
    clearTimeout(timer);
    unlisten?.();
  }
}

/** Center side: answer a release request after flushing the draft. */
export function answerRelease(id: string, ok: boolean, message?: string) {
  return emit('note-editor-released', { id, ok, message } satisfies Released);
}
