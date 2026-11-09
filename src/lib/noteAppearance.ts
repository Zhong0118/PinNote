import type { NoteTheme } from './settings';

export const noteColors: Array<{theme:NoteTheme;label:string;background:string;swatch:string}> = [
  {theme:'paper',label:'纯白',background:'#ffffff',swatch:'#ffffff'},
  {theme:'mint',label:'薄荷',background:'#f5fbf8',swatch:'#bce4d1'},
  {theme:'rose',label:'浅粉',background:'#fff8f7',swatch:'#f2c9c5'},
  {theme:'sky',label:'浅蓝',background:'#f6fbff',swatch:'#c1dcf7'},
  {theme:'grape',label:'淡紫',background:'#fbf8ff',swatch:'#ddcef0'},
  {theme:'ink',label:'深色',background:'#272727',swatch:'#454545'},
];
export function noteBackground(theme:NoteTheme,customColor:string) {
  return theme==='custom' ? `color-mix(in srgb, ${customColor}, white 94%)` : noteColors.find(c=>c.theme===theme)?.background??'#fff';
}
/** The note's hue, used to tint its background in dark mode without changing the note. */
export function noteTint(theme:NoteTheme,customColor:string) {
  if(theme==='custom') return customColor;
  return ({paper:'#a1a1aa',mint:'#72bca0',rose:'#df9d9a',sky:'#7dafe1',grape:'#b69bd6',ink:'#555555'} as Record<string,string>)[theme]??'#a1a1aa';
}

/** The small colour mark of a note (list dots, capsule dot, edge-tab accent). */
const dots: Record<string, string> = { paper: '#a1a1aa', mint: '#72bca0', rose: '#df9d9a', sky: '#7dafe1', grape: '#b69bd6', ink: '#8a8a8a' };
export function noteDot(theme: NoteTheme, customColor: string) {
  return theme === 'custom' ? customColor : dots[theme] ?? dots.paper;
}
