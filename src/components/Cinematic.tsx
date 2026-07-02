import { useEffect, useRef, useState } from 'react';
import { drawSpecies } from '../render';
import type { SpeciesId } from '../types';

/**
 * The intro cinematic — a fully automated, skippable ~2 minute trailer.
 * Scrolling parallax vector landscapes, dramatic character card flashes and
 * beautifully timed text overlays, all procedural.
 */

interface Beat {
  at: number; // seconds
  dur: number;
  title?: string;
  body?: string;
  flash?: { species: SpeciesId; hue: number; name: string };
  /** Scene palette hue drift for the parallax backdrop. */
  scene: 'ember' | 'ash' | 'clash' | 'water' | 'dawn';
}

const BEATS: Beat[] = [
  { at: 0.5, dur: 7, title: 'Vaalbara', body: 'Before the continents had names, there was only one land. And it was dying.', scene: 'ember' },
  { at: 8, dur: 7, title: 'The Great Drought', body: 'A hundred years without rain. The rivers turned to glass, then to dust.', scene: 'ash' },
  { at: 15.5, dur: 7, body: 'The volcanoes awoke, promising fire to those bold enough to claim it.', scene: 'ember' },
  { at: 23, dur: 6.5, flash: { species: 'trex', hue: 8, name: 'The Tyrant' }, scene: 'ember' },
  { at: 30, dur: 6.5, flash: { species: 'lion', hue: 35, name: 'The Commander' }, scene: 'ember' },
  { at: 37, dur: 7, title: 'The Magma Vanguard', body: 'Six warlords of ash and appetite, sworn to burn their way to the water.', scene: 'clash' },
  { at: 44.5, dur: 6.5, flash: { species: 'bear', hue: 25, name: 'The Warden' }, scene: 'water' },
  { at: 51.5, dur: 6.5, flash: { species: 'bighorn', hue: 90, name: 'The Comet' }, scene: 'water' },
  { at: 58.5, dur: 7, title: 'The Oasis Syndicate', body: 'Six guardians of the last green place, who will drown the world before they share it.', scene: 'water' },
  { at: 66, dur: 8, body: 'Rumour speaks of one pond that never dried. One oasis. The last.', scene: 'water' },
  { at: 74.5, dur: 8, title: 'Two Armies', body: 'First they must cross the Basalt Fields — black rock, sulfur, and rivers of fire.', scene: 'clash' },
  { at: 83, dur: 8, body: 'Only the survivors of the crossing will stand at the water\u2019s edge.', scene: 'ash' },
  { at: 91.5, dur: 8, title: 'The Last Oasis', body: 'Hold the pond. Outlast the storm. History will remember one coalition.', scene: 'dawn' },
  { at: 100.5, dur: 9, title: 'Vaalbara', body: 'The drought ends today. One way or another.', scene: 'dawn' },
];

const TOTAL = 112;

const SCENE_HUES: Record<Beat['scene'], [number, number]> = {
  ember: [356, 18],
  ash: [270, 20],
  clash: [14, 45],
  water: [190, 160],
  dawn: [40, 150],
};

