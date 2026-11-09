/** Readable plain text from Markdown for list rows and hover previews (no full parse). */
export function plainExcerpt(markdown: string, max = 160) {
  const text = markdown
    .replace(/```[^\n]*\n?/g, '')                    // code fences, keep their content
    .replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, '')              // headings
    .replace(/^[ \t]*[-*+][ \t]+\[[ xX]\][ \t]+/gm, '· ')     // task items
    .replace(/^[ \t]*(?:[-*+]|\d+[.)])[ \t]+/gm, '· ')     // list items
    .replace(/^[ \t]{0,3}>[ \t]?/gm, '')                   // quotes
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')       // links and images keep their text
    .replace(/(\*\*|__|\*|_|~~|`)/g, '')             // inline marks
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;
}

const pad = (n: number) => String(n).padStart(2, '0');
/** A short reminder time: 今天 / 明天 / 昨天 / 11月8日 / 2027年1月2日, then HH:mm. */
export function shortTime(at: number, now = Date.now()) {
  const d = new Date(at), today = new Date(now);
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(d) - day(today)) / 864e5);
  const date = diff === 0 ? '今天' : diff === 1 ? '明天' : diff === -1 ? '昨天'
    : d.getFullYear() === today.getFullYear() ? `${d.getMonth() + 1}月${d.getDate()}日` : `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
  return `${date} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
