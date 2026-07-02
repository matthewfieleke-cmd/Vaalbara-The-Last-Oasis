import { useEffect, useRef, useState } from 'react';
import { drawSpecies } from '../render';
import type { SpeciesId } from '../types';

/**
 * The intro cinematic — a fully automated, skippable trailer.
 *
 * Structure (deliberately linear so the cast never feels shuffled):
 *   world -> the drought -> the prize -> FACTION A + its three champions ->
 *   FACTION B + its three champions -> the collision -> title.
 *
 * Every beat occupies a continuous segment of the timeline and owns exactly
 * one gentle opacity fade-in and fade-out (no letter-spacing or position
 * animation), so text never "reconfigures" — it breathes in, holds, and
 * breathes out while the parallax landscape scrolls beneath.
 */

interface Beat {
  at: number; // seconds — beat runs until the next beat's `at`
  title?: string;
  body?: string;
  flash?: { species: SpeciesId; hue: number; name: string; epithet: string };
  scene: 'ember' | 'ash' | 'water' | 'clash' | 'dawn';
}

const BEATS: Beat[] = [
  { at: 0.5, title: 'Vaalbara', body: 'Before the continents had names, there was only one land.', scene: 'ember' },
  { at: 9, title: 'The Great Drought', body: 'A hundred years without rain. The rivers turned to glass, then to dust.', scene: 'ash' },
  { at: 17.5, title: 'One Water Remains', body: 'A single pond, hidden in the last green place on Earth.', scene: 'water' },

  { at: 26, title: 'The Magma Vanguard', body: 'From the burning fissures marches the first coalition — six warlords of ash and appetite.', scene: 'clash' },
  { at: 34.5, flash: { species: 'trex', hue: 8, name: 'T-Rex', epithet: 'The Tyrant' }, scene: 'ember' },
  { at: 41.5, flash: { species: 'lion', hue: 35, name: 'Lion', epithet: 'The Commander' }, scene: 'ember' },
  { at: 48.5, flash: { species: 'eagle', hue: 20, name: 'Eagle', epithet: 'The Skyhunter' }, scene: 'ember' },

  { at: 55.5, title: 'The Oasis Syndicate', body: 'The green place raises its own guard — six keepers who will drown the world before they share it.', scene: 'water' },
  { at: 64, flash: { species: 'bear', hue: 25, name: 'Bear', epithet: 'The Warden' }, scene: 'water' },
  { at: 71, flash: { species: 'bighorn', hue: 90, name: 'Bighorn', epithet: 'The Comet' }, scene: 'water' },
  { at: 78, flash: { species: 'wolves', hue: 210, name: 'Wolves', epithet: 'The Pack' }, scene: 'water' },

  { at: 85, title: 'Two Armies. One Water.', body: 'First they must survive the Basalt Fields — black rock, sulfur, and rivers of fire.', scene: 'clash' },
  { at: 94, title: 'The Last Oasis', body: 'The drought ends today. One way or another.', scene: 'dawn' },
];

const TOTAL = 104;

const SCENE_HUES: Record<Beat['scene'], [number, number]> = {
  ember: [356, 18],
  ash: [270, 20],
  clash: [14, 45],
  water: [190, 160],
  dawn: [40, 150],
};

function beatDuration(i: number): number {
  return (i + 1 < BEATS.length ? BEATS[i + 1].at : TOTAL) - BEATS[i].at;
}

