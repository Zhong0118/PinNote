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
