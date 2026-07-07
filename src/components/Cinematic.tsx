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

const HERO_TIME = 3.6;
/** Shared fade envelope (seconds) — the DOM titles and the canvas hero use
 *  the exact same ramps so a champion and its name always move together. */
const FADE = 0.55;

/** Per-species hero size (× of the base 30%-of-screen height). Frames crop
 *  differently, so a flat size lets busy frames (wolf) swallow the screen. */
const HERO_SCALE: Partial<Record<SpeciesId, number>> = {
  trex: 1.06,
  bear: 1.04,
  eagle: 0.94,
  honeybadger: 0.9,
  scorpion: 0.92,
  fireants: 0.72,
  bees: 0.82,
  wolves: 0.76,
  porcupine: 0.9,
  beetles: 0.86,
};

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

  { at: 42.4, title: 'The Oasis Syndicate', body: 'The green place raises six keepers of the water.', world: 'oasis', braam: true },
  ...heroBeats(48.4, 'oasis', [
    { species: 'bear', hue: 140, name: 'Bear', epithet: 'The Warden' },
    { species: 'bighorn', hue: 90, name: 'Bighorn', epithet: 'The Comet' },
    { species: 'bees', hue: 50, name: 'Bees', epithet: 'The Humming Veil' },
    { species: 'wolves', hue: 210, name: 'Wolves', epithet: 'The Pack' },
    { species: 'porcupine', hue: 160, name: 'Porcupine', epithet: 'The Needles' },
    { species: 'beetles', hue: 130, name: 'Beetle', epithet: 'The Artillery' },
  ]),

  { at: 70.5, title: 'Two Armies. One Water.', body: 'Cross the lava. Hold the pond. History remembers one coalition.', world: 'basalt', braam: true },
  { at: 77.5, title: 'Vaalbara', body: 'The drought ends today.', world: 'oasis', braam: true },
];

const TOTAL = 84;

