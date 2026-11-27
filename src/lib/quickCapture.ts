/**
 * Lightweight inline token parser for the Quick Capture HUD:
 * - `#tag` tokens (outside hex colors and markdown headings) -> tags[]
 * - `@10m`, `@2h`, `@30分`, `@1小时`, `@18:30`, `@今晚`, `@明天`, `@明天9:00` -> reminderAt
 * - Leading `[] ` shorthand -> `- [ ] ` checklist item
 */
export type QuickCaptureParsed = {
  content: string;
  tags: string[];
  reminderAt: number | null;
  reminderLabel: string;
};

function resolveClock(hours: number, minutes: number, now: number, forceTomorrow = false): number | null {
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  const d = new Date(now);
  if (forceTomorrow) d.setDate(d.getDate() + 1);
  d.setHours(hours, minutes, 0, 0);
  if (!forceTomorrow && d.getTime() <= now) d.setDate(d.getDate() + 1);
  return d.getTime();
}

export function parseQuickCapture(raw: string, now = Date.now()): QuickCaptureParsed {
  const tags: string[] = [];
  let reminderAt: number | null = null;
  let reminderLabel = '';

  const lines = raw.split('\n').map(line => {
    let cleaned = line;

    // Extract inline @time tokens once (first valid reminder wins).
    cleaned = cleaned.replace(/(^|\s)@([^\s]+)/g, (full, lead: string, token: string) => {
      if (reminderAt !== null) return full;
      const relMin = token.match(/^(\d+)(?:m|min|分|分钟)$/i);
      if (relMin) {
        const mins = Number(relMin[1]);
        if (mins > 0 && mins <= 10080) {
          reminderAt = now + mins * 60_000;
          reminderLabel = `${mins} 分钟后`;
          return lead;
        }
      }
      const relHour = token.match(/^(\d+)(?:h|hr|小时|时)$/i);
      if (relHour) {
        const hrs = Number(relHour[1]);
        if (hrs > 0 && hrs <= 720) {
          reminderAt = now + hrs * 3_600_000;
          reminderLabel = `${hrs} 小时后`;
          return lead;
        }
      }
      if (token === '今晚' || token.toLowerCase() === 'tonight') {
        const at = resolveClock(20, 0, now);
        if (at) { reminderAt = at; reminderLabel = '今晚 20:00'; return lead; }
      }
      const tom = token.match(/^(?:明天|tomorrow)(?:(\d{1,2})(?::(\d{2}))?)?$/i);
      if (tom) {
        const h = tom[1] ? Number(tom[1]) : 9;
        const m = tom[2] ? Number(tom[2]) : 0;
        const at = resolveClock(h, m, now, true);
        if (at) {
          reminderAt = at;
          reminderLabel = `明天 ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
          return lead;
        }
      }
      const clock = token.match(/^(\d{1,2}):(\d{2})$/);
      if (clock) {
        const h = Number(clock[1]), m = Number(clock[2]);
        const at = resolveClock(h, m, now, false);
        if (at) {
          reminderAt = at;
          const sameDay = new Date(at).getDate() === new Date(now).getDate();
          reminderLabel = `${sameDay ? '今天' : '明天'} ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
          return lead;
        }
      }
      return full;
    });

    // Extract inline #tag tokens (skip markdown `# heading` and hex colors like #ff00aa).
    cleaned = cleaned.replace(/(^|\s)#([^\s#]{1,20})/g, (full, lead: string, tag: string) => {
      if (/^[0-9a-f]{3}([0-9a-f]{3})?$/i.test(tag)) return full;
      if (tags.length < 8 && !tags.some(t => t.toLowerCase() === tag.toLowerCase())) {
        tags.push(tag);
      }
      return lead;
    });

    cleaned = cleaned.replace(/[ \t]{2,}/g, ' ').trimEnd();
    if (/^\[\]\s+/.test(cleaned)) cleaned = cleaned.replace(/^\[\]\s+/, '- [ ] ');
    return cleaned;
  });

  const content = lines.join('\n').trim();
  return { content, tags, reminderAt, reminderLabel };
}
