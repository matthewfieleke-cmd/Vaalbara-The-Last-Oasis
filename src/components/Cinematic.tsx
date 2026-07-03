import { useEffect, useRef, useState } from 'react';
import { drawSpecies } from '../vector-art';
import { getAnim, getPhaseArt } from '../sprites';
import { music, unlockAudio } from '../audio';
import type { SpeciesId } from '../types';

/**
 * The intro cinematic — tap-to-begin (which unlocks audio for the score),
 * then a fully automated ~80 s trailer: story beats and ALL TWELVE champions,
 * six per coalition, each shown as their ANIMATED run cycle over the actual
 * arena paintings scrolling as parallax backdrops. Skippable at any moment.
 */

interface Beat {
  at: number;
  title?: string;
  body?: string;
  hero?: { species: SpeciesId; hue: number; name: string; epithet: string };
  world: 'basalt' | 'oasis';
  braam?: boolean;
}

const HERO_TIME = 3.4;

function heroBeats(at: number, world: 'basalt' | 'oasis', heroes: Beat['hero'][]): Beat[] {
  return heroes.map((hero, i) => ({ at: at + i * HERO_TIME, hero, world }));
}

const BEATS: Beat[] = [
  { at: 0.4, title: 'Vaalbara', body: 'One land. One water. And a hundred years of drought.', world: 'basalt', braam: true },
  { at: 7.4, title: 'The Last Oasis', body: 'A single pond survives, hidden in the last green place on Earth.', world: 'oasis' },

  { at: 14.4, title: 'The Magma Vanguard', body: 'From the burning fissures, six warlords march.', world: 'basalt', braam: true },
  ...heroBeats(20.4, 'basalt', [
    { species: 'trex', hue: 8, name: 'T-Rex', epithet: 'The Tyrant' },
    { species: 'lion', hue: 35, name: 'Lion', epithet: 'The Commander' },
    { species: 'eagle', hue: 20, name: 'Eagle', epithet: 'The Skyhunter' },
    { species: 'honeybadger', hue: 45, name: 'Honey Badger', epithet: 'The Grudge' },
    { species: 'scorpion', hue: 285, name: 'Scorpion', epithet: 'The Flanker' },
    { species: 'fireants', hue: 15, name: 'Fire Ants', epithet: 'The Crawling Pyre' },
  ]),

  { at: 41.2, title: 'The Oasis Syndicate', body: 'The green place raises six keepers of the water.', world: 'oasis', braam: true },
  ...heroBeats(47.2, 'oasis', [
    { species: 'bear', hue: 140, name: 'Bear', epithet: 'The Warden' },
    { species: 'bighorn', hue: 90, name: 'Bighorn', epithet: 'The Comet' },
    { species: 'bees', hue: 50, name: 'Bees', epithet: 'The Humming Veil' },
    { species: 'wolves', hue: 210, name: 'Wolves', epithet: 'The Pack' },
    { species: 'porcupine', hue: 160, name: 'Porcupine', epithet: 'The Needles' },
    { species: 'beetles', hue: 130, name: 'Beetle', epithet: 'The Artillery' },
  ]),

  { at: 68, title: 'Two Armies. One Water.', body: 'Cross the lava. Hold the pond. History remembers one coalition.', world: 'basalt', braam: true },
  { at: 75, title: 'Vaalbara', body: 'The drought ends today.', world: 'oasis', braam: true },
];

const TOTAL = 82;

