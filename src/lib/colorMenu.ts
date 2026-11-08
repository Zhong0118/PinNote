// Note colors are picked from a native menu: it is drawn by the OS, so it is never
// clipped by a small capsule or edge-tab window and needs no extra WebView.
import { Menu, IconMenuItem, MenuItem, PredefinedMenuItem } from '@tauri-apps/api/menu';
import { Image } from '@tauri-apps/api/image';
import { noteColors } from './noteAppearance';
import type { NoteTheme } from './settings';

const SIZE = 32; // drawn at 2x, shown at 16pt
const swatches = new Map<string, Promise<Image>>();

function hex(color: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(color.trim());
  const v = m ? parseInt(m[1], 16) : 0xffffff;
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

/** A round swatch with a soft outline; the current color gets a blue ring. */
function swatch(color: string, current: boolean) {
  const key = `${color}:${current}`;
  let image = swatches.get(key);
  if (!image) {
    const [r, g, b] = hex(color);
    const data = new Uint8Array(SIZE * SIZE * 4);
    const c = (SIZE - 1) / 2;
    for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
      const d = Math.hypot(x - c, y - c), i = (y * SIZE + x) * 4;
      const fill = d <= (current ? 10 : 12.5), ring = current ? d > 12.5 && d <= 15.5 : d > 12.5 && d <= 14;
      if (fill) { data.set([r, g, b, 255], i); if (d > (current ? 9 : 11.5)) data.set([r * .8, g * .8, b * .8, 255], i); }
      else if (ring) data.set(current ? [37, 99, 235, 255] : [0, 0, 0, 40], i);
    }
    image = Image.new(data, SIZE, SIZE);
    swatches.set(key, image);
  }
  return image;
}

/**
 * Opens the color menu at the pointer. `onPick` receives a preset theme, or
 * `custom` when the user wants the system color panel.
 */
export async function openColorMenu(theme: NoteTheme, customColor: string, onPick: (theme: NoteTheme | 'custom-picker') => void) {
  const items = await Promise.all(noteColors.map(async color => IconMenuItem.new({
    id: `color-${color.theme}`, text: color.label, icon: await swatch(color.swatch, theme === color.theme),
    action: () => onPick(color.theme),
  })));
  const custom = await IconMenuItem.new({ id: 'color-custom', text: '自定义颜色…', icon: await swatch(customColor, theme === 'custom'), action: () => onPick('custom-picker') });
  const title = await MenuItem.new({ id: 'color-title', text: '便签颜色', enabled: false });
  const menu = await Menu.new({ items: [title, ...items, await PredefinedMenuItem.new({ item: 'Separator' }), custom] });
  await menu.popup();
}
