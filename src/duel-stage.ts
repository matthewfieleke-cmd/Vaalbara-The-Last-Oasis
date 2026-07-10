/* ============================================================================
 * VAALBARA — duel-stage.ts
 * The Duels battle stage: a cinematic side-view canvas where two champions
 * face off in front of a painted battlefield. The stage consumes the ordered
 * DuelEvent script produced by duel.ts and choreographs it — wind-ups,
 * dashes, hit-stop impacts, screen shake, special-move auras, knockback
 * skids, status banners and KO collapses.
 * ========================================================================== */

import type { SpeciesId } from './types';
import type { DuelEvent, DuelSide } from './duel';
import { getAnim, getDuelArt, getSprite } from './sprites';
import type { Sprite } from './sprites';

export type DuelWorld = 'basalt' | 'oasis';

/** Relative draw height per species (fraction of stage height). */
const DUEL_SCALE: Partial<Record<SpeciesId, number>> = {
  trex: 1.32,
  bear: 1.26,
  lion: 1.05,
  bighorn: 1.05,
  honeybadger: 0.82,
  scorpion: 0.78,
  eagle: 0.9,
  wolves: 0.92,
  porcupine: 0.85,
  beetles: 0.72,
  fireants: 0.55,
  bees: 0.72,
};

const FLYERS = new Set<SpeciesId>(['eagle', 'bees']);

interface FighterVis {
  species: SpeciesId;
  name: string;
  hue: number;
  /** Bombardier special: turned rear-to-foe, venting the acid jet. */
  spray?: boolean;
  /** Home anchor as a fraction of stage width. */
  homeX: number;
  face: 1 | -1;
  /** Live offsets in px from the home anchor. */
  x: number;
  y: number;
  rot: number;
  alpha: number;
  squash: number;
  /** Special aura envelope 0–1. */
  aura: number;
  /** Damage tint flash 0–1 and its hue. */
  tint: number;
  tintHue: number;
  mode: 'idle' | 'dash' | 'attack' | 'guard' | 'evade' | 'ko' | 'gone';
  animT: number;
  runPhase: number;
  guarding: boolean;
  /** Recent positions for special-dash afterimages. */
  trail: { x: number; y: number }[];
}

interface Particle {
  x: number; y: number; vx: number; vy: number;
  life: number; t: number; size: number; hue: number;
  kind: 'spark' | 'dust' | 'ember' | 'mote' | 'ring' | 'charge' | 'shock' | 'line' | 'glob';
  /** 'line': ray angle. 'charge': orbit angle around its target. */
  ang?: number;
  /** 'charge': the side whose champion is charging (follows the fighter). */
  side?: DuelSide;
}

/* --------------------------------------------------------------------------
 * Living backdrop — cinemagraph flow.
 * The paintings are single flattened images, so "real" motion is faked the
 * way film cinemagraphs do it: inside hand-mapped regions (the waterfalls,
 * the lava falls, the pond) the painting's OWN pixels scroll downward on a
 * loop — two phase-staggered copies crossfading so the seam never shows —
 * behind feathered edges. Everything outside the regions stays pixel-
 * identical to the original painting.
 * ------------------------------------------------------------------------ */

interface FlowRegionDef {
  /** Region in normalized image coordinates. */
  x: number; y: number; w: number; h: number;
  /** 'fall': material pours downward. 'ripple': surface shimmers in place. */
  kind: 'fall' | 'ripple';
  /** Loop speed (cycles/s for falls, wave speed for ripples). */
  speed: number;
  /** Ripple horizontal displacement, as a fraction of region width. */
  amp?: number;
}

const FLOW_REGIONS: Record<DuelWorld, FlowRegionDef[]> = {
  basalt: [
    // Middle-distance lava cascades, left to right.
    { x: 0.255, y: 0.42, w: 0.095, h: 0.27, kind: 'fall', speed: 0.30 },
    { x: 0.445, y: 0.385, w: 0.115, h: 0.30, kind: 'fall', speed: 0.34 },
    { x: 0.575, y: 0.39, w: 0.095, h: 0.25, kind: 'fall', speed: 0.30 },
    { x: 0.715, y: 0.39, w: 0.085, h: 0.23, kind: 'fall', speed: 0.27 },
    // Molten pool at the base of the central cascade — slow lateral churn.
    { x: 0.365, y: 0.625, w: 0.28, h: 0.065, kind: 'ripple', speed: 0.5, amp: 0.005 },
  ],
  oasis: [
    // The tall thin falls under the left tree line.
    { x: 0.272, y: 0.19, w: 0.05, h: 0.37, kind: 'fall', speed: 0.5 },
    // Left main cascade into the pond.
    { x: 0.295, y: 0.405, w: 0.105, h: 0.165, kind: 'fall', speed: 0.55 },
    // Center falls beneath the temple.
    { x: 0.465, y: 0.295, w: 0.065, h: 0.265, kind: 'fall', speed: 0.5 },
    { x: 0.515, y: 0.445, w: 0.095, h: 0.125, kind: 'fall', speed: 0.55 },
    // Right cascades.
    { x: 0.67, y: 0.425, w: 0.065, h: 0.145, kind: 'fall', speed: 0.5 },
    { x: 0.745, y: 0.265, w: 0.055, h: 0.165, kind: 'fall', speed: 0.42 },
    // The pond surface — a subtle refractive shimmer.
    { x: 0.285, y: 0.548, w: 0.505, h: 0.068, kind: 'ripple', speed: 0.8, amp: 0.006 },
  ],
};

interface FlowRegion {
  def: FlowRegionDef;
  /** Feathered crop of the painting (source-resolution pixels). */
  canvas: HTMLCanvasElement;
  phase: number;
}

interface FloatText {
  x: number; y: number; txt: string; hue: number; t: number; big: boolean;
  /** Extra font scale — sublabels like BLOCKED render smaller. */
  scale?: number;
}

interface Banner {
  txt: string; sub?: string; t: number; dur: number; hue: number;
}

interface Step {
  ev: DuelEvent;
  t: number;
  dur: number;
  fired: Set<string>;
}

const easeOut = (t: number): number => 1 - (1 - t) * (1 - t);
const easeIn = (t: number): number => t * t;
const clamp01 = (t: number): number => Math.max(0, Math.min(1, t));
/** Phase-local normalized time. */
const ph = (t: number, a: number, b: number): number => clamp01((t - a) / (b - a));

export class DuelStage {
  private ctx: CanvasRenderingContext2D;
  private raf = 0;
  private last = 0;
  private time = 0;
  private W = 1;
  private H = 1;
  private dpr = 1;

  private fighters: [FighterVis | null, FighterVis | null] = [null, null];
  private queue: Step[] = [];
  private freeze = 0;
  private shake = 0;
  private flash = 0;
  private flashHue = 0;
  private vignette = 0;
  private particles: Particle[] = [];
  private texts: FloatText[] = [];
  private banner: Banner | null = null;
  private disposed = false;
  /** Offscreen scratch for silhouette-clipped tint flashes. */
  private scratch = document.createElement('canvas');

  /* Living backdrop: cinemagraph flow regions cut from the painting. */
  private flowRegions: FlowRegion[] = [];
  private flowBuilt = false;

  /* Special-move cinematography. */
  private letterbox = 0;
  private slowmo = 0;
  private zoom = 1;
  private zoomTarget = 1;
  private zoomCX = 0.5;
  private zoomCY = 0.6;

  /** Bottom edge of the DOM HUD cards, as a fraction of canvas height.
   *  Ribbon and floating texts are kept below this line. */
  private hudBottom = 0.19;