export function Cinematic({ onDone }: { onDone: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [started, setStarted] = useState(false);
  const [beatIdx, setBeatIdx] = useState(-1);
  const doneRef = useRef(false);
  const startedRef = useRef(false);
  startedRef.current = started;
  const firedBraam = useRef(new Set<number>());

  const begin = () => {
    unlockAudio();
    music.start();
    music.setMode('intro');
    music.setIntensity(0.55);
    music.braam(73.4, 2.2, 0.55);
    setStarted(true);
  };

  const finish = () => {
    if (doneRef.current) return;
    doneRef.current = true;
    music.setMode('menu');
    music.setIntensity(0.3);
    onDone();
  };

  // Timeline clock.
  useEffect(() => {
    if (!started) return;
    const start = performance.now();
    const iv = setInterval(() => {
      const t = (performance.now() - start) / 1000;
      let i = -1;
      for (let k = 0; k < BEATS.length; k++) if (t >= BEATS[k].at) i = k;
      setBeatIdx(i);
      if (i >= 0 && BEATS[i].braam && !firedBraam.current.has(i)) {
        firedBraam.current.add(i);
        music.braam(BEATS[i].world === 'oasis' ? 110 : 73.4, 1.9, 0.5);
      }
      if (t >= TOTAL) finish();
    }, 100);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [started]);

  // Painter: arena paintings as scrolling parallax + animated hero.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let raf = 0;
    const start = performance.now();
    let worldBlend = 0; // 0 = basalt, 1 = oasis

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

      let active: Beat = BEATS[0];
      if (startedRef.current) {
        for (const b of BEATS) if (t >= b.at) active = b;
      }
      worldBlend += ((active.world === 'oasis' ? 1 : 0) - worldBlend) * 0.02;

      // Base wash.
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, `hsl(${356 + worldBlend * -188} 45% 8%)`);
      g.addColorStop(1, `hsl(${18 + worldBlend * 132} 55% 7%)`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);

      // The arena paintings scroll slowly as the cinematic backdrop —
      // crossfading between worlds as the story moves.
      const drawArena = (img: HTMLImageElement | null, alpha: number, dir: number) => {
        if (!img || alpha <= 0.01) return;
        ctx.save();
        ctx.globalAlpha = alpha;
        const scale = (W * 1.25) / img.naturalWidth;
        const ih = img.naturalHeight * scale;
        const drift = ((t * 14 * dir) % (ih * 0.4));
        const y0 = -ih * 0.2 + drift - H * 0.1;
        ctx.drawImage(img, (W - img.naturalWidth * scale) / 2, y0, img.naturalWidth * scale, ih);
        ctx.restore();
      };
      drawArena(getPhaseArt('basalt'), (1 - worldBlend) * 0.85, 1);
      drawArena(getPhaseArt('oasis'), worldBlend * 0.85, -1);

      // Depth wash so text and heroes pop over the busy paintings.
      const wash = ctx.createRadialGradient(W / 2, H * 0.5, H * 0.1, W / 2, H * 0.55, H * 0.75);
      wash.addColorStop(0, 'rgba(0,0,0,0.14)');
      wash.addColorStop(1, 'rgba(0,0,0,0.68)');
      ctx.fillStyle = wash;
      ctx.fillRect(0, 0, W, H);

      // Drifting embers / motes.
      for (let i = 0; i < 24; i++) {
        const px = ((i * 733 + t * (20 + (i % 5) * 9)) % (W + 40)) - 20;
        const py = H - (((i * 397 + t * (26 + (i % 3) * 12)) % H) * 0.9);
        const hue = worldBlend > 0.5 ? 150 : 24;
        ctx.fillStyle = `hsla(${hue} 95% 62% / ${0.2 + (i % 4) * 0.1})`;
        ctx.beginPath();
        ctx.arc(px, py, 1 + (i % 3), 0, Math.PI * 2);
        ctx.fill();
      }

      // The animated hero: run-cycle frames striding in place.
      if (startedRef.current && active.hero) {
        const anim = getAnim(active.hero.species);
        const beatT = t - active.at;
        const cx = W / 2;
        const cy = H * 0.56;
        // Ground glow.
        const glow = ctx.createRadialGradient(cx, cy + H * 0.07, 4, cx, cy + H * 0.07, W * 0.34);
        glow.addColorStop(0, `hsla(${active.hero.hue} 85% 55% / 0.4)`);
        glow.addColorStop(1, `hsla(${active.hero.hue} 85% 50% / 0)`);
        ctx.fillStyle = glow;
        ctx.fillRect(0, cy - H * 0.1, W, H * 0.3);
        if (anim) {
          const frames = anim.run;
          const frame = frames[Math.floor(beatT * 9) % frames.length];
          const targetH = H * 0.3;
          const scale = targetH / frame.h;
          const dw = frame.canvas.width * scale;
          const dh = frame.canvas.height * scale;
          ctx.save();
          ctx.shadowColor = `hsl(${active.hero.hue} 90% 55%)`;
          ctx.shadowBlur = 34;
          // Slight bob with the stride.
          const bob = Math.abs(Math.sin(beatT * 9 * Math.PI * 0.5)) * -6;
          ctx.drawImage(frame.canvas, cx - frame.anchorX * scale, cy + H * 0.07 - frame.anchorY * scale + bob, dw, dh);
          ctx.restore();
        } else {
          ctx.save();
          ctx.translate(cx, cy);
          drawSpecies(ctx, active.hero.species, W * 0.16, t);
          ctx.restore();
        }
      }

      // Letterbox.
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, W, H * 0.085);
      ctx.fillRect(0, H * 0.915, W, H * 0.085);

      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  const active = started && beatIdx >= 0 ? BEATS[beatIdx] : null;
  const dur = active
    ? (beatIdx + 1 < BEATS.length ? BEATS[beatIdx + 1].at : TOTAL) - active.at
    : 0;
  const fadeStyle: React.CSSProperties = {
    animation: `cine-fade-in 0.8s ease-out both, cine-fade-out 0.8s ease-in ${Math.max(0.4, dur - 0.8)}s both`,
  };

  return (
    <div className="cinematic">
      <canvas ref={canvasRef} />
      {!started && (
        <button className="tap-to-begin" onClick={begin}>
          <span className="ember-dot" />
          <b>TAP TO BEGIN</b>
          <span className="hint">headphones recommended</span>
        </button>
      )}
      {active && (active.title || active.body) ? (
        <div className="cine-text" key={beatIdx} style={fadeStyle}>
          {active.title && <h2>{active.title}</h2>}
          {active.body && <p>{active.body}</p>}
        </div>
      ) : null}
      {active?.hero ? (
        <div className="cine-hero-label" key={`h${beatIdx}`} style={fadeStyle}>
          <span className="epithet">{active.hero.epithet}</span>
          <span className="name">{active.hero.name}</span>
        </div>
      ) : null}
      {started && (
        <button className="skip-btn" onClick={finish}>
          Skip intro ▸
        </button>
      )}
    </div>
  );
}
