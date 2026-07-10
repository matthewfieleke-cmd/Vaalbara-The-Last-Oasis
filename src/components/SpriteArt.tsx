import { useEffect, useRef } from 'react';
import type { SpeciesId } from '../types';
import { drawSpecies } from '../vector-art';
import { getAnim, getSprite, loadSprites } from '../sprites';

/** Per-species poster loop: intro parade when available, else battle run. */
const POSTER: Partial<Record<SpeciesId, { strip: 'intro' | 'run'; cps: number; flying?: boolean }>> = {
  trex: { strip: 'intro', cps: 0.42 },
  lion: { strip: 'intro', cps: 0.48 },
  eagle: { strip: 'intro', cps: 0.52, flying: true },
  honeybadger: { strip: 'intro', cps: 0.5 },
  scorpion: { strip: 'run', cps: 0.62 },
  fireants: { strip: 'run', cps: 0.7 },
  bear: { strip: 'intro', cps: 0.46 },
  bighorn: { strip: 'intro', cps: 0.5 },
  bees: { strip: 'intro', cps: 0.58, flying: true },
  wolves: { strip: 'intro', cps: 0.5 },
  porcupine: { strip: 'intro', cps: 0.52 },
  beetles: { strip: 'intro', cps: 0.48 },
};

const FPS_CAP = 30;

function smoothstep(t: number): number {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
}

/**
 * Painted character portrait on a themed gradient backdrop. When `live` is
 * true (default), the card breathes with a gentle poster-style gait loop —
 * Harry Potter moving-portrait energy, never bouncy or distracting.
 */
export function SpriteArt({
  species,
  hue,
  live = true,
}: {
  species: SpeciesId;
  hue: number;
  live?: boolean;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let raf = 0;
    let disposed = false;
    let lastPaint = 0;

    const draw = (now: number) => {
      if (disposed) return;
      if (live && lastPaint > 0 && now - lastPaint < 1000 / FPS_CAP) {
        raf = requestAnimationFrame(draw);
        return;
      }
      lastPaint = now;
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(1, Math.round(rect.width * dpr));
      const h = Math.max(1, Math.round(rect.height * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      const t = now / 1000;

      // Ambient backdrop drift — slow parallax wash, not on the character.
      const drift = Math.sin(t * 0.35) * w * 0.012;
      const g = ctx.createRadialGradient(w / 2 + drift, h * 0.32, 2, w / 2, h * 0.55, w * 0.85);
      g.addColorStop(0, `hsl(${hue} 58% 30%)`);
      g.addColorStop(0.6, `hsl(${hue} 52% 16%)`);
      g.addColorStop(1, `hsl(${hue} 42% 8%)`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);

      const cfg = POSTER[species] ?? { strip: 'run' as const, cps: 0.58 };
      const anim = getAnim(species);
      const intro = anim?.intro;
      const run = anim?.run;
      const frames = cfg.strip === 'intro' && intro && intro.length >= 4 ? intro : run;
      const sprite = !frames?.length ? getSprite(species) : null;

      if (frames && frames.length > 0) {
        const n = frames.length;
        const flying = cfg.flying ?? false;
        const phase = t * cfg.cps * n;
        const i0 = Math.floor(phase) % n;
        const frac = phase - Math.floor(phase);
        // Narrow blend window: holds each pose, eases into the next — smooth
        // without the double-leg overlap of a full-opacity crossfade.
        const blendStart = species === 'bighorn' ? 0.86 : 0.78;
        const mix = frac < blendStart ? 0 : smoothstep((frac - blendStart) / (1 - blendStart));
        const f0 = frames[i0];
        const f1 = frames[(i0 + 1) % n];
        const targetH = h * (flying ? 0.72 : 0.82);
        const scale0 = Math.min((w * 0.86) / f0.w, targetH / f0.h);
        const scale1 = Math.min((w * 0.86) / f1.w, targetH / f1.h);
        const bob = flying
          ? Math.sin(t * 1.6) * h * 0.008
          : Math.sin(t * cfg.cps * Math.PI * 2) * h * 0.004;
        const groundY = flying ? h * 0.58 : h * 0.9;
        const glow = ctx.createRadialGradient(w / 2, groundY, 1, w / 2, groundY, w * 0.38);
        glow.addColorStop(0, `hsla(${hue} 75% 50% / 0.28)`);
        glow.addColorStop(1, `hsla(${hue} 75% 50% / 0)`);
        ctx.fillStyle = glow;
        ctx.fillRect(0, h * 0.45, w, h * 0.55);
        const drawFrame = (f: typeof f0, scale: number, alpha: number) => {
          ctx.globalAlpha = alpha;
          const dw = f.canvas.width * scale;
          const dh = f.canvas.height * scale;
          ctx.drawImage(
            f.canvas,
            w / 2 - f.anchorX * scale,
            groundY - f.anchorY * scale + bob,
            dw,
            dh,
          );
        };
        ctx.globalAlpha = 1;
        drawFrame(f0, scale0, 1);
        if (mix > 0.02) drawFrame(f1, scale1, mix);
        ctx.globalAlpha = 1;
      } else if (sprite) {
        const bobY = live ? Math.sin(t * 1.4) * h * 0.006 : 0;
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
        drawSpecies(ctx, species, Math.min(w, h) * 0.42, t);
        ctx.restore();
      }

      if (live && !disposed) raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);
    void loadSprites().then(() => {
      if (!disposed) requestAnimationFrame(draw);
    });
    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
    };
  }, [species, hue, live]);

  return <canvas ref={ref} />;
}