  /** Pairing auto-fit: shrinks both champions when their combined sprite
   *  width would crowd the arena, so tails never clip and a clear gap
   *  always separates the opponents. Eased for smooth swaps. */
  private fitScale = 1;

  setHudBottom(frac: number): void {
    if (Number.isFinite(frac)) this.hudBottom = Math.min(0.42, Math.max(0.1, frac));
  }

  /** Fires the moment an event's numbers should hit the HUD. */
  onEventApplied: ((ev: DuelEvent) => void) | null = null;
  /** Fires when the whole queued script has finished playing. */
  onScriptDone: (() => void) | null = null;
  /** SFX hook: impact lands. */
  onImpact: ((species: SpeciesId, special: boolean, ko: boolean) => void) | null = null;

  constructor(
    private canvas: HTMLCanvasElement,
    private world: DuelWorld,
  ) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2d context unavailable');
    this.ctx = ctx;
    this.last = performance.now();
    const loop = (now: number) => {
      if (this.disposed) return;
      const dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      this.update(dt);
      this.draw();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
  }

  setFighter(side: DuelSide, species: SpeciesId, hue: number, entrance = true, name = ''): void {
    this.fighters[side] = {
      species,
      name,
      hue,
      homeX: side === 0 ? 0.24 : 0.76,
      face: side === 0 ? 1 : -1,
      x: entrance ? (side === 0 ? -this.W * 0.4 : this.W * 0.4) : 0,
      y: 0,
      rot: 0,
      alpha: 1,
      squash: 0,
      aura: 0,
      tint: 0,
      tintHue: 0,
      mode: 'idle',
      animT: 0,
      runPhase: 0,
      guarding: false,
      trail: [],
    };
    // Fresh pairing at match start (both still walking in): snap the fit
    // so the champions never visibly pop between sizes or positions.
    const other = this.fighters[(1 - side) as DuelSide];
    if (entrance && other && Math.abs(other.x) > 2) this.applyFit(1);
  }

  /** True while a script is still playing out. */
  get busy(): boolean {
    return this.queue.length > 0;
  }

