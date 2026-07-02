import { useEffect, useRef } from 'react';
import type { SpeciesId } from '../types';
import { drawSpecies } from '../render';

/**
 * A small self-animating canvas portrait of a species — the same vector
 * drawing routine the battlefield uses, framed on a gradient backdrop.
 */
export function CardArt({ species, hue, animate = false }: { species: SpeciesId; hue: number; animate?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let raf = 0;
    let disposed = false;

    const draw = (t: number) => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(1, Math.round(rect.width * dpr));
      const h = Math.max(1, Math.round(rect.height * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      const g = ctx.createRadialGradient(w / 2, h * 0.36, 2, w / 2, h * 0.5, w * 0.75);
      g.addColorStop(0, `hsl(${hue} 60% 30%)`);
      g.addColorStop(1, `hsl(${hue} 45% 10%)`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      ctx.save();
      ctx.translate(w / 2, h * 0.72);
      drawSpecies(ctx, species, Math.min(w, h) * 0.42, t / 1000);
      ctx.restore();
      if (animate && !disposed) raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
    };
  }, [species, hue, animate]);

  return <canvas ref={ref} />;
}