export function Cinematic({ onDone }: { onDone: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [beatIdx, setBeatIdx] = useState(-1);
  const doneRef = useRef(false);

  // Timeline clock — advances the active beat index.
  useEffect(() => {
    const start = performance.now();
    const iv = setInterval(() => {
      const t = (performance.now() - start) / 1000;
      let i = -1;
      for (let k = 0; k < BEATS.length; k++) if (t >= BEATS[k].at) i = k;
      setBeatIdx(i);
      if (t >= TOTAL && !doneRef.current) {
        doneRef.current = true;
        onDone();
      }
    }, 100);
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
    // Scene colours drift smoothly toward the active beat's palette.
    let curSky = SCENE_HUES.ember[0];
    let curGround = SCENE_HUES.ember[1];

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

      let active = BEATS[0];
      for (const b of BEATS) if (t >= b.at) active = b;
      const [skyT, groundT] = SCENE_HUES[active.scene];
      curSky += (skyT - curSky) * 0.012;
      curGround += (groundT - curGround) * 0.012;

      // Sky.
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, `hsl(${curSky} 45% 8%)`);
      g.addColorStop(0.6, `hsl(${(curSky + curGround) / 2} 50% 13%)`);
      g.addColorStop(1, `hsl(${curGround} 55% 7%)`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);

      // A giant slow sun / moon disc.
      const sun = ctx.createRadialGradient(W * 0.72, H * 0.3, 4, W * 0.72, H * 0.3, W * 0.3);
      sun.addColorStop(0, `hsla(${curSky + 30} 90% 62% / 0.85)`);
      sun.addColorStop(1, `hsla(${curSky + 30} 90% 55% / 0)`);
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
        ctx.fillStyle = `hsl(${curGround} ${38 - layer * 5}% ${5 + layer * 4}%)`;
        ctx.fill();
      }

      // Drifting embers / motes.
      for (let i = 0; i < 26; i++) {
        const px = ((i * 733 + t * (20 + (i % 5) * 9)) % (W + 40)) - 20;
        const py = H - (((i * 397 + t * (26 + (i % 3) * 12)) % H) * 0.9);
        const emberHue = active.scene === 'water' || active.scene === 'dawn' ? 150 : 24;
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

  const active = beatIdx >= 0 ? BEATS[beatIdx] : null;
  const dur = beatIdx >= 0 ? beatDuration(beatIdx) : 0;
  // One fade-in and one delayed fade-out spanning the beat's full life.
  const fadeStyle: React.CSSProperties = {
    animation: `cine-fade-in 1.1s ease-out both, cine-fade-out 1.1s ease-in ${Math.max(0.5, dur - 1.1)}s both`,
  };

  return (
    <div className="cinematic">
      <canvas ref={canvasRef} />
      {active && (active.title || active.body) ? (
        <div className="cine-text" key={beatIdx} style={fadeStyle}>
          {active.title && <h2>{active.title}</h2>}
          {active.body && <p>{active.body}</p>}
        </div>
      ) : null}
      {active?.flash ? (
        <div className="cine-card-flash" key={`f${beatIdx}`} style={fadeStyle}>
          <div className="cine-card" style={{ borderColor: `hsl(${active.flash.hue} 80% 60%)`, boxShadow: `0 0 60px hsl(${active.flash.hue} 90% 50% / 0.5)` }}>
            <FlashArt species={active.flash.species} hue={active.flash.hue} />
            <div className="cine-card-label">
              <span className="epithet">{active.flash.epithet}</span>
              <span className="name">{active.flash.name}</span>
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
      // Dramatic slow-turning rim light rays.
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2 + t * 0.18;
        ctx.strokeStyle = `hsla(${hue} 85% 65% / 0.09)`;
        ctx.lineWidth = 14;
        ctx.beginPath();
        ctx.moveTo(W / 2, H * 0.44);
        ctx.lineTo(W / 2 + Math.cos(a) * W, H * 0.44 + Math.sin(a) * W);
        ctx.stroke();
      }
      ctx.save();
      ctx.translate(W / 2, H * 0.6);
      const breathe = 1 + Math.sin(t * 1.4) * 0.02;
      ctx.scale(breathe, breathe);
      drawSpecies(ctx, species, W * 0.3, t);
      ctx.restore();
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [species, hue]);
  return <canvas ref={ref} style={{ width: '100%', height: '100%' }} />;
}