export function Cinematic({ onDone }: { onDone: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [elapsed, setElapsed] = useState(0);
  const doneRef = useRef(false);

  // Timeline clock.
  useEffect(() => {
    const start = performance.now();
    const iv = setInterval(() => {
      const t = (performance.now() - start) / 1000;
      setElapsed(t);
      if (t >= TOTAL && !doneRef.current) {
        doneRef.current = true;
        onDone();
      }
    }, 120);
    return () => clearInterval(iv);
  }, [onDone]);

  // Parallax landscape painter.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let raf = 0;
    const start = performance.now();

    const frame = () => {
      const t = (performance.now() - start) / 1000;
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const W = Math.max(1, Math.round(rect.width * dpr));
      const H = Math.max(1, Math.round(rect.height * dpr));
      if (canvas.width !== W || canvas.height !== H) {
        canvas.width = W;
        canvas.height = H;
      }

      const beat = [...BEATS].reverse().find((b) => t >= b.at) ?? BEATS[0];
      const [skyHue, groundHue] = SCENE_HUES[beat.scene];

      // Sky.
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, `hsl(${skyHue} 45% 8%)`);
      g.addColorStop(0.6, `hsl(${(skyHue + groundHue) / 2} 50% 13%)`);
      g.addColorStop(1, `hsl(${groundHue} 55% 7%)`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);

      // A giant slow sun / moon disc.
      const sun = ctx.createRadialGradient(W * 0.72, H * 0.3, 4, W * 0.72, H * 0.3, W * 0.3);
      sun.addColorStop(0, `hsla(${skyHue + 30} 90% 62% / 0.85)`);
      sun.addColorStop(1, `hsla(${skyHue + 30} 90% 55% / 0)`);
      ctx.fillStyle = sun;
      ctx.fillRect(0, 0, W, H);

      // Parallax ridges scrolling at different speeds.
      for (let layer = 0; layer < 4; layer++) {
        const speed = 8 + layer * 14;
        const y0 = H * (0.42 + layer * 0.13);
        ctx.beginPath();
        ctx.moveTo(0, H);
        for (let x = 0; x <= W; x += 10) {
          const wx = x + t * speed;
          const n =
            Math.sin(wx * 0.006 + layer * 7.3) * 36 +
            Math.sin(wx * 0.017 + layer * 2.1) * 18 +
            Math.sin(wx * 0.045 + layer) * 7;
          ctx.lineTo(x, y0 + n);
        }
        ctx.lineTo(W, H);
        ctx.closePath();
        ctx.fillStyle = `hsl(${groundHue} ${38 - layer * 5}% ${5 + layer * 4}%)`;
        ctx.fill();
      }

      // Drifting embers / motes.
      for (let i = 0; i < 26; i++) {
        const px = ((i * 733 + t * (20 + (i % 5) * 9)) % (W + 40)) - 20;
        const py = H - (((i * 397 + t * (26 + (i % 3) * 12)) % H) * 0.9);
        const emberHue = beat.scene === 'water' || beat.scene === 'dawn' ? 150 : 24;
        ctx.fillStyle = `hsla(${emberHue} 95% 62% / ${0.24 + (i % 4) * 0.12})`;
        ctx.beginPath();
        ctx.arc(px, py, 1 + (i % 3), 0, Math.PI * 2);
        ctx.fill();
      }

      // Letterbox bars for cinema feel.
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, W, H * 0.085);
      ctx.fillRect(0, H * 0.915, W, H * 0.085);

      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  const active = BEATS.find((b) => elapsed >= b.at && elapsed < b.at + b.dur);

  return (
    <div className="cinematic">
      <canvas ref={canvasRef} />
      {active?.title || active?.body ? (
        <div className="cine-text" key={active.at}>
          {active.title && <h2>{active.title}</h2>}
          {active.body && <p>{active.body}</p>}
        </div>
      ) : null}
      {active?.flash ? (
        <div className="cine-card-flash" key={`f${active.at}`}>
          <div style={{ width: 'min(58vw, 260px)', aspectRatio: '0.72', borderRadius: 18, overflow: 'hidden', border: `2px solid hsl(${active.flash.hue} 80% 60%)`, boxShadow: `0 0 60px hsl(${active.flash.hue} 90% 50% / 0.55)`, position: 'relative' }}>
            <FlashArt species={active.flash.species} hue={active.flash.hue} />
            <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: '0.9rem', textAlign: 'center', background: 'linear-gradient(transparent, rgba(0,0,0,0.9))', fontWeight: 900, letterSpacing: '0.2em', textTransform: 'uppercase', fontSize: '0.95rem' }}>
              {active.flash.name}
            </div>
          </div>
        </div>
      ) : null}
      <button className="skip-btn" onClick={() => { doneRef.current = true; onDone(); }}>
        Skip intro ▸
      </button>
    </div>
  );
}

function FlashArt({ species, hue }: { species: SpeciesId; hue: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let raf = 0;
    const start = performance.now();
    const frame = () => {
      const t = (performance.now() - start) / 1000;
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const W = Math.max(1, Math.round(rect.width * dpr));
      const H = Math.max(1, Math.round(rect.height * dpr));
      if (canvas.width !== W || canvas.height !== H) {
        canvas.width = W;
        canvas.height = H;
      }
      const g = ctx.createRadialGradient(W / 2, H * 0.34, 4, W / 2, H * 0.5, W);
      g.addColorStop(0, `hsl(${hue} 70% 34%)`);
      g.addColorStop(1, `hsl(${hue} 55% 8%)`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      // Dramatic rim light rays.
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2 + t * 0.24;
        ctx.strokeStyle = `hsla(${hue} 85% 65% / 0.1)`;
        ctx.lineWidth = 14;
        ctx.beginPath();
        ctx.moveTo(W / 2, H * 0.44);
        ctx.lineTo(W / 2 + Math.cos(a) * W, H * 0.44 + Math.sin(a) * W);
        ctx.stroke();
      }
      ctx.save();
      ctx.translate(W / 2, H * 0.62);
      drawSpecies(ctx, species, W * 0.3, t);
      ctx.restore();
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [species, hue]);
  return <canvas ref={ref} style={{ width: '100%', height: '100%' }} />;
}
