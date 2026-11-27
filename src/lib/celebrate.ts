// Small celebrations: confetti, sparkles and the to-do tick. Each draws on a throwaway
// overlay that removes itself, never touches the editor's DOM, and respects both
// "reduce motion" and the dedicated "celebrate" preference.
import { motionReduced } from './motion';
import { celebrationsEnabled } from './theme';

const FESTIVE = ['#f5c542', '#ff7a6b', '#4cc9f0', '#7bd389', '#b18cff'];

type Burst = {
  /** Pieces to throw. */ count?: number;
  /** Colours; the first is used most. */ colors?: string[];
  /** Launch speed in px per frame at 60 fps. */ power?: number;
  /** Downward pull per frame. */ gravity?: number;
  /** Cone half-angle in radians around straight up (Math.PI throws in every direction). */ spread?: number;
  /** Lifetime in ms. */ duration?: number;
  /** Piece size in px. */ size?: number;
  /** Round sparkles instead of paper strips. */ round?: boolean;
  /** Crisp axis-aligned pixel blocks / pixel stars echoing the InkPin mark. */ pixel?: boolean;
};

function layer(): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = innerWidth * dpr; canvas.height = innerHeight * dpr;
  canvas.setAttribute('aria-hidden', 'true');
  Object.assign(canvas.style, { position: 'fixed', inset: '0', width: '100vw', height: '100vh', pointerEvents: 'none', zIndex: '9999' });
  ctx.scale(dpr, dpr);
  document.body.appendChild(canvas);
  return { canvas, ctx };
}

/** Throw a burst from (x, y) in viewport pixels. */
export function confetti(x: number, y: number, opts: Burst = {}) {
  if (typeof window === 'undefined' || !celebrationsEnabled()) return;
  const { count = 32, colors = FESTIVE, power = 7.5, gravity = 0.28, spread = Math.PI / 2.8, duration = 1000, size = 6, round = false, pixel = false } = opts;
  const surface = layer();
  if (!surface) return;
  const { canvas, ctx } = surface;
  const pieces = Array.from({ length: count }, (_, i) => {
    const angle = -Math.PI / 2 + (Math.random() * 2 - 1) * spread;
    const speed = power * (0.55 + Math.random() * 0.55);
    return {
      x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
      spin: (Math.random() - 0.5) * 0.36, turn: Math.random() * Math.PI,
      color: colors[i % 2 === 0 ? 0 : Math.floor(Math.random() * colors.length)],
      w: size * (0.7 + Math.random() * 0.55), h: size * (0.4 + Math.random() * 0.35),
    };
  });
  const start = performance.now();
  let last = start;
  const frame = (now: number) => {
    const t = now - start, step = Math.min(3, (now - last) / 16.7);
    last = now;
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    const fade = Math.min(1, Math.max(0, (duration - t) / (duration * 0.35)));
    for (const p of pieces) {
      p.vx *= 0.985 ** step; p.vy = p.vy * 0.985 ** step + gravity * step;
      p.x += p.vx * step; p.y += p.vy * step; p.turn += p.spin * step;
      ctx.save();
      ctx.globalAlpha = fade;
      ctx.fillStyle = p.color;
      if (pixel) {
        const px = Math.round(p.x), py = Math.round(p.y);
        const s = Math.max(2, Math.round(p.w));
        if (round) {
          // Crisp 3-pixel plus-shaped star
          ctx.fillRect(px - s, py - 1, s * 2 + 1, 2);
          ctx.fillRect(px - 1, py - s, 2, s * 2 + 1);
        } else {
          ctx.fillRect(px - Math.floor(s / 2), py - Math.floor(s / 2), s, s);
        }
      } else {
        ctx.translate(p.x, p.y);
        ctx.rotate(p.turn);
        if (round) { ctx.beginPath(); ctx.arc(0, 0, p.w / 2, 0, Math.PI * 2); ctx.fill(); }
        else ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.turn * 2)) + 1);
      }
      ctx.restore();
    }
    if (t < duration) requestAnimationFrame(frame); else canvas.remove();
  };
  requestAnimationFrame(frame);
}

/** A restrained accent-tinted pixel burst for finishing a checklist. */
export function tintedConfetti(x: number, y: number, accent: string) {
  confetti(x, y, {
    count: 24,
    colors: [accent, '#93c5fd', '#cbd5e1', '#f5c542'],
    power: 6.4,
    gravity: 0.26,
    spread: Math.PI / 2.6,
    duration: 880,
    size: 4.5,
    pixel: true,
  });
}

/** A few crisp pixel star sparkles around a control, e.g. a star lighting up. */
export function sparkle(x: number, y: number, color: string) {
  confetti(x, y, { count: 9, colors: [color, '#ffffff', color], power: 2.7, gravity: 0.04, spread: Math.PI, duration: 480, size: 2.5, round: true, pixel: true });
}

/** Centre of an element, for launching from it. */
export function centerOf(el: Element) {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/** Ticking a to-do: a subtle ring pops from the checkbox and a pen stroke draws across
 * the first line of text. Drawn as a fixed overlay (cleared immediately on scroll) so
 * ProseMirror never sees extra nodes or classes. */
export function tick(li: HTMLElement, color: string) {
  if (motionReduced()) return;
  const r = li.getBoundingClientRect();
  const fontSize = parseFloat(getComputedStyle(li).fontSize) || 14;
  // Matches `.milkdown-host li[data-item-type="task"]::before` (`top: 0.32em; width: 15px; height: 15px`).
  const box = { x: r.left + 7.5, y: r.top + fontSize * 0.32 + 7.5 };
  const overlays: HTMLElement[] = [];
  const cleanup = () => { overlays.forEach(el => el.remove()); overlays.length = 0; };

  const ring = document.createElement('i');
  Object.assign(ring.style, {
    position: 'fixed', left: `${box.x - 9}px`, top: `${box.y - 9}px`, width: '18px', height: '18px',
    borderRadius: '50%', border: `2px solid ${color}`, pointerEvents: 'none', zIndex: '9999', boxSizing: 'border-box',
  });
  document.body.appendChild(ring);
  overlays.push(ring);
  ring.animate([{ transform: 'scale(.65)', opacity: 0.85 }, { transform: 'scale(1.85)', opacity: 0 }],
    { duration: 380, easing: 'cubic-bezier(.2,.85,.25,1)' }).onfinish = () => ring.remove();

  const text = document.createRange();
  text.selectNodeContents(li);
  const first = Array.from(text.getClientRects()).find(rect => rect.width > 4 && rect.left > r.left + 12);
  if (first) {
    const line = document.createElement('i');
    Object.assign(line.style, {
      position: 'fixed', left: `${first.left}px`, top: `${first.top + first.height / 2}px`, width: `${first.width}px`,
      height: '1.5px', borderRadius: '1px', background: color, transformOrigin: 'left center', pointerEvents: 'none', zIndex: '9999',
    });
    document.body.appendChild(line);
    overlays.push(line);
    line.animate([{ transform: 'scaleX(0)', opacity: 0.9 }, { transform: 'scaleX(1)', opacity: 0.9, offset: 0.6 }, { transform: 'scaleX(1)', opacity: 0 }],
      { duration: 480, easing: 'cubic-bezier(.2,.85,.25,1)' }).onfinish = () => line.remove();
  }

  const scroller = li.closest('.milkdown-host');
  if (scroller) scroller.addEventListener('scroll', cleanup, { once: true, passive: true });
}
