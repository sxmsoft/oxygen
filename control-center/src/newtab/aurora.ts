import type { Scene } from './particles';
import { AURORA_FPS } from '../../../extension/src/logic/perf.js';

/**
 * Aurora wallpaper drawn on a small canvas (1/6 of the window, scaled up by
 * CSS; the blobs are soft so it looks the same). It replaces three 60vmax
 * CSS-blurred layers that made the compositor re-blur the whole window on
 * every frame. Capped at AURORA_FPS; a static frame when paused.
 */
const SCALE = 1 / 6;
const BLOBS = [
  { color: '#3b5bdb', left: 0.05, top: 0.0, alpha: 0.45, dur: 38, delay: 0 },
  { color: '#0ca678', left: 0.45, top: 0.3, alpha: 0.3, dur: 46, delay: -12 },
  { color: '', left: 0.0, top: 0.45, alpha: 0.32, dur: 54, delay: -25 },
];
// keyframes 0% / 50% / 100% (ease-in-out, alternate): dx (vw), dy (vh), scale
const KF = [[0, 0, 1], [12, -6, 1.15], [-8, 8, 0.95]];
const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

function hexA(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

export function createAurora(canvas: HTMLCanvasElement, bg: string, accent: string): Scene {
  const ctx = canvas.getContext('2d', { alpha: false })!;
  let w = 0, h = 0, raf = 0, last = 0;
  const t0 = performance.now();
  const third = /^#[0-9a-f]{6}$/i.test(accent) ? accent : '#9c36b5';
  const resize = () => {
    w = Math.max(32, Math.round(innerWidth * SCALE));
    h = Math.max(32, Math.round(innerHeight * SCALE));
    canvas.width = w;
    canvas.height = h;
  };
  const draw = (now: number) => {
    const sec = (now - t0) / 1000;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
    const vmax = Math.max(w, h);
    // the old CSS container was inset -20%
    const cw = w * 1.4, ch = h * 1.4, ox = -w * 0.2, oy = -h * 0.2;
    for (const b of BLOBS) {
      const cycle = ((sec - b.delay) / b.dur) % 2;
      const t = ease(cycle < 1 ? cycle : 2 - cycle);
      const [a, c] = t < 0.5 ? [KF[0], KF[1]] : [KF[1], KF[2]];
      const k = t < 0.5 ? t * 2 : (t - 0.5) * 2;
      const dx = (a[0] + (c[0] - a[0]) * k) * w / 100, dy = (a[1] + (c[1] - a[1]) * k) * h / 100, s = a[2] + (c[2] - a[2]) * k;
      const r = 0.3 * vmax * s * 1.25;
      const x = ox + b.left * cw + 0.3 * vmax + dx, y = oy + b.top * ch + 0.3 * vmax + dy;
      const col = b.color || third;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, hexA(col, b.alpha));
      g.addColorStop(0.5, hexA(col, b.alpha * 0.75));
      g.addColorStop(1, hexA(col, 0));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }
  };
  const frame = 1000 / AURORA_FPS;
  const loop = (ts: number) => {
    raf = requestAnimationFrame(loop);
    if (ts - last < frame - 1) return;
    last = ts;
    draw(ts);
  };
  const onResize = () => { resize(); draw(performance.now()); };
  addEventListener('resize', onResize);
  resize();
  draw(t0);
  return {
    start() { if (!raf) raf = requestAnimationFrame(loop); },
    stop() { cancelAnimationFrame(raf); raf = 0; },
    drawStatic() { draw(performance.now()); },
    destroy() { cancelAnimationFrame(raf); raf = 0; removeEventListener('resize', onResize); },
  };
}
