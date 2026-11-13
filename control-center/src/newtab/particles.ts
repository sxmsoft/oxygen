import { WALLPAPER_FPS } from '../../../extension/src/logic/perf.js';

/** Lightweight animated particle field (≤ 70 dots, WALLPAPER_FPS cap, DPR ≤ 1.5). */
export interface Scene {
  start(): void;
  stop(): void;
  drawStatic(): void;
  destroy(): void;
}

export function createParticles(canvas: HTMLCanvasElement, color: string, accent: string): Scene {
  const ctx = canvas.getContext('2d')!;
  let w = 0, h = 0, raf = 0, last = 0;
  const dpr = Math.min(1.5, devicePixelRatio || 1);
  const N = 70;
  const dots = Array.from({ length: N }, () => ({ x: Math.random(), y: Math.random(), vx: (Math.random() - 0.5) * 0.00012, vy: (Math.random() - 0.5) * 0.00012, r: 0.6 + Math.random() * 1.8 }));
  const resize = () => {
    w = canvas.clientWidth; h = canvas.clientHeight;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  const draw = (dt: number) => {
    ctx.clearRect(0, 0, w, h);
    for (const d of dots) {
      d.x = (d.x + d.vx * dt + 1) % 1; d.y = (d.y + d.vy * dt + 1) % 1;
    }
    ctx.strokeStyle = accent; ctx.lineWidth = 0.6;
    for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) {
      const a = dots[i], b = dots[j];
      const dx = (a.x - b.x) * w, dy = (a.y - b.y) * h, dist = dx * dx + dy * dy;
      if (dist < 14000) { ctx.globalAlpha = 0.18 * (1 - dist / 14000); ctx.beginPath(); ctx.moveTo(a.x * w, a.y * h); ctx.lineTo(b.x * w, b.y * h); ctx.stroke(); }
    }
    ctx.fillStyle = color;
    for (const d of dots) { ctx.globalAlpha = 0.75; ctx.beginPath(); ctx.arc(d.x * w, d.y * h, d.r, 0, Math.PI * 2); ctx.fill(); }
    ctx.globalAlpha = 1;
  };
  const loop = (ts: number) => {
    raf = requestAnimationFrame(loop);
    if (ts - last < 1000 / WALLPAPER_FPS - 1) return;
    draw(Math.min(100, ts - last || 16));
    last = ts;
  };
  const ro = new ResizeObserver(() => { resize(); if (!raf) draw(0); });
  ro.observe(canvas);
  resize();
  return {
    start() { if (!raf) { last = performance.now(); raf = requestAnimationFrame(loop); } },
    stop() { cancelAnimationFrame(raf); raf = 0; },
    drawStatic() { draw(0); },
    destroy() { cancelAnimationFrame(raf); raf = 0; ro.disconnect(); },
  };
}
