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
  hue: number;
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
  kind: 'spark' | 'dust' | 'ember' | 'mote' | 'ring' | 'charge' | 'streak' | 'glint' | 'shock' | 'line';
  /** 'line': ray angle. 'charge': orbit angle around its target. */
  ang?: number;
  /** 'charge': the side whose champion is charging (follows the fighter). */
  side?: DuelSide;
}

/** A luminous point sampled off the backdrop painting (lava vein, waterfall,
 *  pond glint). Coordinates are fractions of the source image. */
interface FlowPoint {
  x: number;
  y: number;
  /** Strength 0–1 (how bright the sampled pixel was). */
  w: number;
  phase: number;
  /** Pulse speed (rad/s). */
  spd: number;
  /** True for column-like features (waterfalls / lava falls) that shed
   *  falling streaks rather than rising embers. */
  fall: boolean;
}

interface FloatText {
  x: number; y: number; txt: string; hue: number; t: number; big: boolean;
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

  /* Living backdrop: luminous points sampled from the painting. */
  private flowPoints: FlowPoint[] = [];
  private flowBuilt = false;
  private glowSprite: HTMLCanvasElement | null = null;

  /* Special-move cinematography. */
  private letterbox = 0;
  private slowmo = 0;
  private zoom = 1;
  private zoomTarget = 1;
  private zoomCX = 0.5;
  private zoomCY = 0.6;

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

