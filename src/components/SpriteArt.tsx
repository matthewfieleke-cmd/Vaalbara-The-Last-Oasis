import { useEffect, useRef } from 'react';
import type { SpeciesId } from '../types';
import { drawSpecies } from '../render';
import { getSprite, loadSprites } from '../sprites';

/**
 * Painted character portrait on a themed gradient backdrop, with a gentle
 * idle float. Falls back to the procedural vector art until (or unless) the
 * painting is available, so offline-first behaviour is preserved.
 */
export function SpriteArt({
  species,
  hue,
  float = false,
}: {
  species: SpeciesId;
  hue: number;
  float?: boolean;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let raf = 0;
    let disposed = false;

    const draw = (t: number) => {
      if (disposed) return;
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(1, Math.round(rect.width * dpr));
      const h = Math.max(1, Math.round(rect.height * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      const g = ctx.createRadialGradient(w / 2, h * 0.32, 2, w / 2, h * 0.55, w * 0.8);
      g.addColorStop(0, `hsl(${hue} 62% 32%)`);
      g.addColorStop(1, `hsl(${hue} 48% 10%)`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);

      const sprite = getSprite(species);
      if (sprite) {
        const bobY = float ? Math.sin(t / 700) * h * 0.015 : 0;
        // Ground glow under the piece.
        const glow = ctx.createRadialGradient(w / 2, h * 0.82, 1, w / 2, h * 0.82, w * 0.4);
        glow.addColorStop(0, `hsla(${hue} 80% 55% / 0.35)`);
        glow.addColorStop(1, `hsla(${hue} 80% 50% / 0)`);
        ctx.fillStyle = glow;
        ctx.fillRect(0, h * 0.5, w, h * 0.5);
        const scale = Math.min((w * 0.88) / sprite.w, (h * 0.85) / sprite.h);
        const dw = sprite.w * scale;
        const dh = sprite.h * scale;
        ctx.drawImage(sprite.canvas, (w - dw) / 2, h * 0.9 - dh + bobY, dw, dh);
      } else {
        ctx.save();
        ctx.translate(w / 2, h * 0.72);
        drawSpecies(ctx, species, Math.min(w, h) * 0.42, t / 1000);
        ctx.restore();
      }
      if (float && !disposed) raf = requestAnimationFrame(draw);
    };

    // First paint immediately (vector fallback), repaint once sprites land.
    raf = requestAnimationFrame(draw);
    void loadSprites().then(() => {
      if (!disposed && !float) requestAnimationFrame(draw);
    });
    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
    };
  }, [species, hue, float]);

  return <canvas ref={ref} />;
}