  playScript(events: DuelEvent[]): void {
    for (const ev of events) {
      let dur = 1.5;
      if (ev.kind === 'clash') dur = ev.special ? 2.45 : 1.55;
      else if (ev.kind === 'counter') dur = 0.95;
      else if (ev.kind === 'clinch') dur = 1.5;
      else if (ev.kind === 'dot') dur = 0.9;
      else if (ev.kind === 'status') dur = 0.95;
      else if (ev.kind === 'skip') dur = 0.95;
      else if (ev.kind === 'ko') dur = 2.0;
      this.queue.push({ ev, t: 0, dur, fired: new Set() });
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Simulation                                                              */
  /* ---------------------------------------------------------------------- */

  private update(dt: number): void {
    this.time += dt;
    this.shake = Math.max(0, this.shake - dt * 26);
    this.flash = Math.max(0, this.flash - dt * 3.2);
    const special = !!this.queue[0]?.ev.special;
    const wantVignette = special ? 1 : 0;
    this.vignette += (wantVignette - this.vignette) * Math.min(1, dt * 5);
    // Cinematic letterbox slides in for the duration of a special.
    this.letterbox += ((special ? 1 : 0) - this.letterbox) * Math.min(1, dt * 6);
    // Camera zoom eases toward its current target.
    this.zoom += (this.zoomTarget - this.zoom) * Math.min(1, dt * 4.5);
    if (this.queue.length === 0) this.zoomTarget = 1;
    // Pairing auto-fit eases so mid-match champion swaps resize smoothly.
    this.applyFit(Math.min(1, dt * 3));

    for (const f of this.fighters) {
      if (!f) continue;
      f.animT += dt;
      f.tint = Math.max(0, f.tint - dt * 2.4);
      // Special-dash afterimages: record while streaking, fade out after.
      if (f.mode === 'dash' && f.aura > 0.05) {
        const p = this.fighterPx(f);
        f.trail.unshift({ x: p.x, y: p.y });
        if (f.trail.length > 5) f.trail.pop();
      } else if (f.trail.length > 0 && Math.random() < 0.5) {
        f.trail.pop();
      }
      // Entrance walk-in.
      if (f.mode === 'idle' && this.queue.length === 0) {
        const speed = this.W * 0.55 * dt;
        if (Math.abs(f.x) > 2) {
          f.x -= Math.sign(f.x) * Math.min(Math.abs(f.x), speed);
          f.runPhase += dt * 7;
        } else {
          f.x = 0;
        }
      }
    }

    if (this.freeze > 0) {
      this.freeze -= dt;
    } else if (this.queue.length > 0) {
      const step = this.queue[0];
      // Slow-mo stretches the charge-up so the power gathering reads.
      step.t += dt * (1 - 0.6 * this.slowmo);
      this.runStep(step);
      if (step.t >= step.dur) {
        this.queue.shift();
        this.slowmo = 0;
        for (const f of this.fighters) {
          if (f && f.mode !== 'ko' && f.mode !== 'gone') {
            f.mode = 'idle';
            f.guarding = false;
            f.spray = false;
          }
        }
        if (this.queue.length === 0) {
          this.banner = null;
          this.onScriptDone?.();
        }
      }
    }

    // Particles / texts.
    this.particles = this.particles.filter((p) => {
      p.t += dt;
      if (p.kind === 'charge' && p.side !== undefined) {
        // Charge motes spiral inward toward the charging champion's core.
        const f = this.fighters[p.side];
        if (f) {
          const c = this.fighterPx(f);
          const targetH = this.fighterH(f.species);
          const cy = c.y - targetH * 0.45;
          p.ang = (p.ang ?? 0) + dt * 4;
          const k = clamp01(p.t / p.life);
          const r = (1 - k) * targetH * 0.9;
          p.x = c.x + Math.cos(p.ang) * r;
          p.y = cy + Math.sin(p.ang) * r * 0.5 - (1 - k) * targetH * 0.2;
          return p.t < p.life;
        }
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.kind === 'dust' || p.kind === 'spark') p.vy += this.H * 0.7 * dt;
      if (p.kind === 'glob') p.vy += this.H * 1.5 * dt;
      if (p.kind === 'ember') p.vy -= this.H * 0.02 * dt;
      return p.t < p.life;
    });
    this.texts = this.texts.filter((t) => {
      t.t += dt;
      t.y -= dt * this.H * 0.06;
      return t.t < 1.2;
    });
    if (this.banner) {
      this.banner.t += dt;
      if (this.banner.t > this.banner.dur) this.banner = null;
    }
  }

  private fire(step: Step, key: string, at: number, fn: () => void): void {
    if (step.t >= at && !step.fired.has(key)) {
      step.fired.add(key);
      fn();
    }
  }

  /** The shared impact beat of a clash: hit-stop, FX, damage readout. */
  private clashImpact(step: Step, A: FighterVis, D: FighterVis): void {
    const ev = step.ev;
    if (!A.spray) {
      A.mode = 'attack';
      A.animT = 0;
    }
    if (ev.evaded) {
      D.mode = 'evade';
      D.animT = 0;
      this.fighterText(D, 'MISS', 200, false);
    } else {
      const dmg = ev.dmg ?? 0;
      this.freeze = ev.special ? 0.22 : ev.crit ? 0.13 : 0.09;
      this.shake = ev.special ? 20 : ev.crit ? 10 : 6;
      this.flash = ev.special ? 1.1 : 0.45;
      this.flashHue = A.hue;
      D.tint = 1;
      D.tintHue = 0;
      const dp = this.fighterPx(D);
      this.sparks(dp.x, dp.y - this.H * 0.12, ev.special ? 34 : 14, A.hue);
      this.ring(dp.x, dp.y - this.H * 0.12, A.hue);
      if (ev.special) {
        // The big-hit language: shockwave, radial rays, camera slam.
        this.particles.push({
          x: dp.x, y: dp.y - this.H * 0.12, vx: 0, vy: 0,
          life: 0.55, t: 0, size: 6, hue: A.hue, kind: 'shock',
        });
        for (let i = 0; i < 10; i++) {
          this.particles.push({
            x: dp.x, y: dp.y - this.H * 0.12, vx: 0, vy: 0,
            life: 0.3 + Math.random() * 0.2, t: 0,
            size: 1.5 + Math.random() * 2, hue: A.hue,
            kind: 'line', ang: (i / 10) * Math.PI * 2 + Math.random() * 0.4,
          });
        }
        this.dustBurst(dp.x, this.groundY(), 10);
        this.zoomTarget = 1.12;
        this.zoomCX = D.homeX;
      }
      this.fighterText(D, `${dmg}`, ev.blocked ? 200 : ev.crit ? 48 : 6, !!(ev.crit || ev.special));
      if (ev.blocked) this.fighterText(D, 'BLOCKED', 200, false, true);
      else if (ev.crit) this.fighterText(D, 'CRITICAL!', 48, false, true);
      this.onImpact?.(A.species, !!ev.special, false);
    }
    this.onEventApplied?.(ev);
  }

  /* ---------------------------------------------------------------------- */
  /* Living backdrop — the painting itself flows                             */
  /* ---------------------------------------------------------------------- */

  /** Last cover-fit placement of the backdrop, for mapping flow regions. */
  private bd = { x: 0, y: 0, w: 1, h: 1 };

  /**
   * Cuts the hand-mapped fall/pond regions out of the painting at source
   * resolution, then chroma-keys them so ONLY the fluid keeps alpha —
   * glowing lava in the Basalt, white/turquoise water in the Oasis. The
   * rock, moss and shore inside each rectangle are erased from the moving
   * copy, so the land never appears to flow. A soft rectangular feather is
   * baked on top so the copies blend invisibly at region borders.
   */
  private buildFlowRegions(art: HTMLImageElement): void {
    this.flowBuilt = true;
    this.flowRegions = [];
    const basalt = this.world === 'basalt';
    for (const def of FLOW_REGIONS[this.world]) {
      const sw = Math.max(2, Math.round(def.w * art.width));
      const sh = Math.max(2, Math.round(def.h * art.height));
      const cv = document.createElement('canvas');
      cv.width = sw;
      cv.height = sh;
      const c = cv.getContext('2d', { willReadFrequently: true });
      if (!c) continue;
      c.drawImage(
        art,
        Math.round(def.x * art.width), Math.round(def.y * art.height), sw, sh,
        0, 0, sw, sh,
      );

      // Fluid-only chroma mask.
      const px = c.getImageData(0, 0, sw, sh).data;
      const mask = c.createImageData(sw, sh);
      for (let i = 0; i < sw * sh; i++) {
        const r = px[i * 4];
        const g = px[i * 4 + 1];
        const b = px[i * 4 + 2];
        let s = 0;
        if (basalt) {
          // Molten: hot orange/yellow, red well above blue, decently bright.
          s = clamp01((r - b - 30) / 90) * clamp01((r - 120) / 80);
        } else {
          // Water: foam is bright WITH real blue content (sunlit foliage is
          // bright too, but starved of blue) — or open turquoise water.
          const mn = Math.min(r, g, b);
          const foam = clamp01((mn - 120) / 60) * clamp01((b - 135) / 55);
          const turquoise = clamp01((Math.min(g, b) - 105) / 70) * clamp01((g * 0.88 - r) / 40);
          s = Math.max(foam, turquoise);
        }
        mask.data[i * 4 + 3] = Math.round(255 * s);
      }
      const maskCv = document.createElement('canvas');
      maskCv.width = sw;
      maskCv.height = sh;
      maskCv.getContext('2d')!.putImageData(mask, 0, 0);
      // Cheap blur: bounce through quarter resolution so mask edges soften.
      const lo = document.createElement('canvas');
      lo.width = Math.max(1, sw >> 2);
      lo.height = Math.max(1, sh >> 2);
      lo.getContext('2d')!.drawImage(maskCv, 0, 0, lo.width, lo.height);
      c.globalCompositeOperation = 'destination-in';
      c.drawImage(lo, 0, 0, sw, sh);

      // Feather all four edges so the copy fades out at region borders.
      const fx = Math.max(2, Math.round(sw * 0.16));
      const fy = Math.max(2, Math.round(sh * 0.12));
      for (const horizontal of [true, false]) {
        const g = horizontal
          ? c.createLinearGradient(0, 0, sw, 0)
          : c.createLinearGradient(0, 0, 0, sh);
        const f = horizontal ? fx / sw : fy / sh;
        g.addColorStop(0, 'rgba(0,0,0,0)');
        g.addColorStop(f, 'rgba(0,0,0,1)');
        g.addColorStop(1 - f, 'rgba(0,0,0,1)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        c.fillStyle = g;
        c.fillRect(0, 0, sw, sh);
      }
      c.globalCompositeOperation = 'source-over';
      this.flowRegions.push({ def, canvas: cv, phase: Math.random() });
    }
  }

  /**
   * Draws the flowing overlays: falls pour downward via two phase-staggered
   * copies of the region crossfading over a short travel (the film
   * cinemagraph trick — constant motion, no visible seam); pond ripples via
   * per-row sinusoidal displacement of the region's own pixels.
   */
  private drawFlow(ctx: CanvasRenderingContext2D): void {
    for (const r of this.flowRegions) {
      const def = r.def;
      const dx = this.bd.x + def.x * this.bd.w;
      const dy = this.bd.y + def.y * this.bd.h;
      const dw = def.w * this.bd.w;
      const dh = def.h * this.bd.h;

      if (def.kind === 'fall') {
        // Travel distance ~22% of the region height per cycle.
        const travel = dh * 0.22;
        for (const stagger of [0, 0.5]) {
          const k = (this.time * def.speed + r.phase + stagger) % 1;
          const alpha = 1 - Math.abs(2 * k - 1); // triangle: in, out
          const off = (k - 0.5) * travel;
          // A whisper of lateral sway keeps the sheet from feeling stiff.
          const sway = Math.sin(this.time * 1.7 + r.phase * 9 + stagger * 4) * dw * 0.004;
          ctx.globalAlpha = alpha * 0.85;
          ctx.drawImage(r.canvas, dx + sway, dy + off, dw, dh);
        }
        ctx.globalAlpha = 1;
      } else {
        // Ripple: slice the region into rows and slide each sideways.
        const slices = 18;
        const sh = r.canvas.height / slices;
        const amp = (def.amp ?? 0.008) * dw;
        for (let i = 0; i < slices; i++) {
          const ny = i / slices;
          const wob =
            Math.sin(this.time * (1.1 + def.speed) + ny * 9 + r.phase * 7) * amp * (0.4 + ny);
          ctx.drawImage(
            r.canvas,
            0, i * sh, r.canvas.width, sh,
            dx + wob, dy + ny * dh, dw, dh / slices + 1,
          );
        }
      }
    }
  }

  /** Ambient drifting embers (basalt) / pollen motes (oasis). */
  private spawnAmbience(): void {
    if (Math.random() < 0.3) {
      this.particles.push({
        x: Math.random() * this.W,
        y: this.H * (0.3 + Math.random() * 0.6),
        vx: (Math.random() - 0.5) * this.W * 0.02,
        vy: -this.H * (0.015 + Math.random() * 0.03),
        life: 3 + Math.random() * 3,
        t: 0,
        size: 1 + Math.random() * 2,
        hue: this.world === 'basalt' ? 20 + Math.random() * 20 : 50 + Math.random() * 60,
        kind: this.world === 'basalt' ? 'ember' : 'mote',
      });
    }
  }

  private groundY(): number {
    return this.H * 0.82;
  }

  private fighterPx(f: FighterVis): { x: number; y: number } {
    let fly = FLYERS.has(f.species) ? -this.H * 0.1 : 0;
    // A KO'd flyer drops out of its hover onto the ground.
    if (fly !== 0 && (f.mode === 'ko' || f.mode === 'gone')) {
      fly *= 1 - clamp01(f.animT / 0.55);
    }
    return { x: this.W * f.homeX + f.x, y: this.groundY() + f.y + fly };
  }

  /** Final drawn height for a species, including the pairing auto-fit. */
  private fighterH(species: SpeciesId): number {
    return this.H * 0.26 * (DUEL_SCALE[species] ?? 0.9) * this.fitScale;
  }

  /** Idle-stance half-width for a species at fit 1, from its run frames
   *  (anchors sit at the sprite's horizontal center). Attack lunges are
   *  transient contact moments and deliberately don't count. */
  private baseHalfW(species: SpeciesId): number {
    const baseH = this.H * 0.26 * (DUEL_SCALE[species] ?? 0.9);
    const anim = getAnim(species);
    const frames = anim && anim.run.length ? anim.run : [];
    if (frames.length === 0) {
      const p = getSprite(species);
      if (!p) return baseH * 0.55;
      return (p.canvas.width / 2) * (baseH / p.h);
    }
    let half = 0;
    for (const s of frames) half = Math.max(half, (s.canvas.width / 2) * (baseH / s.h));
    return half;
  }

  /** Lays out the pairing: shrinks both champions just enough — and slides
   *  their home anchors outward — so each is entirely on screen with clear
   *  air between them. Wide pairs use the whole arena; slim pairs keep the
   *  classic 0.24 / 0.76 staging at full size. */
  private fitTarget(): { s: number; homeL: number; homeR: number } {
    const a = this.fighters[0];
    const b = this.fighters[1];
    const cur = {
      s: this.fitScale,
      homeL: this.fighters[0]?.homeX ?? 0.24,
      homeR: this.fighters[1]?.homeX ?? 0.76,
    };
    if (!a || !b || a.mode === 'gone' || b.mode === 'gone') return cur;
    const W = this.W;
    const ha = this.baseHalfW(a.species) / W; // fractions of stage width
    const hb = this.baseHalfW(b.species) / W;
    const edgePad = 0.015; // each tail keeps this much from the edge
    const midGap = 0.07; // guaranteed daylight between the two
    // Full visibility + gap across the whole arena width bounds the scale.
    const s = clamp01((1 - 2 * edgePad - midGap) / (2 * (ha + hb)));
    // Prefer the classic staging, pulled in only for edge visibility…
    let homeL = Math.max(0.24, edgePad + s * ha);
    let homeR = Math.min(0.76, 1 - edgePad - s * hb);
    // …then push the pair apart if that pinched the middle gap (the scale
    // bound guarantees room exists between the edge pads).
    const need = s * (ha + hb) + midGap - (homeR - homeL);
    if (need > 0) {
      const slackL = homeL - (edgePad + s * ha);
      const slackR = 1 - edgePad - s * hb - homeR;
      homeL -= Math.min(slackL, need / 2 + Math.max(0, need / 2 - slackR));
      homeR += Math.min(slackR, need / 2 + Math.max(0, need / 2 - slackL));
    }
    return { s, homeL, homeR };
  }

  private applyFit(k: number): void {
    const t = this.fitTarget();
    this.fitScale += (t.s - this.fitScale) * k;
    const L = this.fighters[0];
    const R = this.fighters[1];
    if (L) L.homeX += (t.homeL - L.homeX) * k;
    if (R) R.homeX += (t.homeR - R.homeX) * k;
  }

  private runStep(step: Step): void {
    const ev = step.ev;
    const A = this.fighters[ev.side];
    const D = this.fighters[(1 - ev.side) as DuelSide];
    if (!A || !D) {
      step.t = step.dur;
      return;
    }
    // Live distance between the two champions' home anchors (the auto-fit
    // slides homes apart for wide pairings).
    const gap = this.W * Math.abs(D.homeX - A.homeX);
    const t = step.t;

    switch (ev.kind) {
      case 'clash': {
        // Timeline offsets: special moves get a slow-motion charge-up
        // prologue — the whole stage bends around the gathering power.
        const scorpionTail = A.species === 'scorpion';
        const pre = ev.special ? (scorpionTail ? 1.35 : 1.05) : 0;
        const wEnd = pre + (scorpionTail ? 0.50 : 0.32);
        const strikeDur = scorpionTail ? 0.80 : 0.26;
        const contactAt = scorpionTail ? wEnd + strikeDur * (4 / 5) : wEnd + strikeDur;
        const dEnd = scorpionTail ? contactAt + 0.22 : wEnd + 0.26;
        if (ev.special) {
          this.fire(step, 'announce', 0, () => {
            this.banner = {
              txt: ev.label ?? 'SPECIAL',
              sub: A.name ? `${A.name}'s signature move` : undefined,
              t: 0,
              dur: step.dur,
              hue: A.hue,
            };
            // Camera pushes in on the charging champion; time dilates.
            this.zoomTarget = 1.14;
            this.zoomCX = A.homeX;
            this.zoomCY = 0.62;
            this.slowmo = 1;
          });
          A.aura = Math.min(1, ph(t, 0, pre) * 1.3);
          // Power motes spiral into the champion; the ground ignites.
          if (t < pre && Math.random() < 0.55) {
            const ap = this.fighterPx(A);
            this.particles.push({
              x: ap.x, y: ap.y, vx: 0, vy: 0,
              life: 0.5 + Math.random() * 0.35, t: 0,
              size: 1.4 + Math.random() * 2.2,
              hue: A.hue + (Math.random() - 0.5) * 24,
              kind: 'charge', ang: Math.random() * Math.PI * 2, side: ev.side,
            });
          }
          if (t < pre && Math.random() < 0.3) {
            const ap = this.fighterPx(A);
            this.ring(ap.x, this.groundY() - this.H * 0.01, A.hue);
          }
          // Power crescendo: rays erupt and time snaps back to full speed.
          this.fire(step, 'unleash', pre * 0.82, () => {
            this.slowmo = 0;
            this.flash = 0.5;
            this.flashHue = A.hue;
            const ap = this.fighterPx(A);
            for (let i = 0; i < 14; i++) {
              this.particles.push({
                x: ap.x, y: ap.y - this.H * 0.12, vx: 0, vy: 0,
                life: 0.35 + Math.random() * 0.2, t: 0,
                size: 1 + Math.random() * 2, hue: A.hue,
                kind: 'line', ang: (i / 14) * Math.PI * 2 + Math.random() * 0.3,
              });
            }
          });
        }
        // Bombardier Beetles fire their special like real artillery: they
        // whip around rear-to-foe and hose boiling acid across the arena
        // instead of charging in head-first.
        const sprayer = !!ev.special && A.species === 'beetles';
        if (sprayer && t >= wEnd) {
          this.fire(step, 'spray', wEnd, () => {
            A.mode = 'attack';
            A.animT = 0;
            A.spray = true;
            this.zoomTarget = 1.06;
            this.zoomCX = 0.5;
          });
          A.x = 0;
          // Acid globs arc from the rear nozzle to the victim.
          if (t < dEnd + 0.35 && Math.random() < 0.85) {
            const ap = this.fighterPx(A);
            const dp = this.fighterPx(D);
            const sx = ap.x + A.face * this.W * 0.03;
            const sy = ap.y - this.H * (0.1 + Math.random() * 0.04);
            const T = 0.26 + Math.random() * 0.14;
            const g = this.H * 1.5;
            const txp = dp.x + (Math.random() - 0.5) * this.W * 0.05;
            const typ = dp.y - this.H * (0.04 + Math.random() * 0.1);
            this.particles.push({
              x: sx, y: sy,
              vx: (txp - sx) / T,
              vy: (typ - sy - 0.5 * g * T * T) / T,
              life: T, t: 0,
              size: 2 + Math.random() * 2.5,
              hue: 96 + Math.random() * 34,
              kind: 'glob',
            });
          }
        }
        // Wind-up: coil back and crouch (scorpion enters tail-strike pose).
        if (t < wEnd) {
          A.mode = scorpionTail && t >= pre + 0.18 ? 'attack' : 'idle';
          if (scorpionTail && A.mode === 'attack') A.animT = t - (pre + 0.18);
          A.x = -A.face * easeOut(ph(t, pre, wEnd)) * this.W * 0.05;
          A.squash = easeOut(ph(t, pre, wEnd)) * 0.12;
          D.guarding = !!ev.blocked;
          if (D.guarding) D.mode = 'guard';
        } else if (sprayer) {
          // Hold position and vent; the impact beat below still fires on
          // schedule when the first globs land.
          A.squash = 0;
          if (t >= dEnd) {
            this.fire(step, 'impact', dEnd, () => this.clashImpact(step, A, D));
          }
          if (!ev.evaded && t >= dEnd) {
            const kb = Math.exp(-ph(t, dEnd, step.dur) * 5) * this.W * 0.04;
            D.x = -D.face * kb;
          }
          A.aura = Math.max(0, A.aura - 0.03);
        } else if (t < dEnd) {
          if (scorpionTail) {
            A.mode = 'attack';
            A.animT = t - wEnd;
            A.x = 0;
            this.fire(step, 'impact', contactAt, () => this.clashImpact(step, A, D));
          } else {
            // Dash across the arena (specials streak with afterimages).
            A.mode = 'dash';
            const k = easeIn(ph(t, wEnd, dEnd));
            A.x = A.face * (k * (gap - this.W * 0.13) - this.W * 0.05 * (1 - k));
            A.squash = 0;
            A.runPhase += 0.6;
          }
          if (ev.special && !scorpionTail) {
            this.zoomTarget = 1.08;
            this.zoomCX = 0.5;
          }
          if (!scorpionTail && Math.random() < 0.7) this.dust(this.fighterPx(A).x, this.groundY());
        } else {
          if (!scorpionTail) {
            this.fire(step, 'impact', dEnd, () => this.clashImpact(step, A, D));
          }
          const k = easeOut(ph(t, dEnd + 0.18, step.dur));
          A.x = scorpionTail ? 0 : A.face * (gap - this.W * 0.13) * (1 - k);
          if (t > dEnd + 0.18) {
            A.mode = scorpionTail ? 'idle' : 'dash';
            if (!scorpionTail) A.runPhase += 0.35;
          }
          if (!ev.evaded) {
            // Defender knockback skid away from the attacker, then settle.
            const kb = Math.exp(-ph(t, dEnd, step.dur) * 5) * this.W * (ev.special ? 0.055 : 0.028);
            D.x = -D.face * kb;
          } else {
            const e = ph(t, dEnd, dEnd + 0.5);
            D.y = -Math.sin(Math.min(1, e) * Math.PI) * this.H * 0.14;
          }
          A.aura = Math.max(0, A.aura - 0.03);
        }
        break;
      }

      case 'counter': {
        const hitAt = 0.4;
        if (t < hitAt) {
          A.mode = 'dash';
          A.x = A.face * easeIn(ph(t, 0, hitAt)) * gap * 0.34;
          A.runPhase += 0.5;
        } else {
          this.fire(step, 'impact', hitAt, () => {
            A.mode = 'attack';
            A.animT = 0;
            this.freeze = 0.06;
            this.shake = 4;
            D.tint = 0.8;
            const dp = this.fighterPx(D);
            this.sparks(dp.x, dp.y - this.H * 0.1, 8, A.hue);
            this.fighterText(D, `${ev.dmg ?? 0}`, ev.label === 'QUILLS' ? 160 : 40, false);
            if (ev.label) this.fighterText(D, ev.label, 160, false, true);
            this.onImpact?.(A.species, false, false);
            this.onEventApplied?.(ev);
          });
          A.x = A.face * gap * 0.34 * (1 - easeOut(ph(t, hitAt + 0.1, step.dur)));
        }
        break;
      }

      case 'clinch': {
        const inEnd = 0.45;
        const outStart = 0.95;
        const reach = gap * 0.36;
        if (t < inEnd) {
          const k = easeIn(ph(t, 0, inEnd));
          A.x = A.face * reach * k;
          D.x = D.face * reach * k;
          A.mode = D.mode = 'dash';
          A.runPhase += 0.4;
          D.runPhase += 0.4;
        } else if (t < outStart) {
          this.fire(step, 'spark', inEnd, () => {
            this.shake = 5;
            this.sparks(this.W * 0.5, this.groundY() - this.H * 0.14, 16, 45);
            this.banner = { txt: 'STANDOFF', t: 0, dur: 0.9, hue: 45 };
            this.onEventApplied?.(ev);
          });
          A.x = A.face * reach;
          D.x = D.face * reach;
          A.mode = D.mode = 'guard';
        } else {
          const k = easeOut(ph(t, outStart, step.dur));
          A.x = A.face * reach * (1 - k);
          D.x = D.face * reach * (1 - k);
        }
        break;
      }

      case 'dot': {
        const F = this.fighters[ev.side];
        if (!F) break;
        this.fire(step, 'tick', 0.25, () => {
          F.tint = 1;
          F.tintHue = ev.label === 'VENOM' ? 120 : 25;
          this.fighterText(F, `${ev.dmg ?? 0}`, ev.label === 'VENOM' ? 120 : 25, false);
          if (ev.label) this.fighterText(F, ev.label, ev.label === 'VENOM' ? 120 : 25, false, true);
          this.onEventApplied?.(ev);
        });
        break;
      }

      case 'status':
      case 'skip': {
        const F = this.fighters[ev.side];
        if (!F) break;
        this.fire(step, 'show', 0.1, () => {
          this.fighterText(F, ev.label ?? '', ev.kind === 'skip' ? 55 : 280, false);
          this.onEventApplied?.(ev);
        });
        if (ev.kind === 'skip') F.squash = Math.sin(t * 18) * 0.03;
        break;
      }

      case 'ko': {
        const F = this.fighters[ev.side];
        if (!F) break;
        this.fire(step, 'ko', 0, () => {
          F.mode = 'ko';
          F.animT = 0;
          F.tint = 1;
          this.freeze = 0.18;
          this.shake = 12;
          this.flash = 0.8;
          this.flashHue = 0;
          this.banner = { txt: 'K.O.!', sub: ev.label, t: 0, dur: 1.9, hue: 6 };
          const p = this.fighterPx(F);
          this.dustBurst(p.x, this.groundY(), 18);
          this.onImpact?.(F.species, false, true);
          this.onEventApplied?.(ev);
        });
        // The defeated champion COLLAPSES via painted KO frames — legs
        // buckle, chest drops, body lies down (never deflates). Species
        // without a KO sheet fall back to a gentle procedural slump.
        const hasKo = !!getAnim(F.species)?.ko?.length;
        if (hasKo) {
          F.rot = 0;
          F.squash = 0;
          F.y = 0;
        } else {
          const k = ph(t, 0.1, 0.85);
          F.rot = F.face * easeOut(k) * 0.2;
          F.squash = easeOut(k) * 0.3;
          F.y = easeIn(k) * this.H * 0.012;
        }
        this.fire(step, 'settle', 0.8, () => {
          const p = this.fighterPx(F);
          this.dustBurst(p.x, this.groundY(), 10);
          this.shake = Math.max(this.shake, 4);
        });
        F.alpha = 1 - ph(t, 1.2, step.dur) * 0.99;
        if (t >= step.dur - 0.02) F.mode = 'gone';
        break;
      }
    }
  }

  /* ---------------------------------------------------------------------- */
  /* FX helpers                                                              */
  /* ---------------------------------------------------------------------- */

  private sparks(x: number, y: number, n: number, hue: number): void {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = this.H * (0.15 + Math.random() * 0.45);
      this.particles.push({
        x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v * 0.7 - this.H * 0.1,
        life: 0.35 + Math.random() * 0.4, t: 0,
        size: 1.5 + Math.random() * 2.5, hue: hue + (Math.random() - 0.5) * 30, kind: 'spark',
      });
    }
  }

  private ring(x: number, y: number, hue: number): void {
    this.particles.push({ x, y, vx: 0, vy: 0, life: 0.4, t: 0, size: 4, hue, kind: 'ring' });
  }

  private dust(x: number, y: number): void {
    this.particles.push({
      x: x + (Math.random() - 0.5) * this.W * 0.03, y,
      vx: (Math.random() - 0.5) * this.W * 0.04, vy: -this.H * (0.03 + Math.random() * 0.05),
      life: 0.5 + Math.random() * 0.4, t: 0, size: 2 + Math.random() * 3,
      hue: this.world === 'basalt' ? 25 : 90, kind: 'dust',
    });
  }

  private dustBurst(x: number, y: number, n: number): void {
    for (let i = 0; i < n; i++) this.dust(x, y);
  }

  /**
   * Combat text anchored to a fighter: numbers ride just above the
   * champion's head, and concurrent texts on the same side stack upward
   * instead of printing over each other (or over the move ribbon).
   */
  private fighterText(f: FighterVis, txt: string, hue: number, big: boolean, subline = false): void {
    const p = this.fighterPx(f);
    const fh = this.fighterH(f.species);
    // Clamp into this fighter's half so texts never collide mid-arena,
    // then pull in far enough that the rendered word can't clip the edge.
    const left = f.homeX < 0.5;
    const fontPx = (big ? 0.062 : 0.042) * this.H * (subline ? 0.6 : 1);
    const halfW = txt.length * fontPx * 0.34 + this.W * 0.02;
    const x = Math.max(
      Math.max(this.W * (left ? 0.12 : 0.56), halfW),
      Math.min(Math.min(this.W * (left ? 0.44 : 0.88), this.W - halfW), p.x),
    );
    // Never spawn inside the HUD zone — tall species get pushed down.
    const floor = this.hudBottom * this.H + this.H * 0.06;
    const head = Math.max(this.groundY() - fh - this.H * 0.045, floor);
    // Stack over any live texts already occupying this side.
    let stack = 0;
    for (const t of this.texts) {
      const tLeft = t.x < this.W * 0.5;
      if (tLeft === left && t.t < 0.6) stack++;
    }
    let y: number;
    if (subline) {
      y = head + this.H * 0.042; // labels sit UNDER the number
    } else {
      y = head - stack * this.H * 0.05;
      if (y < floor) y = head + stack * this.H * 0.05; // flip: stack downward
    }
    this.texts.push({ x, y, txt, hue, t: 0, big, scale: subline ? 0.6 : 1 });
  }

  /* ---------------------------------------------------------------------- */
  /* Rendering                                                               */
  /* ---------------------------------------------------------------------- */

  private draw(): void {
    const rect = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.W = Math.max(1, Math.round(rect.width * this.dpr));
    this.H = Math.max(1, Math.round(rect.height * this.dpr));
    if (this.canvas.width !== this.W || this.canvas.height !== this.H) {
      this.canvas.width = this.W;
      this.canvas.height = this.H;
    }
    const ctx = this.ctx;
    const { W, H } = this;

    ctx.save();
    // Screen shake.
    if (this.shake > 0) {
      ctx.translate(
        (Math.random() - 0.5) * this.shake * this.dpr,
        (Math.random() - 0.5) * this.shake * this.dpr,
      );
    }
    // Camera zoom (specials push in on the action).
    if (this.zoom > 1.001) {
      ctx.translate(this.zoomCX * W, this.zoomCY * H);
      ctx.scale(this.zoom, this.zoom);
      ctx.translate(-this.zoomCX * W, -this.zoomCY * H);
    }

    // Painted backdrop, cover-fit with a slow breathing drift.
    const art = getDuelArt(this.world);
    if (art) {
      if (!this.flowBuilt) this.buildFlowRegions(art);
      // The painting itself stays rock-still — any drift here reads as the
      // land moving. Only the masked fluid overlays animate.
      const scale = Math.max(W / art.width, H / art.height) * 1.02;
      const dw = art.width * scale;
      const dh = art.height * scale;
      const dx = (W - dw) / 2;
      const dy = H - dh;
      this.bd = { x: dx, y: dy, w: dw, h: dh };
      ctx.drawImage(art, dx, dy, dw, dh);
      this.drawFlow(ctx);
      this.spawnAmbience();
    } else {
      const g = ctx.createLinearGradient(0, 0, 0, H);
      if (this.world === 'basalt') {
        g.addColorStop(0, 'hsl(8 55% 12%)');
        g.addColorStop(1, 'hsl(20 30% 6%)');
      } else {
        g.addColorStop(0, 'hsl(190 45% 20%)');
        g.addColorStop(1, 'hsl(150 35% 8%)');
      }
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }

    // Special-move vignette focuses the eye.
    if (this.vignette > 0.01) {
      const v = ctx.createRadialGradient(W / 2, H * 0.6, H * 0.25, W / 2, H * 0.6, H * 0.95);
      v.addColorStop(0, 'rgba(0,0,0,0)');
      v.addColorStop(1, `rgba(0,0,0,${0.55 * this.vignette})`);
      ctx.fillStyle = v;
      ctx.fillRect(0, 0, W, H);
    }

    // Back-to-front: ambience behind, then fighters, then FX.
    for (const p of this.particles) {
      if (p.kind !== 'ember' && p.kind !== 'mote') continue;
      const a = 0.5 * (1 - p.t / p.life);
      ctx.fillStyle = `hsla(${p.hue} 90% 65% / ${a})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * this.dpr * 0.7, 0, Math.PI * 2);
      ctx.fill();
    }

    for (const side of [1, 0] as DuelSide[]) {
      const f = this.fighters[side];
      if (f && f.mode !== 'gone') this.drawFighter(f);
    }

    // Foreground FX.
    for (const p of this.particles) {
      if (p.kind === 'ember' || p.kind === 'mote') continue;
      const k = p.t / p.life;
      if (p.kind === 'ring') {
        ctx.strokeStyle = `hsla(${p.hue} 95% 70% / ${0.8 * (1 - k)})`;
        ctx.lineWidth = 3 * this.dpr * (1 - k);
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size + k * H * 0.16, 0, Math.PI * 2);
        ctx.stroke();
      } else if (p.kind === 'shock') {
        // Special-impact shockwave: a fat double ring that races outward.
        const r = p.size + easeOut(k) * H * 0.34;
        ctx.strokeStyle = `hsla(${p.hue} 95% 75% / ${0.9 * (1 - k)})`;
        ctx.lineWidth = 7 * this.dpr * (1 - k) + 1;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.strokeStyle = `hsla(0 0% 100% / ${0.5 * (1 - k)})`;
        ctx.lineWidth = 2.5 * this.dpr * (1 - k) + 0.5;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r * 0.82, 0, Math.PI * 2);
        ctx.stroke();
      } else if (p.kind === 'glob') {
        // Boiling acid glob: an elongated drop streaking along its arc,
        // with a hot bright core.
        const a = 0.92 * (1 - k * 0.35);
        const ang = Math.atan2(p.vy, p.vx);
        const r = p.size * this.dpr;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(ang);
        ctx.fillStyle = `hsla(${p.hue} 90% 52% / ${a})`;
        ctx.beginPath();
        ctx.ellipse(0, 0, r * 1.9, r, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = `hsla(${p.hue} 95% 80% / ${a * 0.85})`;
        ctx.beginPath();
        ctx.ellipse(-r * 0.3, 0, r * 0.9, r * 0.55, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      } else if (p.kind === 'line') {
        // Energy ray shooting out of an impact / power-up.
        const a = 0.85 * (1 - k);
        const r0 = H * 0.02 + easeOut(k) * H * 0.05;
        const r1 = r0 + H * (0.06 + p.size * 0.02) * (1 - k * 0.4);
        const ang = p.ang ?? 0;
        ctx.strokeStyle = `hsla(${p.hue} 95% 78% / ${a})`;
        ctx.lineWidth = (1.5 + p.size * 0.5) * this.dpr * (1 - k);
        ctx.beginPath();
        ctx.moveTo(p.x + Math.cos(ang) * r0, p.y + Math.sin(ang) * r0);
        ctx.lineTo(p.x + Math.cos(ang) * r1, p.y + Math.sin(ang) * r1);
        ctx.stroke();
      } else if (p.kind === 'charge') {
        // Power motes spiraling into the charging champion.
        const a = 0.9 * Math.sin(Math.min(1, k) * Math.PI);
        ctx.fillStyle = `hsla(${p.hue} 95% 74% / ${a})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * this.dpr * (0.6 + k), 0, Math.PI * 2);
        ctx.fill();
      } else {
        const a = (p.kind === 'dust' ? 0.4 : 0.9) * (1 - k);
        const l = p.kind === 'dust' ? 45 : 65;
        ctx.fillStyle = `hsla(${p.hue} ${p.kind === 'dust' ? 20 : 95}% ${l}% / ${a})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * this.dpr * (1 - k * 0.5), 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Impact flash.
    if (this.flash > 0.01) {
      ctx.fillStyle = `hsla(${this.flashHue} 90% 75% / ${this.flash * 0.28})`;
      ctx.fillRect(0, 0, W, H);
    }

    ctx.restore();

    // Floating damage numbers — screen-space so the camera zoom can never
    // push them under the HUD cards. Positions are mapped through the zoom
    // by hand, then clamped below the measured HUD bottom edge.
    const hudPx = this.hudBottom * H;
    for (const t of this.texts) {
      const a = t.t < 0.15 ? t.t / 0.15 : 1 - Math.max(0, (t.t - 0.55) / 0.65);
      const pop = t.t < 0.18 ? 1 + (0.18 - t.t) * 2.2 : 1;
      const size = (t.big ? 0.062 : 0.042) * H * pop * (t.scale ?? 1);
      // Map through the camera zoom (texts track the pushed-in action).
      let tx = t.x;
      let ty = t.y;
      if (this.zoom > 1.001) {
        tx = (tx - this.zoomCX * W) * this.zoom + this.zoomCX * W;
        ty = (ty - this.zoomCY * H) * this.zoom + this.zoomCY * H;
      }
      ctx.save();
      ctx.globalAlpha = clamp01(a);
      ctx.font = `900 ${size}px Georgia, 'Times New Roman', serif`;
      ctx.textAlign = 'center';
      // Clamp fully on screen and below the HUD cards.
      const half = ctx.measureText(t.txt).width / 2;
      tx = Math.max(half + W * 0.015, Math.min(W - half - W * 0.015, tx));
      ty = Math.max(hudPx + size * 1.05, ty);
      ctx.lineWidth = size * 0.14;
      ctx.strokeStyle = 'rgba(10,6,4,0.85)';
      ctx.strokeText(t.txt, tx, ty);
      ctx.fillStyle = `hsl(${t.hue} 95% 72%)`;
      ctx.fillText(t.txt, tx, ty);
      ctx.restore();
    }

    // Move ribbon — screen-space, directly below the measured HUD bottom,
    // so the title cards can never cover it (and it never shakes).
    if (this.banner) {
      const b = this.banner;
      const a = b.t < 0.2 ? b.t / 0.2 : 1 - Math.max(0, (b.t - (b.dur - 0.4)) / 0.4);
      const slide = b.t < 0.25 ? (1 - b.t / 0.25) * H * 0.014 : 0;
      const y = hudPx + H * 0.064 - slide;
      ctx.save();
      ctx.globalAlpha = clamp01(a);
      const g = ctx.createLinearGradient(0, y - H * 0.052, 0, y + H * 0.052);
      g.addColorStop(0, 'rgba(8,5,3,0)');
      g.addColorStop(0.35, 'rgba(8,5,3,0.78)');
      g.addColorStop(0.65, 'rgba(8,5,3,0.78)');
      g.addColorStop(1, 'rgba(8,5,3,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, y - H * 0.052, W, H * 0.104);
      // Hairline rules give it a title-card finish.
      ctx.fillStyle = `hsla(${b.hue} 80% 65% / 0.7)`;
      ctx.fillRect(W * 0.2, y - H * 0.043, W * 0.6, 1.2 * this.dpr);
      ctx.fillRect(W * 0.2, y + H * 0.041, W * 0.6, 1.2 * this.dpr);
      ctx.font = `900 ${H * 0.04}px Georgia, serif`;
      ctx.textAlign = 'center';
      ctx.lineWidth = H * 0.006;
      ctx.strokeStyle = 'rgba(10,6,4,0.9)';
      ctx.strokeText(b.txt, W / 2, y + (b.sub ? -H * 0.002 : H * 0.011));
      ctx.fillStyle = `hsl(${b.hue} 90% 70%)`;
      ctx.fillText(b.txt, W / 2, y + (b.sub ? -H * 0.002 : H * 0.011));
      if (b.sub) {
        ctx.font = `700 ${H * 0.019}px Georgia, serif`;
        ctx.fillStyle = 'rgba(240,230,215,0.9)';
        ctx.fillText(b.sub.toUpperCase(), W / 2, y + H * 0.03);
      }
      ctx.restore();
    }

    // Cinematic letterbox (drawn outside the shaken/zoomed camera).
    if (this.letterbox > 0.01) {
      const bar = this.letterbox * H * 0.055;
      ctx.fillStyle = 'rgba(4,2,3,0.94)';
      ctx.fillRect(0, 0, W, bar);
      ctx.fillRect(0, H - bar, W, bar);
    }
  }

  private pickFrames(f: FighterVis): { a: Sprite; b: Sprite | null; mix: number } | null {
    const anim = getAnim(f.species);
    if (!anim || anim.run.length === 0) {
      const p = getSprite(f.species);
      return p ? { a: p, b: null, mix: 0 } : null;
    }
    const parade = f.species === 'scorpion' && anim.intro && anim.intro.length >= 6 ? anim.intro : null;
    if (f.mode === 'ko' && anim.ko && anim.ko.length > 0) {
      // Painted collapse: sweep through the KO frames over ~1.1s with a
      // short crossfade between poses, then hold the final lying pose.
      const n = anim.ko.length;
      const k = clamp01((f.animT - 0.06) / 1.05) * (n - 1);
      const i = Math.min(n - 1, Math.floor(k));
      const j = Math.min(n - 1, i + 1);
      const frac = k - i;
      const mix = frac * frac * (3 - 2 * frac);
      return { a: anim.ko[i], b: j > i && mix > 0.02 ? anim.ko[j] : null, mix };
    }
    if (f.mode === 'attack') {
      // Beetles only show the acid-spray art during their special — normal
      // strikes are a clean scuttle-lunge on the run frames.
      if (f.species === 'beetles' && !f.spray) {
        const n = anim.run.length;
        return { a: anim.run[Math.floor(f.runPhase) % n], b: null, mix: 0 };
      }
      const atkDur = f.species === 'scorpion' ? 0.80 : 0.5;
      const at = clamp01(f.animT / atkDur);
      const nAtk = anim.attack.length;
      if (f.species === 'scorpion') {
        const idx = Math.min(nAtk - 1, Math.floor(at * nAtk * 0.98 + 0.001));
        return { a: anim.attack[idx], b: null, mix: 0 };
      }
      const idx = at < 0.35 ? 0 : at < 0.7 ? 1 : 2;
      return { a: anim.attack[Math.min(idx, nAtk - 1)], b: null, mix: 0 };
    }
    if (parade && (f.mode === 'idle' || f.mode === 'guard')) {
      const n = parade.length;
      const i = Math.floor(f.runPhase * 0.5) % n;
      const frac = (f.runPhase * 0.5) - Math.floor(f.runPhase * 0.5);
      const mix = frac * frac * (3 - 2 * frac);
      return { a: parade[i], b: parade[(i + 1) % n], mix };
    }
    if (parade && f.mode === 'dash') {
      const n = parade.length;
      const i = Math.floor(f.runPhase) % n;
      const frac = f.runPhase - Math.floor(f.runPhase);
      const mix = frac * frac * (3 - 2 * frac);
      return { a: parade[i], b: parade[(i + 1) % n], mix };
    }
    if (f.mode === 'dash' || FLYERS.has(f.species)) {
      if (FLYERS.has(f.species) && f.mode !== 'dash') f.runPhase += 0.12;
      const n = anim.run.length;
      const i = Math.floor(f.runPhase) % n;
      const frac = f.runPhase - Math.floor(f.runPhase);
      const mix = frac * frac * (3 - 2 * frac);
      return { a: anim.run[i], b: anim.run[(i + 1) % n], mix };
    }
    return { a: anim.run[0], b: null, mix: 0 };
  }

  private drawFighter(f: FighterVis): void {
    const ctx = this.ctx;
    const { x, y } = this.fighterPx(f);
    const targetH = this.fighterH(f.species);
    const frames = this.pickFrames(f);
    if (!frames) return;

    // Special aura glow behind the champion.
    if (f.aura > 0.02) {
      const g = ctx.createRadialGradient(x, y - targetH * 0.4, 4, x, y - targetH * 0.4, targetH * 0.95);
      g.addColorStop(0, `hsla(${f.hue} 95% 62% / ${0.5 * f.aura})`);
      g.addColorStop(1, `hsla(${f.hue} 95% 55% / 0)`);
      ctx.fillStyle = g;
      ctx.fillRect(x - targetH, y - targetH * 1.6, targetH * 2, targetH * 2);
    }

    // Contact shadow.
    const fly = FLYERS.has(f.species);
    ctx.save();
    ctx.globalAlpha = 0.36 * f.alpha * (fly ? 0.5 : 1);
    ctx.fillStyle = '#08050a';
    ctx.beginPath();
    ctx.ellipse(x, this.groundY() + 3, targetH * 0.42, targetH * 0.09, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Special-dash afterimages: hue-tinted ghosts streaking behind.
    if (f.trail.length > 0) {
      const ghost = frames.a;
      const gScale = targetH / ghost.h;
      for (let i = f.trail.length - 1; i >= 0; i--) {
        const tp = f.trail[i];
        ctx.save();
        ctx.translate(tp.x, tp.y);
        if (f.face !== ghost.nativeFacing) ctx.scale(-1, 1);
        ctx.globalAlpha = 0.22 * (1 - i / f.trail.length) * f.alpha;
        ctx.drawImage(
          ghost.canvas,
          -ghost.anchorX * gScale,
          -ghost.anchorY * gScale + targetH * 0.06,
          ghost.canvas.width * gScale,
          ghost.canvas.height * gScale,
        );
        ctx.restore();
      }
    }

    // Idle breathing.
    const breathe = f.mode === 'idle' ? 1 + Math.sin(this.time * 2.2 + f.homeX * 9) * 0.012 : 1;
    const squashY = 1 - f.squash;
    const squashX = 1 + f.squash * 0.6;

    ctx.save();
    ctx.translate(x, y);
    if (f.rot !== 0) ctx.rotate(f.rot);
    ctx.scale(squashX, breathe * squashY);

    const drawOne = (s: Sprite, alpha: number) => {
      const scale = targetH / s.h;
      ctx.save();
      // Spraying beetles present their rear to the foe: invert the mirror
      // so the abdomen nozzle (and its acid jet) points at the opponent.
      const mirrored = (f.face !== s.nativeFacing) !== !!f.spray;
      if (mirrored) ctx.scale(-1, 1);
      ctx.globalAlpha = alpha * f.alpha;
      ctx.drawImage(
        s.canvas,
        -s.anchorX * scale,
        -s.anchorY * scale + targetH * 0.06,
        s.canvas.width * scale,
        s.canvas.height * scale,
      );
      // Damage flash: tint clipped to the sprite's own silhouette via a
      // scratch canvas (source-atop on the main canvas would wash the
      // whole opaque backdrop).
      if (f.tint > 0.03) {
        const sc = this.scratch;
        if (sc.width < s.canvas.width || sc.height < s.canvas.height) {
          sc.width = Math.max(sc.width, s.canvas.width);
          sc.height = Math.max(sc.height, s.canvas.height);
        }
        const sctx = sc.getContext('2d');
        if (sctx) {
          sctx.clearRect(0, 0, sc.width, sc.height);
          sctx.drawImage(s.canvas, 0, 0);
          sctx.globalCompositeOperation = 'source-atop';
          sctx.fillStyle = f.tintHue === 0 ? '#ffffff' : `hsl(${f.tintHue} 90% 60%)`;
          sctx.fillRect(0, 0, s.canvas.width, s.canvas.height);
          sctx.globalCompositeOperation = 'source-over';
          ctx.globalAlpha = alpha * f.alpha * f.tint * 0.55;
          ctx.drawImage(
            sc,
            0, 0, s.canvas.width, s.canvas.height,
            -s.anchorX * scale,
            -s.anchorY * scale + targetH * 0.06,
            s.canvas.width * scale,
            s.canvas.height * scale,
          );
        }
      }
      ctx.restore();
    };
    drawOne(frames.a, 1);
    if (frames.b && frames.mix > 0.02) drawOne(frames.b, frames.mix);
    ctx.restore();

    // Guard stance: a glowing ward arc in front of the champion.
    if (f.guarding || f.mode === 'guard') {
      const cx = x + f.face * targetH * 0.28;
      const cy = y - targetH * 0.42;
      const mid = f.face === 1 ? 0 : Math.PI; // arc bulges toward the foe
      ctx.save();
      ctx.strokeStyle = `hsla(${f.hue} 85% 70% / ${0.65 + Math.sin(this.time * 9) * 0.15})`;
      ctx.lineWidth = 3.5 * this.dpr;
      ctx.beginPath();
      ctx.arc(cx, cy, targetH * 0.52, mid - Math.PI * 0.42, mid + Math.PI * 0.42);
      ctx.stroke();
      ctx.restore();
    }
  }
}