  setFighter(side: DuelSide, species: SpeciesId, hue: number, entrance = true): void {
    this.fighters[side] = {
      species,
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
          const targetH = this.H * 0.26 * (DUEL_SCALE[f.species] ?? 0.9);
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

  /* ---------------------------------------------------------------------- */
  /* Living backdrop — the painting itself flows                             */
  /* ---------------------------------------------------------------------- */

  /** Last cover-fit placement of the backdrop, for mapping flow points. */
  private bd = { x: 0, y: 0, w: 1, h: 1 };

  /**
   * Samples the painted backdrop for luminous features — lava veins and
   * falls in the Basalt world, waterfalls and pond glints in the Oasis —
   * so the stage can animate them: pulsing glow, rising embers, falling
   * streaks and twinkling glints. The painting starts to flow.
   */
  private buildFlowMap(art: HTMLImageElement): void {
    this.flowBuilt = true;
    const SW = 120;
    const SH = Math.max(1, Math.round((art.height / art.width) * SW));
    const cv = document.createElement('canvas');
    cv.width = SW;
    cv.height = SH;
    const c = cv.getContext('2d', { willReadFrequently: true });
    if (!c) return;
    c.drawImage(art, 0, 0, SW, SH);
    const px = c.getImageData(0, 0, SW, SH).data;

    const strength = new Float32Array(SW * SH);
    for (let i = 0; i < SW * SH; i++) {
      const r = px[i * 4];
      const g = px[i * 4 + 1];
      const b = px[i * 4 + 2];
      if (this.world === 'basalt') {
        // Molten: strong red/orange dominance, bright.
        if (r > 165 && r - b > 70 && g < r * 0.82) {
          strength[i] = clamp01((r + g * 0.5 - 180) / 150);
        }
      } else {
        // Water: bright turquoise, or white foam with a cool cast.
        const turquoise = b > 120 && g > 120 && r < g * 0.9 && g + b > 300;
        const foam = r > 195 && g > 205 && b > 195;
        if (turquoise || foam) {
          strength[i] = clamp01((g + b - 260) / 200) * (foam ? 0.7 : 1);
        }
      }
    }

    const pts: FlowPoint[] = [];
    for (let y = 1; y < SH - 1; y++) {
      for (let x = 0; x < SW; x++) {
        const i = y * SW + x;
        if (strength[i] < 0.25) continue;
        // Columnar features (a bright run above AND below) behave like
        // falls; everything else pulses/twinkles in place.
        const fall = strength[i - SW] > 0.2 && strength[i + SW] > 0.2 && y < SH * 0.75;
        pts.push({
          x: (x + 0.5) / SW,
          y: (y + 0.5) / SH,
          w: strength[i],
          phase: Math.random() * Math.PI * 2,
          spd: 0.6 + Math.random() * 1.4,
          fall,
        });
      }
    }
    // Keep a bounded, bright-biased subset so the effect stays cheap.
    pts.sort((a, b) => b.w - a.w);
    this.flowPoints = pts
      .filter((_, i) => i < 60 || Math.random() < 140 / Math.max(1, pts.length))
      .slice(0, 190);

    // Prerendered soft radial glow (drawn with 'lighter').
    const g = document.createElement('canvas');
    g.width = 64;
    g.height = 64;
    const gc = g.getContext('2d');
    if (gc) {
      const grad = gc.createRadialGradient(32, 32, 1, 32, 32, 31);
      grad.addColorStop(0, 'rgba(255,255,255,1)');
      grad.addColorStop(0.4, 'rgba(255,255,255,0.35)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      gc.fillStyle = grad;
      gc.fillRect(0, 0, 64, 64);
    }
    this.glowSprite = g;
  }

  /** Map a flow point to current stage pixels (tracks the drift). */
  private flowPx(p: FlowPoint): { x: number; y: number } {
    return { x: this.bd.x + p.x * this.bd.w, y: this.bd.y + p.y * this.bd.h };
  }

  /** Additive pulsing glow over the painting's luminous features — makes
   *  lava breathe and water shimmer without touching the pixels beneath. */
  private drawFlowGlow(ctx: CanvasRenderingContext2D): void {
    if (!this.glowSprite || this.flowPoints.length === 0) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const baseR = Math.max(this.W, this.H) * (this.world === 'basalt' ? 0.02 : 0.014);
    for (const p of this.flowPoints) {
      const pulse = 0.5 + 0.5 * Math.sin(this.time * p.spd + p.phase);
      const a = p.w * (this.world === 'basalt' ? 0.16 : 0.1) * (0.35 + 0.65 * pulse);
      if (a < 0.015) continue;
      const at = this.flowPx(p);
      const r = baseR * (0.7 + p.w) * (0.8 + 0.4 * pulse);
      ctx.globalAlpha = a;
      // Tint via a hue-shifted shadow trick is costly; instead rely on the
      // white glow picking up the underlying saturated paint additively,
      // with a faint colored core.
      ctx.drawImage(this.glowSprite, at.x - r, at.y - r, r * 2, r * 2);
      ctx.fillStyle = this.world === 'basalt' ? 'hsl(24 100% 55%)' : 'hsl(180 80% 75%)';
      ctx.globalAlpha = a * 0.5;
      ctx.beginPath();
      ctx.arc(at.x, at.y, r * 0.28, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  /** Spawns flowing-world particles: embers off lava, spray off falls,
   *  glints on water. Called once per frame. */
  private spawnFlow(): void {
    if (this.flowPoints.length === 0) return;
    const budget = this.world === 'basalt' ? 3 : 3;
    for (let n = 0; n < budget; n++) {
      if (Math.random() > 0.55) continue;
      const p = this.flowPoints[(Math.random() * this.flowPoints.length) | 0];
      const at = this.flowPx(p);
      if (this.world === 'basalt') {
        if (p.fall) {
          // Molten droplets sliding down the falls.
          this.particles.push({
            x: at.x + (Math.random() - 0.5) * this.W * 0.008,
            y: at.y,
            vx: (Math.random() - 0.5) * this.W * 0.004,
            vy: this.H * (0.05 + Math.random() * 0.06),
            life: 0.8 + Math.random() * 0.7,
            t: 0,
            size: 1 + Math.random() * 1.6,
            hue: 18 + Math.random() * 18,
            kind: 'streak',
          });
        } else {
          // Heat embers lifting off the veins.
          this.particles.push({
            x: at.x,
            y: at.y,
            vx: (Math.random() - 0.5) * this.W * 0.012,
            vy: -this.H * (0.02 + Math.random() * 0.045),
            life: 1.6 + Math.random() * 2.2,
            t: 0,
            size: 0.8 + Math.random() * 1.8,
            hue: 16 + Math.random() * 26,
            kind: 'ember',
          });
        }
      } else {
        if (p.fall) {
          // White spray running down the waterfalls.
          this.particles.push({
            x: at.x + (Math.random() - 0.5) * this.W * 0.006,
            y: at.y,
            vx: (Math.random() - 0.5) * this.W * 0.003,
            vy: this.H * (0.055 + Math.random() * 0.075),
            life: 0.6 + Math.random() * 0.5,
            t: 0,
            size: 0.8 + Math.random() * 1.4,
            hue: 185,
            kind: 'streak',
          });
        } else {
          // Sun glints twinkling on the pond.
          this.particles.push({
            x: at.x,
            y: at.y,
            vx: 0,
            vy: 0,
            life: 0.7 + Math.random() * 0.8,
            t: 0,
            size: 1.2 + Math.random() * 2.2,
            hue: 60 + Math.random() * 120,
            kind: 'glint',
          });
        }
      }
    }
    // A little generic atmosphere on top.
    if (Math.random() < 0.25) {
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
    const fly = FLYERS.has(f.species) ? -this.H * 0.1 : 0;
    return { x: this.W * f.homeX + f.x, y: this.groundY() + f.y + fly };
  }

  private runStep(step: Step): void {
    const ev = step.ev;
    const A = this.fighters[ev.side];
    const D = this.fighters[(1 - ev.side) as DuelSide];
    if (!A || !D) {
      step.t = step.dur;
      return;
    }
    const gap = this.W * (0.74 - 0.26);
    const t = step.t;

    switch (ev.kind) {
      case 'clash': {
        // Timeline offsets: special moves get a slow-motion charge-up
        // prologue — the whole stage bends around the gathering power.
        const pre = ev.special ? 1.05 : 0;
        if (ev.special) {
          this.fire(step, 'announce', 0, () => {
            this.banner = { txt: ev.label ?? 'SPECIAL', sub: undefined, t: 0, dur: step.dur, hue: A.hue };
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
        const wEnd = pre + 0.32;
        const dEnd = wEnd + 0.26;
        // Wind-up: coil back and crouch.
        if (t < wEnd) {
          A.mode = 'idle';
          A.x = -A.face * easeOut(ph(t, pre, wEnd)) * this.W * 0.05;
          A.squash = easeOut(ph(t, pre, wEnd)) * 0.12;
          D.guarding = !!ev.blocked;
          if (D.guarding) D.mode = 'guard';
        } else if (t < dEnd) {
          // Dash across the arena (specials streak with afterimages).
          A.mode = 'dash';
          const k = easeIn(ph(t, wEnd, dEnd));
          A.x = A.face * (k * (gap - this.W * 0.13) - this.W * 0.05 * (1 - k));
          A.squash = 0;
          A.runPhase += 0.6;
          if (ev.special) {
            this.zoomTarget = 1.08;
            this.zoomCX = 0.5;
          }
          if (Math.random() < 0.7) this.dust(this.fighterPx(A).x, this.groundY());
        } else {
          // Impact and recovery.
          this.fire(step, 'impact', dEnd, () => {
            A.mode = 'attack';
            A.animT = 0;
            if (ev.evaded) {
              D.mode = 'evade';
              D.animT = 0;
              this.text(this.fighterPx(D).x, this.groundY() - this.H * 0.3, 'MISS', 200, false);
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
              this.text(
                dp.x, dp.y - this.H * 0.34,
                `${dmg}`,
                ev.blocked ? 200 : ev.crit ? 48 : 6,
                !!(ev.crit || ev.special),
              );
              if (ev.blocked) this.text(dp.x, dp.y - this.H * 0.42, 'BLOCKED', 200, false);
              else if (ev.crit) this.text(dp.x, dp.y - this.H * 0.42, 'CRITICAL!', 48, false);
              this.onImpact?.(A.species, !!ev.special, false);
            }
            this.onEventApplied?.(ev);
          });
          const k = easeOut(ph(t, dEnd + 0.18, step.dur));
          A.x = A.face * (gap - this.W * 0.13) * (1 - k);
          if (t > dEnd + 0.18) {
            A.mode = 'dash';
            A.runPhase += 0.35;
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
            this.text(dp.x, dp.y - this.H * 0.3, `${ev.dmg ?? 0}`, ev.label === 'QUILLS' ? 160 : 40, false);
            if (ev.label) this.text(dp.x, dp.y - this.H * 0.38, ev.label, 160, false);
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
          const p = this.fighterPx(F);
          this.text(p.x, p.y - this.H * 0.32, `${ev.dmg ?? 0}`, ev.label === 'VENOM' ? 120 : 25, false);
          if (ev.label) this.text(p.x, p.y - this.H * 0.4, ev.label, ev.label === 'VENOM' ? 120 : 25, false);
          this.onEventApplied?.(ev);
        });
        break;
      }

      case 'status':
      case 'skip': {
        const F = this.fighters[ev.side];
        if (!F) break;
        this.fire(step, 'show', 0.1, () => {
          const p = this.fighterPx(F);
          this.text(p.x, p.y - this.H * 0.38, ev.label ?? '', ev.kind === 'skip' ? 55 : 280, true);
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
        const k = ph(t, 0.1, 0.85);
        F.rot = F.face * easeOut(k) * 1.35;
        F.y = easeIn(k) * this.H * 0.02;
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

  private text(x: number, y: number, txt: string, hue: number, big: boolean): void {
    this.texts.push({ x, y, txt, hue, t: 0, big });
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
      if (!this.flowBuilt) this.buildFlowMap(art);
      const drift = Math.sin(this.time * 0.07) * 0.006;
      const scale = Math.max(W / art.width, H / art.height) * (1.03 + drift);
      const dw = art.width * scale;
      const dh = art.height * scale;
      const dx = (W - dw) / 2 + Math.sin(this.time * 0.05) * W * 0.004;
      const dy = H - dh;
      this.bd = { x: dx, y: dy, w: dw, h: dh };
      ctx.drawImage(art, dx, dy, dw, dh);
      this.spawnFlow();
      this.drawFlowGlow(ctx);
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

    // Back-to-front: ambient + backdrop flow behind, then fighters, then FX.
    for (const p of this.particles) {
      const k = p.t / p.life;
      if (p.kind === 'ember' || p.kind === 'mote') {
        const a = 0.5 * (1 - k);
        ctx.fillStyle = `hsla(${p.hue} 90% 65% / ${a})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * this.dpr * 0.7, 0, Math.PI * 2);
        ctx.fill();
      } else if (p.kind === 'streak') {
        // Falling droplet/spray: a short vertical smear.
        const a = (this.world === 'basalt' ? 0.75 : 0.6) * Math.sin(Math.min(1, k) * Math.PI);
        const len = Math.max(3, Math.abs(p.vy) * 0.09);
        ctx.strokeStyle = this.world === 'basalt'
          ? `hsla(${p.hue} 95% 62% / ${a})`
          : `hsla(${p.hue} 60% 92% / ${a})`;
        ctx.lineWidth = p.size * this.dpr * 0.8;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y - len);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
      } else if (p.kind === 'glint') {
        // Twinkle: a tiny 4-point star that blooms and dies.
        const a = Math.sin(Math.min(1, k) * Math.PI);
        const r = p.size * this.dpr * (0.8 + a);
        ctx.strokeStyle = `hsla(${p.hue} 70% 90% / ${0.85 * a})`;
        ctx.lineWidth = 1 * this.dpr;
        ctx.beginPath();
        ctx.moveTo(p.x - r, p.y);
        ctx.lineTo(p.x + r, p.y);
        ctx.moveTo(p.x, p.y - r);
        ctx.lineTo(p.x, p.y + r);
        ctx.stroke();
      }
    }

    for (const side of [1, 0] as DuelSide[]) {
      const f = this.fighters[side];
      if (f && f.mode !== 'gone') this.drawFighter(f);
    }

    // Foreground FX.
    for (const p of this.particles) {
      if (p.kind === 'ember' || p.kind === 'mote' || p.kind === 'streak' || p.kind === 'glint') continue;
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

    // Floating damage numbers.
    for (const t of this.texts) {
      const a = t.t < 0.15 ? t.t / 0.15 : 1 - Math.max(0, (t.t - 0.55) / 0.65);
      const pop = t.t < 0.18 ? 1 + (0.18 - t.t) * 2.2 : 1;
      const size = (t.big ? 0.075 : 0.045) * H * pop;
      ctx.save();
      ctx.globalAlpha = clamp01(a);
      ctx.font = `900 ${size}px Georgia, 'Times New Roman', serif`;
      ctx.textAlign = 'center';
      ctx.lineWidth = size * 0.14;
      ctx.strokeStyle = 'rgba(10,6,4,0.85)';
      ctx.strokeText(t.txt, t.x, t.y);
      ctx.fillStyle = `hsl(${t.hue} 95% 72%)`;
      ctx.fillText(t.txt, t.x, t.y);
      ctx.restore();
    }

    // Move banner.
    if (this.banner) {
      const b = this.banner;
      const a = b.t < 0.2 ? b.t / 0.2 : 1 - Math.max(0, (b.t - (b.dur - 0.4)) / 0.4);
      ctx.save();
      ctx.globalAlpha = clamp01(a);
      const y = H * 0.3;
      const g = ctx.createLinearGradient(0, y - H * 0.07, 0, y + H * 0.05);
      g.addColorStop(0, 'rgba(8,5,3,0)');
      g.addColorStop(0.5, 'rgba(8,5,3,0.66)');
      g.addColorStop(1, 'rgba(8,5,3,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, y - H * 0.07, W, H * 0.13);
      ctx.font = `900 ${H * 0.058}px Georgia, serif`;
      ctx.textAlign = 'center';
      ctx.lineWidth = H * 0.008;
      ctx.strokeStyle = 'rgba(10,6,4,0.9)';
      ctx.strokeText(b.txt, W / 2, y + H * 0.012);
      ctx.fillStyle = `hsl(${b.hue} 90% 70%)`;
      ctx.fillText(b.txt, W / 2, y + H * 0.012);
      if (b.sub) {
        ctx.font = `700 ${H * 0.026}px Georgia, serif`;
        ctx.fillStyle = 'rgba(240,230,215,0.92)';
        ctx.fillText(b.sub, W / 2, y + H * 0.052);
      }
      ctx.restore();
    }

    ctx.restore();

    // Cinematic letterbox (drawn outside the shaken/zoomed camera).
    if (this.letterbox > 0.01) {
      const bar = this.letterbox * H * 0.065;
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
    if (f.mode === 'attack') {
      const at = clamp01(f.animT / 0.5);
      const idx = at < 0.35 ? 0 : at < 0.7 ? 1 : 2;
      return { a: anim.attack[Math.min(idx, anim.attack.length - 1)], b: null, mix: 0 };
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
    const targetH = this.H * 0.26 * (DUEL_SCALE[f.species] ?? 0.9);
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
      if (f.face !== s.nativeFacing) ctx.scale(-1, 1);
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
