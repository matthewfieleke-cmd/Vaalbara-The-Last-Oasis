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
  trex: 1.5,
  bear: 1.42,
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
}

interface Particle {
  x: number; y: number; vx: number; vy: number;
  life: number; t: number; size: number; hue: number;
  kind: 'spark' | 'dust' | 'ember' | 'mote' | 'ring';
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
      homeX: side === 0 ? 0.26 : 0.74,
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
    };
  }

  /** True while a script is still playing out. */
  get busy(): boolean {
    return this.queue.length > 0;
  }

  playScript(events: DuelEvent[]): void {
    for (const ev of events) {
      let dur = 1.5;
      if (ev.kind === 'clash') dur = ev.special ? 2.3 : 1.55;
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
    const wantVignette = this.queue[0]?.ev.special ? 1 : 0;
    this.vignette += (wantVignette - this.vignette) * Math.min(1, dt * 5);

    for (const f of this.fighters) {
      if (!f) continue;
      f.animT += dt;
      f.tint = Math.max(0, f.tint - dt * 2.4);
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
      step.t += dt;
      this.runStep(step);
      if (step.t >= step.dur) {
        this.queue.shift();
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

    // Ambient atmosphere.
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

  private fire(step: Step, key: string, at: number, fn: () => void): void {
    if (step.t >= at && !step.fired.has(key)) {
      step.fired.add(key);
      fn();
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
        // Timeline offsets: special moves get a charge-up prologue.
        const pre = ev.special ? 0.7 : 0;
        if (ev.special) {
          this.fire(step, 'announce', 0, () => {
            this.banner = { txt: ev.label ?? 'SPECIAL', sub: undefined, t: 0, dur: step.dur, hue: A.hue };
          });
          A.aura = Math.min(1, ph(t, 0, pre) * 1.2);
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
          // Dash across the arena.
          A.mode = 'dash';
          const k = easeIn(ph(t, wEnd, dEnd));
          A.x = A.face * (k * (gap - this.W * 0.13) - this.W * 0.05 * (1 - k));
          A.squash = 0;
          A.runPhase += 0.6;
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
              this.freeze = ev.special ? 0.16 : ev.crit ? 0.13 : 0.09;
              this.shake = ev.special ? 14 : ev.crit ? 10 : 6;
              this.flash = ev.special ? 0.9 : 0.45;
              this.flashHue = A.hue;
              D.tint = 1;
              D.tintHue = 0;
              const dp = this.fighterPx(D);
              this.sparks(dp.x - D.face * 0, dp.y - this.H * 0.12, ev.special ? 26 : 14, A.hue);
              this.ring(dp.x, dp.y - this.H * 0.12, A.hue);
              this.text(
                dp.x, dp.y - this.H * 0.34,
                ev.blocked ? `${dmg}` : `${dmg}`,
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
            const kb = Math.exp(-ph(t, dEnd, step.dur) * 5) * this.W * (ev.special ? 0.045 : 0.028);
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

    // Painted backdrop, cover-fit with a slow breathing drift.
    const art = getDuelArt(this.world);
    if (art) {
      const drift = Math.sin(this.time * 0.07) * 0.006;
      const scale = Math.max(W / art.width, H / art.height) * (1.03 + drift);
      const dw = art.width * scale;
      const dh = art.height * scale;
      ctx.drawImage(art, (W - dw) / 2 + Math.sin(this.time * 0.05) * W * 0.004, H - dh, dw, dh);
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

    // Back-to-front: far fighter first? Both on same ground line — draw
    // ambient behind, then fighters, then FX.
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
      const y = H * 0.16;
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
      ctx.restore();
    };
    drawOne(frames.a, 1);
    if (frames.b && frames.mix > 0.02) drawOne(frames.b, frames.mix);

    // Damage tint flash overlay via composite.
    if (f.tint > 0.03) {
      ctx.globalCompositeOperation = 'source-atop';
      const hue = f.tintHue;
      ctx.globalAlpha = f.tint * 0.4;
      ctx.fillStyle = hue === 0 ? '#ffffff' : `hsl(${hue} 90% 60%)`;
      ctx.fillRect(-targetH, -targetH * 1.8, targetH * 2, targetH * 2.2);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    }
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