export function Cinematic({ onDone }: { onDone: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [started, setStarted] = useState(false);
  const [beatIdx, setBeatIdx] = useState(-1);
  const doneRef = useRef(false);
  // THE shared timeline clock: set once at tap, read by both the DOM titles
  // and the canvas painter, so heroes and their names can never drift apart.
  const startRef = useRef<number | null>(null);
  const firedBraam = useRef(new Set<number>());

  const begin = () => {
    unlockAudio();
    music.start();
    music.setMode('intro');
    music.setIntensity(0.55);
    music.braam(73.4, 2.2, 0.55);
    startRef.current = performance.now();
    setStarted(true);
  };

  const finish = () => {
    if (doneRef.current) return;
    doneRef.current = true;
    music.setMode('menu');
    music.setIntensity(0.3);
    onDone();
  };

  // Timeline clock (reads the same startRef the canvas uses).
  useEffect(() => {
    if (!started) return;
    const iv = setInterval(() => {
      if (startRef.current === null) return;
      const t = (performance.now() - startRef.current) / 1000;
      let i = -1;
      for (let k = 0; k < BEATS.length; k++) if (t >= BEATS[k].at) i = k;
      setBeatIdx(i);
      if (i >= 0 && BEATS[i].braam && !firedBraam.current.has(i)) {
        firedBraam.current.add(i);
        music.braam(BEATS[i].world === 'oasis' ? 110 : 73.4, 1.9, 0.5);
      }
      if (t >= TOTAL) finish();
    }, 50);
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
    let worldBlend = 0; // 0 = basalt, 1 = oasis
    let lastNow = performance.now();

    const frame = () => {
      const now = performance.now();
      const dt = Math.min(0.1, (now - lastNow) / 1000);
      lastNow = now;
      // Ambient clock (pre-tap drift) vs the SHARED timeline clock (post-tap).
      const ambient = now / 1000;
      const t = startRef.current !== null ? (now - startRef.current) / 1000 : -1;
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const W = Math.max(1, Math.round(rect.width * dpr));
      const H = Math.max(1, Math.round(rect.height * dpr));
      if (canvas.width !== W || canvas.height !== H) {
        canvas.width = W;
        canvas.height = H;
      }

      let active: Beat = BEATS[0];
      let activeIdx = 0;
      if (t >= 0) {
        for (let i = 0; i < BEATS.length; i++) {
          if (t >= BEATS[i].at) {
            active = BEATS[i];
            activeIdx = i;
          }
        }
      }
      worldBlend += ((active.world === 'oasis' ? 1 : 0) - worldBlend) * Math.min(1, dt * 2.4);

      // Base wash.
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, `hsl(${356 + worldBlend * -188} 45% 8%)`);
      g.addColorStop(1, `hsl(${18 + worldBlend * 132} 55% 7%)`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);

      // The arena paintings drift slowly as the cinematic backdrop —
      // crossfading between worlds as the story moves. COVER-fit: scale to
      // whichever axis is binding (plus drift margin) so the painting always
      // fills the whole screen on any aspect ratio.
      const drawArena = (img: HTMLImageElement | null, alpha: number, dir: number) => {
        if (!img || alpha <= 0.01) return;
        ctx.save();
        ctx.globalAlpha = alpha;
        const scale = Math.max((W * 1.12) / img.naturalWidth, (H * 1.18) / img.naturalHeight);
        const iw = img.naturalWidth * scale;
        const ih = img.naturalHeight * scale;
        // Seamless slow drift: a bounded sine, never a wrapping jump.
        const margin = Math.max(0, (ih - H) / 2);
        const drift = Math.sin(ambient * 0.11 * dir + dir * 2.1) * margin * 0.85;
        ctx.drawImage(img, (W - iw) / 2, (H - ih) / 2 + drift, iw, ih);
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
        const px = ((i * 733 + ambient * (20 + (i % 5) * 9)) % (W + 40)) - 20;
        const py = H - (((i * 397 + ambient * (26 + (i % 3) * 12)) % H) * 0.9);
        const hue = worldBlend > 0.5 ? 150 : 24;
        ctx.fillStyle = `hsla(${hue} 95% 62% / ${0.2 + (i % 4) * 0.1})`;
        ctx.beginPath();
        ctx.arc(px, py, 1 + (i % 3), 0, Math.PI * 2);
        ctx.fill();
      }

      // The animated hero: run-cycle frames striding in place, fading in and
      // out on the exact same envelope as its DOM title card.
      if (t >= 0 && active.hero) {
        const anim = getAnim(active.hero.species);
        const beatT = t - active.at;
        const beatDur = (activeIdx + 1 < BEATS.length ? BEATS[activeIdx + 1].at : TOTAL) - active.at;
        const heroAlpha = Math.max(0, Math.min(
          1,
          beatT / FADE,                      // fade in
          (beatDur - beatT) / FADE,          // fade out
        ));
        const rise = (1 - Math.min(1, beatT / FADE)) * H * 0.012;
        const cx = W / 2;
        const cy = H * 0.56 + rise;
        ctx.save();
        ctx.globalAlpha = heroAlpha;
        // Ground glow.
        const glow = ctx.createRadialGradient(cx, cy + H * 0.07, 4, cx, cy + H * 0.07, W * 0.34);
        glow.addColorStop(0, `hsla(${active.hero.hue} 85% 55% / 0.4)`);
        glow.addColorStop(1, `hsla(${active.hero.hue} 85% 50% / 0)`);
        ctx.fillStyle = glow;
        ctx.fillRect(0, cy - H * 0.1, W, H * 0.3);
        if (anim) {
          // Prefer the dedicated 8-frame parade cycle (twice the poses of
          // the battle sheets) — each crossfade then covers a much smaller
          // motion step, which is what reads as film-smooth.
          const frames = anim.intro && anim.intro.length >= 6 ? anim.intro : anim.run;
          const n = frames.length;
          const flying = active.hero.species === 'eagle' || active.hero.species === 'bees';
          const cps = flying ? 0.8 : 0.62; // full gait cycles per second
          const phase = beatT * cps * n;
          const i0 = Math.floor(phase) % n;
          const frac = phase - Math.floor(phase);
          const mix = frac * frac * (3 - 2 * frac);
          const targetH = H * 0.3 * (HERO_SCALE[active.hero.species] ?? 1);
          // No glow on the hero: a canvas shadow re-renders for BOTH
          // crossfade layers, so its intensity pumps with the blend and
          // reads as flicker around the silhouette.
          ctx.shadowBlur = 0;
          // Smooth, continuous bob: gentle hover for flyers, a soft rolling
          // stride-sway for walkers (two beats per stride cycle).
          const bob = flying
            ? Math.sin(beatT * 2.4) * H * 0.006
            : Math.sin(beatT * cps * Math.PI * 4) * -H * 0.003;
          // ONE scale for the whole cycle. Per-frame width clamps made the
          // hero visibly bump each time the crop width changed; instead
          // clamp against the widest frame of the set so scale never moves.
          const maxW = Math.max(...frames.map((f) => f.w));
          const scale = Math.min(targetH / frames[0].h, (W * 0.78) / maxW);
          // Walkers anchor at their feet on the ground line; flyers anchor
          // at their stabilised point (head/centre) hovering above it.
          const anchorLineY = flying && frames === anim.intro ? cy - H * 0.03 : cy + H * 0.07;
          const drawHero = (f: typeof frames[number], alpha: number) => {
            ctx.globalAlpha = heroAlpha * alpha;
            ctx.drawImage(
              f.canvas,
              cx - f.anchorX * scale,
              anchorLineY - f.anchorY * scale + bob,
              f.canvas.width * scale,
              f.canvas.height * scale,
            );
          };
          // Duels-style non-dipping crossfade: base frame fully opaque, next
          // frame fading in OVER it — coverage never drops, so no flicker.
          drawHero(frames[i0], 1);
          if (mix > 0.02) drawHero(frames[(i0 + 1) % n], mix);
        } else {
          ctx.translate(cx, cy);
          drawSpecies(ctx, active.hero.species, W * 0.16, t);
        }
        ctx.restore();
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
  // Same FADE envelope as the canvas hero — titles land WITH their champion.
  const fadeStyle: React.CSSProperties = {
    animation: `cine-fade-in ${FADE}s ease-out both, cine-fade-out ${FADE}s ease-in ${Math.max(0.2, dur - FADE)}s both`,
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
