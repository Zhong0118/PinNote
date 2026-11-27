import type { NoteTheme } from './settings';

export const noteColors: Array<{ theme: NoteTheme; label: string; background: string; swatch: string }> = [
  { theme: 'paper', label: '纯白', background: '#ffffff', swatch: '#ffffff' },
  { theme: 'cream', label: '暖米', background: '#fffcf0', swatch: '#f3e1b2' },
  { theme: 'mint', label: '薄荷', background: '#f2faf6', swatch: '#b4e0cb' },
  { theme: 'rose', label: '浅粉', background: '#fff5f4', swatch: '#f0c0bc' },
  { theme: 'sky', label: '浅蓝', background: '#f2f8ff', swatch: '#b7d6f7' },
  { theme: 'grape', label: '淡紫', background: '#f8f4ff', swatch: '#d6c3ee' },
  { theme: 'ink', label: '深色', background: '#272727', swatch: '#454545' },
];

export function noteBackground(theme: NoteTheme, customColor: string) {
  return theme === 'custom'
    ? `color-mix(in srgb, ${customColor}, white 92%)`
    : noteColors.find(c => c.theme === theme)?.background ?? '#ffffff';
}

/** The note's hue, used to tint its background in dark mode without changing the note. */
export function noteTint(theme: NoteTheme, customColor: string) {
  if (theme === 'custom') return customColor;
  return ({ paper: '#a1a1aa', cream: '#d9b15f', mint: '#62b394', rose: '#dd8e8a', sky: '#6ca4df', grape: '#ab8bd0', ink: '#555555' } as Record<string, string>)[theme] ?? '#a1a1aa';
}

/** Per-note accent colour: paper and ink keep the app blue; tinted notes harmonize their checkboxes and progress bars. */
const accentsLight: Record<string, string> = {
  cream: '#b47816',
  mint: '#1d8360',
  rose: '#c25158',
  sky: '#2563eb',
  grape: '#7c4fd6',
};
const accentsDark: Record<string, string> = {
  cream: '#f0c36d',
  mint: '#68cfa9',
  rose: '#f1989a',
  sky: '#7ab0ff',
  grape: '#c3a4f5',
};

export function noteAccent(theme: NoteTheme, customColor: string, dark = false): string | undefined {
  if (theme === 'custom') return dark ? `color-mix(in srgb, ${customColor} 78%, white)` : customColor;
  return (dark ? accentsDark : accentsLight)[theme];
}

/** The small colour mark of a note (list dots, capsule dot, edge-tab accent). */
const dots: Record<string, string> = {
  paper: '#a1a1aa',
  cream: '#d8ab4c',
  mint: '#5fb494',
  rose: '#dc8d89',
  sky: '#6aa4df',
  grape: '#aa8ad1',
  ink: '#8a8a8a',
};
export function noteDot(theme: NoteTheme, customColor: string) {
  return theme === 'custom' ? customColor : dots[theme] ?? dots.paper;
}

/** Display title for lists, tabs and previews: explicit title wins, otherwise derive from the first non-empty content line. */
export function displayTitle(title: string | undefined, content: string | undefined, fallback = '未命名便签'): string {
  const explicit = title?.trim();
  if (explicit) return explicit;
  if (content) {
    for (const raw of content.split('\n')) {
      if (/^[ \t]{0,3}(?:`{3,}|~{3,}|[-*_]{3,})/.test(raw.trim())) continue;
      const cleaned = raw
        .replace(/^[ \t]{0,3}#{1,6}[ \t]+/, '')
        .replace(/^[ \t]*(?:[-*+]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?/, '')
        .replace(/^[ \t]{0,3}>[ \t]?/, '')
        .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/(\*\*|__|\*|_|~~|`)/g, '')
        .trim();
      if (cleaned) {
        return cleaned.length > 48 ? `${cleaned.slice(0, 48).trimEnd()}…` : cleaned;
      }
    }
  }
  return fallback;
}
