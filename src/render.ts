/* ============================================================================
 * VAALBARA: THE LAST OASIS — render-core.ts
 * Procedural 2.5D renderer over the CONTINUOUS world.
 *
 *  - The arena paintings are the ground truth: they are drawn full-bleed as
 *    the battlefield (rotated 180° for seat 1 so art and physics stay in
 *    register), with animated accents (lava bloom, water ripples, reed sway)
 *    keyed to sample points read from the same navmask the sim collides
 *    against.
 *  - Characters play their painted FRAME ANIMATIONS: 4-frame run cycles at a
 *    cadence tied to their actual speed, 3-frame attack strikes timed to the
 *    swing (anticipation -> strike -> recoil), the bear's rear-up swat when
 *    striking flyers, plus hit flashes, knock jiggle, death tip-overs,
 *    hit-stop and screen shake.
 *  - Runs its own rAF loop at display refresh, decoupled from the 300 ms sim
 *    tick, with visual catch-up interpolation for network corrections.
 * ========================================================================== */

import { TICK_MS, WORLD_H, WORLD_W } from './types';
import type { GameEvent, GameState, ObeliskState, PlayerId, SpeciesId } from './types';
import { speciesDef } from './data';
import { getAnim, getPhaseArt, getSprite } from './sprites';
import type { Sprite } from './sprites';
import { CELL, cellAt } from './navmask';
import type { WorldId } from './navmask';
import { drawSpecies } from './vector-art';

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Per-species sprite size trims. Swarm critters read at critter scale. */
const SIZE_TWEAK: Partial<Record<SpeciesId, number>> = {
  fireants: 0.5,
  bees: 0.85,
  wolves: 0.94,
};

const spriteHeight = (s: number, species: SpeciesId, colossal: boolean, heavy: boolean): number =>
  s * (colossal ? 2.5 : heavy ? 2.2 : 1.9) * (SIZE_TWEAK[species] ?? 1);

/** Base footprint scale per weight class (px per world unit multiplier).
 *  Generous: with the 4-unit army cap, big readable actors are the point. */
const unitScale = (colossal: boolean, heavy: boolean): number =>
  colossal ? 0.92 : heavy ? 0.8 : 0.64;

/* ------------------------------------------------------------------------ */

interface Particle {
  x: number; y: number; vx: number; vy: number;
  life: number; maxLife: number;
  size: number; hue: number; sat: number; lit: number;
  kind: 'spark' | 'ash' | 'ripple' | 'mist' | 'flash' | 'mote' | 'bubble' | 'shockwave' | 'petal';
  alpha: number;
  gravity: number;
}

interface FloatText {
  x: number; y: number; text: string; life: number; maxLife: number; color: string; size: number;
}

interface AttackAnim {
  t0: number;
  dirX: number;
  dirY: number;
  crit: boolean;
  /** Bear anti-air: play the rear-up swat sheet. */
  air: boolean;
}

interface Jiggle {
  t0: number;
  dirX: number;
  dirY: number;
  mag: number;
}

interface Ghost {
  species: SpeciesId;
  variant: number;
  owner: PlayerId;
  facing: 1 | -1;
  x: number;
  y: number;
  heavy: boolean;
  colossal: boolean;
  t: number;
}

/** Which painted view a unit is currently showing: 3/4 rear (marching away),
 *  3/4 front (marching toward the camera) or the side profile. */
type ViewDir = 'up' | 'down' | 'side';

interface DisplayUnit {
  dx: number; dy: number;
  runPhase: number;
  age: number;
  /** Displayed facing, with hysteresis so steering wobble can't strobe it. */
  face: 1 | -1;
  faceHold: number;
  /** Body pitch (canvas radians, unmirrored space) toward travel direction —
   *  side-profile art reads as "heading" up/down field instead of strafing. */
  lean: number;
  /** Directional view with hysteresis — Clash-style marching art. */
  dir: ViewDir;
  dirHold: number;
  /** Water immersion 0–1: how deep the legs sit below the pond surface. */
  wet: number;
  atk?: AttackAnim;
  jig?: Jiggle;
}

export interface DragOverlay {
  active: boolean;
  fromX: number; fromY: number;
  toX: number; toY: number;
  valid: boolean;
  hue: number;
}

export interface TelegraphOverlay {
  active: boolean;
  x: number; y: number;
  kind: 'spell' | 'ult';
}

/* ------------------------------------------------------------------------ */
/* Terrain accent sample points, read from the navmask                        */
/* ------------------------------------------------------------------------ */

interface AccentPoints {
  lavaEdge: Array<{ x: number; y: number }>;
  water: Array<{ x: number; y: number }>;
}

const accentCache = new Map<WorldId, AccentPoints>();

function accentsFor(world: WorldId): AccentPoints {
  const hit = accentCache.get(world);
  if (hit) return hit;
  const lavaEdge: Array<{ x: number; y: number }> = [];
  const water: Array<{ x: number; y: number }> = [];
  for (let y = 0.6; y < WORLD_H - 0.6; y += 0.45) {
    for (let x = 0.55; x < WORLD_W - 0.55; x += 0.45) {
      const c = cellAt(world, x, y);
      if (world === 'basalt' && c === CELL.BLOCKED) {
        // Interior lava only (river edges glow; border rim does not).
        const nearOpen =
          cellAt(world, x + 0.5, y) !== CELL.BLOCKED || cellAt(world, x - 0.5, y) !== CELL.BLOCKED ||
          cellAt(world, x, y + 0.5) !== CELL.BLOCKED || cellAt(world, x, y - 0.5) !== CELL.BLOCKED;
        if (nearOpen && x > 0.8 && x < WORLD_W - 0.8) lavaEdge.push({ x, y });
      } else if (c === CELL.SHALLOW || c === CELL.DEEP) {
        water.push({ x, y });
      }
    }
  }
  const pts = { lavaEdge, water };
  accentCache.set(world, pts);
  return pts;
}

/* ========================================================================== */

export class Renderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private state: GameState | null = null;
  private lastTickAt = 0;
  private particles: Particle[] = [];
  private floats: FloatText[] = [];
  private display = new Map<number, DisplayUnit>();
  private flashes = new Map<number, number>();
  private obeliskFlash = new Map<PlayerId, number>();
  private ghosts: Ghost[] = [];
  private hitStop = 0;
  private lastHitDir = new Map<number, { x: number; y: number }>();
  private raf = 0;
  private running = false;
  private time = 0;
  /** Seconds since the last sim tick, in RENDER time (freezes in hit-stop). */
  private tickClock = 0;
  private lastFrame = 0;
  private camPan = 0;
  private shake = 0;
  localSeat: PlayerId = 0;
  drag: DragOverlay = { active: false, fromX: 0, fromY: 0, toX: 0, toY: 0, valid: false, hue: 0 };
  telegraph: TelegraphOverlay = { active: false, x: 0, y: 0, kind: 'spell' };

  // Layout.
  private unit = 40; // px per world unit
  private ox = 0;
  private oy = 0;
  private dpr = 1;

  // Offscreen scratch for tint/flash compositing.
  private artCanvas = document.createElement('canvas');
  private tintCanvas = document.createElement('canvas');

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Canvas 2D unsupported');
    this.ctx = ctx;
  }

  resize(cssW: number, cssH: number): void {
    this.dpr = clamp(window.devicePixelRatio || 1, 1, 2);
    this.canvas.width = Math.round(cssW * this.dpr);
    this.canvas.height = Math.round(cssH * this.dpr);
    this.canvas.style.width = `${cssW}px`;
    this.canvas.style.height = `${cssH}px`;
    this.unit = Math.min(cssW / (WORLD_W + 0.5), cssH / (WORLD_H + 1.6));
    this.ox = (cssW - WORLD_W * this.unit) / 2;
    this.oy = (cssH - WORLD_H * this.unit) / 2 + this.unit * 0.35;
  }

  /** World -> screen px. Seat 1 sees the world rotated 180°. */
  worldToScreen(wx: number, wy: number): { x: number; y: number } {
    const fx = this.localSeat === 1 ? WORLD_W - wx : wx;
    const fy = this.localSeat === 1 ? WORLD_H - wy : wy;
    return { x: this.ox + fx * this.unit, y: this.oy + fy * this.unit };
  }

  screenToWorld(px: number, py: number): { x: number; y: number } {
    const fx = (px - this.ox) / this.unit;
    const fy = (py - this.oy) / this.unit;
    return {
      x: this.localSeat === 1 ? WORLD_W - fx : fx,
      y: this.localSeat === 1 ? WORLD_H - fy : fy,
    };
  }

  private boardRect(): { left: number; top: number; w: number; h: number } {
    return { left: this.ox, top: this.oy, w: WORLD_W * this.unit, h: WORLD_H * this.unit };
  }

  /* --------------------------- state ingestion -------------------------- */

  onTick(state: GameState, events: GameEvent[]): void {
    this.state = state;
    this.lastTickAt = performance.now();
    this.tickClock = 0;
    for (const e of events) this.consumeEvent(e);
  }

  private consumeEvent(e: GameEvent): void {
    switch (e.type) {
      case 'spawn': {
        const p = this.worldToScreen(e.x, e.y);
        const stats = speciesDef(e.species).stats!;
        this.burst(p.x, p.y, 10, 'mist', e.owner === this.localSeat ? 190 : 20, 1.4);
        this.burst(p.x, p.y + this.unit * 0.12, 1, 'shockwave', e.owner === this.localSeat ? 190 : 25, 0.6);
        this.burst(p.x, p.y + this.unit * 0.08, 7, 'ash', 35, 1.0);
        if (stats.heavy || stats.colossal) this.shake = Math.max(this.shake, stats.colossal ? 5 : 3);
        break;
      }
      case 'attack': {
        const from = this.worldToScreen(e.x, e.y);
        const to = this.worldToScreen(e.tx, e.ty);
        const len = Math.hypot(to.x - from.x, to.y - from.y) || 1;
        const dir = { x: (to.x - from.x) / len, y: (to.y - from.y) / len };
        const d = this.display.get(e.unitId);
        if (d) d.atk = { t0: this.time, dirX: dir.x, dirY: dir.y, crit: e.crit, air: e.air };
        this.rememberHitDir(e.tx, e.ty, dir);
        if (e.crit) {
          this.burst(to.x, to.y, 16, 'spark', 45, 2.2);
          this.shake = Math.max(this.shake, 7);
          this.hitStop = Math.max(this.hitStop, 0.09);
        }
        break;
      }
      case 'shoot': {
        const p = this.worldToScreen(e.x, e.y);
        this.burst(p.x, p.y - this.unit * 0.5, 5, 'mote', 90, 0.9);
        break;
      }
      case 'splash': {
        const p = this.worldToScreen(e.x, e.y);
        this.burst(p.x, p.y, 12, 'spark', 85, 1.3);
        this.burst(p.x, p.y, 4, 'bubble', 80, 1);
        break;
      }
      case 'hit': {
        const p = this.worldToScreen(e.x, e.y);
        const hue = e.kind === 'burn' ? 20 : e.kind === 'lava' ? 8 : e.kind === 'vent' ? 55 : e.kind === 'reflect' ? 160 : 0;
        this.burst(p.x, p.y, e.kind === 'lava' ? 18 : 5, e.kind === 'lava' ? 'spark' : 'flash', hue, 1.4);
        if (e.kind === 'melee' || e.kind === 'ranged' || e.kind === 'lava') {
          this.flashes.set(e.unitId, 0.22);
          const dir = this.recallHitDir(e.x, e.y) ?? { x: 0.7, y: 0.3 };
          const d = this.display.get(e.unitId);
          if (d) d.jig = { t0: this.time, dirX: dir.x, dirY: dir.y, mag: clamp(2 + e.amount * 0.12, 2, 7) };
          // Impact sparks fly AWAY from the blow, heavier hits ring a
          // shockwave — melee reads like a real collision, not a tap.
          const n = Math.round(clamp(4 + e.amount * 0.25, 4, 12));
          for (let i = 0; i < n; i++) {
            const spread = (Math.random() - 0.5) * 1.6;
            const ca = Math.atan2(dir.y, dir.x) + spread;
            const sp = (60 + Math.random() * 90) * clamp(0.6 + e.amount * 0.02, 0.6, 1.6);
            this.particles.push({
              x: p.x, y: p.y - this.unit * 0.3,
              vx: Math.cos(ca) * sp, vy: Math.sin(ca) * sp - 30,
              life: 0, maxLife: 0.3 + Math.random() * 0.25,
              size: 1.4 + Math.random() * 2.2,
              hue: e.kind === 'melee' ? 45 : 30, sat: 95, lit: 68,
              kind: 'spark', alpha: 1, gravity: 200,
            });
          }
          if (e.amount >= 22) this.burst(p.x, p.y - this.unit * 0.25, 1, 'shockwave', 40, 0.5);
          if (e.amount >= 30) this.hitStop = Math.max(this.hitStop, 0.05);
        }
        const big = e.amount >= 26;
        this.floats.push({
          x: p.x + (Math.random() - 0.5) * 14, y: p.y - this.unit * 0.5,
          text: `-${e.amount}`, life: 0, maxLife: big ? 1.05 : 0.9,
          color: e.kind === 'burn' ? '#ff9d45' : e.kind === 'reflect' ? '#6dffc9' : big ? '#ffd24a' : '#ffffff',
          size: clamp(10 + e.amount * 0.16, 10, 24),
        });
        break;
      }
      case 'death': {
        const p = this.worldToScreen(e.x, e.y);
        this.burst(p.x, p.y, 22, 'spark', e.owner === 0 ? 14 : 165, 2.0);
        this.burst(p.x, p.y, 8, 'mist', 0, 1.5);
        const stats = speciesDef(e.species).stats!;
        const dir = this.recallHitDir(e.x, e.y);
        this.ghosts.push({
          species: e.species,
          variant: e.unitId % 2,
          owner: e.owner,
          facing: (dir?.x ?? 1) >= 0 ? 1 : -1,
          x: e.x, y: e.y,
          heavy: stats.heavy,
          colossal: stats.colossal,
          t: 0,
        });
        this.hitStop = Math.max(this.hitStop, stats.heavy || stats.colossal ? 0.09 : 0.05);
        if (stats.heavy || stats.colossal) this.shake = Math.max(this.shake, 5);
        break;
      }
      case 'heal': {
        const p = this.worldToScreen(e.x, e.y);
        this.burst(p.x, p.y, 12, 'mote', 140, 1.6);
        this.floats.push({ x: p.x, y: p.y - this.unit * 0.6, text: `+${e.amount}`, life: 0, maxLife: 1, color: '#7dffa8', size: 13 });
        break;
      }
      case 'roar': {
        const p = this.worldToScreen(e.x, e.y);
        this.burst(p.x, p.y, 3, 'shockwave', 40, 1);
        this.shake = Math.max(this.shake, 5);
        break;
      }
      case 'stomp': {
        const p = this.worldToScreen(e.x, e.y);
        this.burst(p.x, p.y, 1, 'shockwave', 25, 1);
        this.burst(p.x, p.y, 8, 'ash', 30, 1.2);
        this.shake = Math.max(this.shake, 3);
        break;
      }
      case 'charge': {
        const p = this.worldToScreen(e.x, e.y);
        this.burst(p.x, p.y, 10, 'spark', 90, 1.8);
        break;
      }
      case 'spellCast': {
        const p = this.worldToScreen(e.x, e.y);
        if (e.spell === 'sulfur') this.burst(p.x, p.y, 20, 'mist', 55, 2.2);
        else if (e.spell === 'thicket') this.burst(p.x, p.y, 16, 'petal', 110, 2);
        break;
      }
      case 'lavaStrike': {
        const p = this.worldToScreen(e.x, e.y);
        this.burst(p.x, p.y, 46, 'spark', 12, 3.2);
        this.burst(p.x, p.y, 4, 'shockwave', 12, 1);
        this.burst(p.x, p.y, 16, 'ash', 20, 2);
        this.shake = 14;
        break;
      }
      case 'lotusBurst': {
        const p = this.worldToScreen(e.x, e.y);
        this.burst(p.x, p.y, 20, 'mote', 140, 2.4);
        this.burst(p.x, p.y, 10, 'petal', 320, 1.8);
        break;
      }
      case 'obeliskHit': {
        const p = this.worldToScreen(e.x, e.y);
        const mine = e.owner === this.localSeat;
        this.burst(p.x, p.y - this.unit * 0.7, 8, 'spark', mine ? 190 : 30, 1.4);
        this.obeliskFlash.set(e.owner, 0.24);
        this.floats.push({
          x: p.x, y: p.y - this.unit * 1.4,
          text: `-${e.amount}`, life: 0, maxLife: 0.9,
          color: mine ? '#ff8f6d' : '#ffe08a',
          size: clamp(11 + e.amount * 0.1, 11, 19),
        });
        if (mine) this.shake = Math.max(this.shake, 2.5);
        break;
      }
      case 'obeliskDown': {
        const p = this.worldToScreen(e.x, e.y);
        this.burst(p.x, p.y - this.unit * 0.6, 40, 'spark', 40, 3);
        this.burst(p.x, p.y, 5, 'shockwave', 40, 1.4);
        this.burst(p.x, p.y, 20, 'ash', 30, 2.2);
        this.shake = 16;
        this.hitStop = Math.max(this.hitStop, 0.12);
        break;
      }
      default:
        break;
    }
  }

  private rememberHitDir(x: number, y: number, dir: { x: number; y: number }): void {
    this.lastHitDir.set(Math.round(x * 4) * 1000 + Math.round(y * 4), dir);
  }

  private recallHitDir(x: number, y: number): { x: number; y: number } | undefined {
    return this.lastHitDir.get(Math.round(x * 4) * 1000 + Math.round(y * 4));
  }

  private burst(x: number, y: number, n: number, kind: Particle['kind'], hue: number, power: number): void {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = (0.4 + Math.random() * 1.2) * power * 30;
      this.particles.push({
        x, y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - (kind === 'spark' ? 40 : kind === 'mote' ? 20 : 0),
        life: 0,
        maxLife: kind === 'shockwave' ? 0.5 : kind === 'ripple' ? 1.1 : 0.5 + Math.random() * 0.8,
        size: kind === 'shockwave' ? 4 : kind === 'mist' ? 8 + Math.random() * 10 : 1.5 + Math.random() * 2.5,
        hue: hue + (Math.random() - 0.5) * 18,
        sat: kind === 'ash' ? 10 : 85,
        lit: kind === 'spark' ? 60 : kind === 'flash' ? 85 : 55,
        kind,
        alpha: 1,
        gravity: kind === 'spark' ? 130 : kind === 'ash' ? 12 : kind === 'mote' ? -30 : kind === 'petal' ? 24 : 0,
      });
    }
    if (this.particles.length > 700) this.particles.splice(0, this.particles.length - 700);
  }

  /* ------------------------------ main loop ----------------------------- */

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastFrame = performance.now();
    const loop = (now: number) => {
      if (!this.running) return;
      const rawDt = clamp((now - this.lastFrame) / 1000, 0, 0.1);
      this.lastFrame = now;
      this.hitStop = Math.max(0, this.hitStop - rawDt);
      const dt = this.hitStop > 0 ? rawDt * 0.1 : rawDt;
      this.time += dt;
      this.tickClock += dt;
      this.frame(dt, now);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  private frame(dt: number, now: number): void {
    const ctx = this.ctx;
    const st = this.state;
    const W = this.canvas.width / this.dpr;
    const H = this.canvas.height / this.dpr;
    ctx.save();
    ctx.scale(this.dpr, this.dpr);

    this.shake = Math.max(0, this.shake - dt * 26);
    if (this.shake > 0) {
      ctx.translate((Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake);
    }

    const wantPan = st && (st.phase === 'oasis' || st.phase === 'ended') ? 1 : st?.phase === 'transition' ? 0.5 : 0;
    this.camPan += (wantPan - this.camPan) * clamp(dt * 1.6, 0, 1);

    this.drawBackdrop(ctx, W, H);
    if (st) {
      this.drawArena(ctx, st);
      this.drawZones(ctx, st, 'under');
      this.drawObjectives(ctx, st, dt);
      this.drawTelegraphs(ctx, st, now);
      this.drawUnits(ctx, st, dt, now);
      this.drawProjectiles(ctx, st, now);
      this.drawZones(ctx, st, 'over');
      this.drawAtmosphere(ctx, W, H);
      if (st.phase === 'transition') this.drawTransition(ctx, st, W, H);
      this.drawDragOverlay(ctx);
      this.drawPlacementTelegraph(ctx);
    }
    this.updateParticles(ctx, dt);
    this.updateFloats(ctx, dt);
    this.drawVignette(ctx, W, H);
    ctx.restore();
  }

  /* ----------------------------- backdrop ------------------------------- */

  private drawBackdrop(ctx: CanvasRenderingContext2D, W: number, H: number): void {
    const pan = this.camPan;
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, `hsl(${lerp(356, 168, pan)} ${lerp(45, 42, pan)}% ${lerp(9, 14, pan)}%)`);
    g.addColorStop(0.55, `hsl(${lerp(8, 165, pan)} ${lerp(40, 35, pan)}% ${lerp(13, 12, pan)}%)`);
    g.addColorStop(1, `hsl(${lerp(18, 150, pan)} ${lerp(60, 45, pan)}% ${lerp(8, 9, pan)}%)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    for (let layer = 0; layer < 3; layer++) {
      const y0 = H * (0.10 + layer * 0.045);
      ctx.beginPath();
      ctx.moveTo(0, y0 + 30);
      for (let x = 0; x <= W; x += 14) {
        const n = Math.sin(x * 0.021 + layer * 9.1) * 12 + Math.sin(x * 0.052 + layer * 3.7) * 6;
        ctx.lineTo(x, y0 + n - layer * 6 + Math.sin(this.time * 0.06 + layer) * 2);
      }
      ctx.lineTo(W, H);
      ctx.lineTo(0, H);
      ctx.closePath();
      ctx.fillStyle = `hsla(${lerp(6, 155, pan)} ${lerp(50, 30, pan)}% ${7 + layer * 3}% / ${0.55 - layer * 0.12})`;
      ctx.fill();
    }

    if (Math.random() < 0.3) {
      if (pan < 0.5) {
        this.particles.push({
          x: Math.random() * W, y: -6, vx: (Math.random() - 0.5) * 12, vy: 18 + Math.random() * 22,
          life: 0, maxLife: 6, size: 1 + Math.random() * 1.6, hue: 20, sat: 8, lit: 62,
          kind: 'ash', alpha: 0.5, gravity: 2,
        });
      } else {
        this.particles.push({
          x: Math.random() * W, y: H * (0.3 + Math.random() * 0.6), vx: (Math.random() - 0.5) * 16, vy: -6 - Math.random() * 8,
          life: 0, maxLife: 5, size: 1.2 + Math.random() * 1.4, hue: 95, sat: 80, lit: 65,
          kind: 'mote', alpha: 0.8, gravity: -1,
        });
      }
    }
  }

  /* ------------------------------- arena --------------------------------- */

  private drawArenaImage(ctx: CanvasRenderingContext2D, img: HTMLImageElement, alpha = 1, yShift = 0): void {
    const r = this.boardRect();
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.roundRect(r.left - 3, r.top - 3, r.w + 6, r.h + 6, 12);
    ctx.clip();
    if (this.localSeat === 1) {
      ctx.translate(r.left + r.w / 2, r.top + r.h / 2 + yShift);
      ctx.rotate(Math.PI);
      ctx.drawImage(img, -r.w / 2 - 3, -r.h / 2 - 3, r.w + 6, r.h + 6);
    } else {
      ctx.drawImage(img, r.left - 3, r.top - 3 + yShift, r.w + 6, r.h + 6);
    }
    ctx.restore();
  }

  private drawArena(ctx: CanvasRenderingContext2D, st: GameState): void {
    const world: WorldId = st.phase === 'oasis' || st.phase === 'ended' ? 'oasis' : 'basalt';
    const art = getPhaseArt(world);
    const r = this.boardRect();
    const t = this.time;

    // Island slab shadow + wall.
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.beginPath();
    ctx.ellipse(r.left + r.w / 2, r.top + r.h + 9, r.w * 0.54, 15, 0, 0, Math.PI * 2);
    ctx.fill();
    const wall = ctx.createLinearGradient(0, r.top + r.h, 0, r.top + r.h + 12);
    wall.addColorStop(0, world === 'oasis' ? 'hsl(30 30% 22%)' : 'hsl(258 16% 14%)');
    wall.addColorStop(1, world === 'oasis' ? 'hsl(28 32% 10%)' : 'hsl(258 18% 5%)');
    ctx.fillStyle = wall;
    ctx.beginPath();
    ctx.roundRect(r.left - 5, r.top - 4, r.w + 10, r.h + 16, 14);
    ctx.fill();

    if (art) {
      this.drawArenaImage(ctx, art, 1);
    } else {
      // Offline fallback ground.
      const g = ctx.createLinearGradient(0, r.top, 0, r.top + r.h);
      if (world === 'basalt') {
        g.addColorStop(0, 'hsl(256 14% 20%)');
        g.addColorStop(1, 'hsl(258 16% 13%)');
      } else {
        g.addColorStop(0, 'hsl(125 40% 28%)');
        g.addColorStop(1, 'hsl(135 45% 18%)');
      }
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.roundRect(r.left - 3, r.top - 3, r.w + 6, r.h + 6, 12);
      ctx.fill();
      // Paint the navmask so the fallback still shows real geometry.
      for (let wy = 0.25; wy < WORLD_H; wy += 0.5) {
        for (let wx = 0.25; wx < WORLD_W; wx += 0.5) {
          const c = cellAt(world, wx, wy);
          if (c === CELL.WALK) continue;
          const p = this.worldToScreen(wx, wy);
          const s = this.unit * 0.5;
          ctx.fillStyle = c === CELL.BLOCKED
            ? (world === 'basalt' ? 'hsl(18 90% 42%)' : 'hsl(258 18% 8%)')
            : c === CELL.DEEP ? 'hsl(210 75% 24%)'
              : c === CELL.SHALLOW ? 'hsl(192 65% 36%)'
                : c === CELL.SAND ? 'hsl(42 42% 40%)'
                  : 'hsl(58 60% 35%)';
          ctx.fillRect(p.x - s / 2, p.y - s / 2, s + 0.5, s + 0.5);
        }
      }
    }

    // Depth grade + duel midline.
    const grade = ctx.createLinearGradient(0, r.top, 0, r.top + r.h);
    grade.addColorStop(0, 'rgba(255,255,255,0.05)');
    grade.addColorStop(0.5, 'rgba(0,0,0,0)');
    grade.addColorStop(1, 'rgba(0,0,0,0.16)');
    ctx.fillStyle = grade;
    ctx.fillRect(r.left, r.top, r.w, r.h);
    ctx.strokeStyle = world === 'oasis' ? 'rgba(120,255,220,0.11)' : 'rgba(255,150,90,0.11)';
    ctx.lineWidth = 2;
    ctx.setLineDash([10, 8]);
    ctx.beginPath();
    ctx.moveTo(r.left + 6, r.top + r.h / 2);
    ctx.lineTo(r.left + r.w - 6, r.top + r.h / 2);
    ctx.stroke();
    ctx.setLineDash([]);

    // Animated accents keyed to the physical navmask.
    const pts = accentsFor(world);
    if (world === 'basalt') {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < pts.lavaEdge.length; i++) {
        if ((i + ((t * 2) | 0)) % 5 !== 0) continue;
        const pt = pts.lavaEdge[i];
        const p = this.worldToScreen(pt.x, pt.y);
        const a = 0.05 + Math.sin(t * 2.4 + i * 1.7) * 0.04;
        if (a <= 0.015) continue;
        const bloom = ctx.createRadialGradient(p.x, p.y, 1, p.x, p.y, this.unit * 0.7);
        bloom.addColorStop(0, `hsla(28 100% 55% / ${a})`);
        bloom.addColorStop(1, 'hsla(24 100% 50% / 0)');
        ctx.fillStyle = bloom;
        ctx.fillRect(p.x - this.unit, p.y - this.unit, this.unit * 2, this.unit * 2);
      }
      ctx.restore();
      if (Math.random() < 0.09 && pts.lavaEdge.length) {
        const pt = pts.lavaEdge[(Math.random() * pts.lavaEdge.length) | 0];
        const p = this.worldToScreen(pt.x, pt.y);
        this.burst(p.x, p.y, 1, 'spark', 25, 0.7);
      }
    } else {
      // Water ripples + travelling speculars.
      for (let i = 0; i < pts.water.length; i++) {
        if ((i + ((t * 1.5) | 0)) % 14 !== 0) continue;
        const pt = pts.water[i];
        const p = this.worldToScreen(pt.x, pt.y);
        const rp = (t * 0.5 + i * 0.618) % 1;
        ctx.strokeStyle = `rgba(255,255,255,${0.12 * (1 - rp)})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, this.unit * 0.4 * rp + 2, this.unit * 0.3 * rp + 1.4, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    // Props: vents, reeds, lotus (authored to match the paintings).
    for (const prop of st.props) {
      const p = this.worldToScreen(prop.x, prop.y);
      if (prop.kind === 'vent') {
        const puff = 0.18 + Math.sin(t * 2.6 + prop.x * 3) * 0.1;
        const vg = ctx.createRadialGradient(p.x, p.y, 1, p.x, p.y, this.unit * prop.r);
        vg.addColorStop(0, `hsla(58 75% 52% / ${puff + 0.14})`);
        vg.addColorStop(1, 'hsla(58 70% 40% / 0)');
        ctx.fillStyle = vg;
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, this.unit * prop.r, this.unit * prop.r * 0.85, 0, 0, Math.PI * 2);
        ctx.fill();
        if (Math.random() < 0.03) this.burst(p.x, p.y - 4, 1, 'mist', 58, 0.7);
      } else if (prop.kind === 'reeds') {
        ctx.strokeStyle = 'hsla(85 55% 42% / 0.6)';
        ctx.lineWidth = 1.7;
        for (let rd = 0; rd < 6; rd++) {
          const rx = p.x + Math.cos(rd * 2.4) * this.unit * prop.r * 0.6;
          const ry = p.y + Math.sin(rd * 1.7) * this.unit * prop.r * 0.5;
          const sway = Math.sin(t * 1.4 + rd * 1.3 + prop.x) * 4;
          ctx.beginPath();
          ctx.moveTo(rx, ry + this.unit * 0.3);
          ctx.quadraticCurveTo(rx + sway * 0.4, ry - this.unit * 0.15, rx + sway, ry - this.unit * 0.5);
          ctx.stroke();
        }
      } else if (prop.kind === 'lotus' && !prop.destroyed) {
        const bloom = 1 + Math.sin(t * 2.2 + prop.x * 3) * 0.08;
        for (let ring = 0; ring < 2; ring++) {
          ctx.fillStyle = ring === 0 ? 'hsl(322 70% 66%)' : 'hsl(330 80% 78%)';
          const petals = ring === 0 ? 7 : 5;
          const rad = (ring === 0 ? 6 : 3.4) * bloom * (this.unit / 44);
          for (let pt2 = 0; pt2 < petals; pt2++) {
            const a = (pt2 / petals) * Math.PI * 2 + t * 0.12 + ring * 0.4;
            ctx.beginPath();
            ctx.ellipse(p.x + Math.cos(a) * rad, p.y + Math.sin(a) * rad * 0.72, (5 - ring) * (this.unit / 44), (2.8 - ring * 0.6) * (this.unit / 44), a, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        const hg = ctx.createRadialGradient(p.x, p.y, 0.5, p.x, p.y, 8);
        hg.addColorStop(0, 'hsla(48 100% 70% / 0.95)');
        hg.addColorStop(1, 'hsla(48 100% 60% / 0)');
        ctx.fillStyle = hg;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 8, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Deploy-band glow.
    if (st.phase === 'basalt' || st.phase === 'oasis') {
      const bandTopWorld = this.localSeat === 0 ? WORLD_H - 3 : 0;
      const p0 = this.worldToScreen(0, this.localSeat === 0 ? bandTopWorld : 3);
      const p1 = this.worldToScreen(0, this.localSeat === 0 ? WORLD_H : 0);
      const yTop = Math.min(p0.y, p1.y);
      const yBot = Math.max(p0.y, p1.y);
      const glow = ctx.createLinearGradient(0, yTop, 0, yBot);
      const boost = this.drag.active ? 2.2 : 1;
      const pulse = (0.05 + Math.sin(t * 2.2) * 0.02) * boost;
      glow.addColorStop(0, 'hsla(190 90% 60% / 0)');
      glow.addColorStop(1, `hsla(190 90% 60% / ${pulse * 2})`);
      ctx.fillStyle = glow;
      ctx.fillRect(r.left, yTop, r.w, yBot - yTop);
    }
  }

  /* --------------------------- objectives -------------------------------- */

  /** Phase objectives, always on the field: the Ancient Obelisks (phase 1)
   *  and the pond-control ring (phase 2). */
  private drawObjectives(ctx: CanvasRenderingContext2D, st: GameState, dt: number): void {
    for (const [k, v] of [...this.obeliskFlash]) {
      const n = v - dt;
      if (n <= 0) this.obeliskFlash.delete(k);
      else this.obeliskFlash.set(k, n);
    }
    for (const ob of st.obelisks) this.drawObelisk(ctx, ob);

    // Pond control ring: glows in the leading side's colour, harder as the
    // claim approaches 100%.
    if (st.phase === 'oasis' || st.phase === 'ended') {
      const m = st.captureMeter;
      if (m !== 0) {
        const leader: PlayerId = m > 0 ? 0 : 1;
        const mine = leader === this.localSeat;
        const hue = mine ? 175 : 6;
        const k = Math.abs(m) / 100;
        const p = this.worldToScreen(WORLD_W / 2, WORLD_H / 2);
        const rx = this.unit * 2.55;
        const ry = this.unit * 2.0;
        const pulse = 0.5 + Math.sin(this.time * (2 + k * 4)) * 0.5;
        ctx.save();
        ctx.strokeStyle = `hsla(${hue} 95% 62% / ${0.22 + k * 0.5 + pulse * 0.12})`;
        ctx.lineWidth = 2.5 + k * 2.5;
        ctx.setLineDash([14, 10]);
        ctx.lineDashOffset = this.time * (mine ? -26 : 26);
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, rx, ry, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        const g = ctx.createRadialGradient(p.x, p.y, rx * 0.3, p.x, p.y, rx);
        g.addColorStop(0, `hsla(${hue} 90% 55% / 0)`);
        g.addColorStop(1, `hsla(${hue} 90% 55% / ${0.05 + k * 0.14})`);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, rx, ry, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        if (k > 0.7 && Math.random() < 0.2) {
          const a = Math.random() * Math.PI * 2;
          this.burst(p.x + Math.cos(a) * rx, p.y + Math.sin(a) * ry, 1, 'mote', hue, 0.8);
        }
      }
    }
  }

  private drawObelisk(ctx: CanvasRenderingContext2D, ob: ObeliskState): void {
    const p = this.worldToScreen(ob.x, ob.y);
    const u = this.unit;
    const mine = ob.owner === this.localSeat;
    const hue = mine ? 187 : 8;
    const frac = clamp(ob.hp / ob.maxHp, 0, 1);
    const flash = this.obeliskFlash.get(ob.owner) ?? 0;
    const jx = flash > 0 ? (Math.random() - 0.5) * flash * 26 : 0;
    const t = this.time;

    ctx.save();
    ctx.translate(p.x + jx, p.y);

    // Ground shadow.
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.beginPath();
    ctx.ellipse(0, u * 0.1, u * 0.92, u * 0.34, 0, 0, Math.PI * 2);
    ctx.fill();

    // Runic ground circle: a slowly counter-rotating double ring with glyph
    // ticks — the tower's power is anchored into the earth itself.
    ctx.save();
    ctx.strokeStyle = `hsla(${hue} 85% 58% / ${0.4 + Math.sin(t * 1.8) * 0.12})`;
    ctx.lineWidth = 2.2;
    ctx.setLineDash([u * 0.14, u * 0.1]);
    ctx.lineDashOffset = t * u * 0.12;
    ctx.beginPath();
    ctx.ellipse(0, u * 0.1, u * 1.02, u * 0.4, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = 1.2;
    ctx.setLineDash([u * 0.05, u * 0.13]);
    ctx.lineDashOffset = -t * u * 0.2;
    ctx.beginPath();
    ctx.ellipse(0, u * 0.1, u * 0.82, u * 0.31, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    // Glyph ticks marching around the outer ring.
    for (let gI = 0; gI < 6; gI++) {
      const a = t * 0.5 + (gI / 6) * Math.PI * 2;
      const gx = Math.cos(a) * u * 1.02;
      const gy = u * 0.1 + Math.sin(a) * u * 0.4;
      ctx.fillStyle = `hsla(${hue} 95% 70% / ${0.35 + Math.sin(t * 3 + gI * 2.1) * 0.2})`;
      ctx.fillRect(gx - 1.6, gy - u * 0.045, 3.2, u * 0.09);
    }
    ctx.restore();

    if (ob.hp <= 0) {
      // Rubble: the broken tower, its power bleeding out as a dying glow.
      ctx.fillStyle = 'hsl(255 10% 16%)';
      for (const [rx, ry, rs] of [[-0.3, 0, 0.3], [0.25, 0.02, 0.26], [0, -0.14, 0.34], [-0.05, 0.08, 0.2]] as const) {
        ctx.beginPath();
        ctx.ellipse(rx * u, ry * u, rs * u, rs * u * 0.6, rx * 2, 0, Math.PI * 2);
        ctx.fill();
      }
      const dg = ctx.createRadialGradient(0, -u * 0.1, 2, 0, -u * 0.1, u * 0.7);
      dg.addColorStop(0, `hsla(${hue} 80% 50% / ${0.12 + Math.sin(t * 1.2) * 0.05})`);
      dg.addColorStop(1, `hsla(${hue} 80% 50% / 0)`);
      ctx.fillStyle = dg;
      ctx.fillRect(-u, -u, u * 2, u * 1.4);
      if (Math.random() < 0.12) this.burst(p.x, p.y - u * 0.2, 1, 'ash', 30, 0.8);
      ctx.restore();
      return;
    }

    const H = u * 1.85;               // taller: this is a monument, not a post
    const glow = 0.55 + Math.sin(t * 2.4 + (mine ? 0 : 2)) * 0.2;

    // Aura: the tower radiates its owner's power into the air behind it.
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const aura = ctx.createRadialGradient(0, -H * 0.5, u * 0.1, 0, -H * 0.5, u * 1.35);
    aura.addColorStop(0, `hsla(${hue} 90% 55% / ${0.10 + glow * 0.06})`);
    aura.addColorStop(1, `hsla(${hue} 90% 55% / 0)`);
    ctx.fillStyle = aura;
    ctx.fillRect(-u * 1.4, -H - u * 1.2, u * 2.8, H + u * 1.6);
    ctx.restore();

    // Stepped plinth: two beveled stone tiers the monolith rises from.
    for (const [pw, ph, py] of [[0.62, 0.16, 0], [0.46, 0.14, -0.14]] as const) {
      const g = ctx.createLinearGradient(-pw * u, 0, pw * u, 0);
      g.addColorStop(0, 'hsl(256 14% 9%)');
      g.addColorStop(0.42, 'hsl(252 12% 22%)');
      g.addColorStop(1, 'hsl(258 16% 7%)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.roundRect(-pw * u, (py - ph) * u, pw * u * 2, ph * u * 1.35, u * 0.04);
      ctx.fill();
      // Lit top edge.
      ctx.fillStyle = 'hsla(250 20% 55% / 0.5)';
      ctx.fillRect(-pw * u + 2, (py - ph) * u, pw * u * 2 - 4, 1.6);
    }

    // The monolith: a tapered obsidian shard drawn as TWO faces sharing a
    // centre arris — front-left catches the light, front-right falls into
    // shadow — so it reads as a solid, massive 3D block.
    const baseY = -u * 0.26;
    const topW = u * 0.15;
    const botW = u * 0.34;
    const apexY = baseY - H;
    const face = (x0: number, x1: number, x2: number, x3: number, lit: boolean) => {
      const g = ctx.createLinearGradient(Math.min(x0, x1), 0, Math.max(x2, x3), 0);
      if (lit) {
        g.addColorStop(0, 'hsl(254 14% 18%)');
        g.addColorStop(0.5, 'hsl(250 13% 33%)');
        g.addColorStop(1, 'hsl(252 14% 22%)');
      } else {
        g.addColorStop(0, 'hsl(258 16% 11%)');
        g.addColorStop(1, 'hsl(260 18% 5%)');
      }
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(x0, apexY);           // top edge left
      ctx.lineTo(x2, baseY);           // base left
      ctx.lineTo(x3, baseY);           // base right
      ctx.lineTo(x1, apexY);           // top edge right
      ctx.closePath();
      ctx.fill();
    };
    face(-topW, topW * 0.1, -botW, botW * 0.12, true);   // lit front-left face
    face(topW * 0.1, topW, botW * 0.12, botW, false);    // shadowed right face
    // The arris (centre edge) catches the crystal light.
    ctx.strokeStyle = `hsla(${hue} 60% 70% / ${0.2 + glow * 0.2})`;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(topW * 0.1, apexY);
    ctx.lineTo(botW * 0.12, baseY);
    ctx.stroke();
    // Beveled capstone.
    ctx.fillStyle = 'hsl(252 14% 30%)';
    ctx.beginPath();
    ctx.moveTo(-topW, apexY);
    ctx.lineTo(0, apexY - u * 0.14);
    ctx.lineTo(topW, apexY);
    ctx.closePath();
    ctx.fill();

    // Carved runes running down the lit face, each pulsing in sequence —
    // power travelling up the stone toward the crystal.
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const runeN = 5;
    for (let rI = 0; rI < runeN; rI++) {
      const fy = 0.16 + rI * 0.16;                       // 0 top .. 1 bottom
      const ry = apexY + (baseY - apexY) * fy;
      const halfW = topW + (botW - topW) * fy;
      const rx = -halfW * 0.5;
      const pulse = 0.55 + Math.max(0, Math.sin(t * 2.6 - rI * 0.9)) * 0.45;
      const a = pulse * (0.45 + frac * 0.5);
      ctx.strokeStyle = `hsla(${hue} 100% 72% / ${a})`;
      ctx.lineWidth = Math.max(1.4, u * 0.022);
      ctx.lineCap = 'round';
      const s = u * 0.06;
      ctx.beginPath();
      // Small angular glyphs, varied per row.
      if (rI % 3 === 0) {
        ctx.moveTo(rx - s, ry + s); ctx.lineTo(rx, ry - s); ctx.lineTo(rx + s, ry + s);
        ctx.moveTo(rx, ry - s); ctx.lineTo(rx, ry + s * 0.4);
      } else if (rI % 3 === 1) {
        ctx.moveTo(rx - s, ry - s); ctx.lineTo(rx + s, ry - s); ctx.lineTo(rx - s, ry + s); ctx.lineTo(rx + s, ry + s);
      } else {
        ctx.moveTo(rx, ry - s); ctx.lineTo(rx + s, ry); ctx.lineTo(rx, ry + s); ctx.lineTo(rx - s, ry); ctx.closePath();
      }
      ctx.stroke();
    }

    // The heart band: a molten seam of the owner's colour across the stone.
    const bandY = apexY + (baseY - apexY) * 0.52;
    ctx.fillStyle = `hsla(${hue} 95% 58% / ${glow * (0.3 + frac * 0.35)})`;
    const bandHalf = topW + (botW - topW) * 0.52;
    ctx.beginPath();
    ctx.roundRect(-bandHalf, bandY - u * 0.045, bandHalf * 2, u * 0.09, u * 0.03);
    ctx.fill();
    ctx.restore();

    // Sky beam: a soft column of light rising off the crystal, breathing.
    const crysY = apexY - u * 0.42 + Math.sin(t * 1.6 + (mine ? 0 : 3)) * u * 0.05;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const beamA = (0.1 + glow * 0.12) * (0.35 + frac * 0.65);
    const beam = ctx.createLinearGradient(0, crysY, 0, crysY - u * 1.5);
    beam.addColorStop(0, `hsla(${hue} 95% 68% / ${beamA})`);
    beam.addColorStop(1, `hsla(${hue} 95% 68% / 0)`);
    ctx.fillStyle = beam;
    const bw = u * (0.1 + glow * 0.05);
    ctx.beginPath();
    ctx.moveTo(-bw, crysY);
    ctx.lineTo(-bw * 0.35, crysY - u * 1.5);
    ctx.lineTo(bw * 0.35, crysY - u * 1.5);
    ctx.lineTo(bw, crysY);
    ctx.closePath();
    ctx.fill();

    // Crown crystal: a levitating shard slowly turning above the capstone,
    // with orbiting splinters.
    const cg = ctx.createRadialGradient(0, crysY, 1, 0, crysY, u * 0.55);
    cg.addColorStop(0, `hsla(${hue} 100% 78% / ${0.7 * glow})`);
    cg.addColorStop(1, `hsla(${hue} 95% 55% / 0)`);
    ctx.fillStyle = cg;
    ctx.beginPath();
    ctx.arc(0, crysY, u * 0.55, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    const spin = Math.sin(t * 1.3);   // apparent rotation via width scaling
    const cw = u * 0.13 * (0.35 + Math.abs(spin) * 0.65);
    const ch = u * 0.26;
    ctx.fillStyle = `hsl(${hue} 90% ${66 + Math.sin(t * 3) * 8}%)`;
    ctx.beginPath();
    ctx.moveTo(0, crysY - ch);
    ctx.lineTo(cw, crysY);
    ctx.lineTo(0, crysY + ch);
    ctx.lineTo(-cw, crysY);
    ctx.closePath();
    ctx.fill();
    // Specular sliver on the crystal.
    ctx.fillStyle = `hsla(${hue} 100% 92% / 0.85)`;
    ctx.beginPath();
    ctx.moveTo(0, crysY - ch * 0.7);
    ctx.lineTo(cw * 0.3, crysY - ch * 0.1);
    ctx.lineTo(0, crysY + ch * 0.2);
    ctx.closePath();
    ctx.fill();
    // Orbiting splinters.
    for (let sI = 0; sI < 3; sI++) {
      const a = t * 1.7 + (sI / 3) * Math.PI * 2;
      const ox2 = Math.cos(a) * u * 0.34;
      const oy2 = Math.sin(a) * u * 0.1;
      const front = Math.sin(a) > 0;
      ctx.fillStyle = `hsla(${hue} 95% 74% / ${front ? 0.9 : 0.4})`;
      ctx.beginPath();
      ctx.moveTo(ox2, crysY + oy2 - u * 0.05);
      ctx.lineTo(ox2 + u * 0.025, crysY + oy2);
      ctx.lineTo(ox2, crysY + oy2 + u * 0.05);
      ctx.lineTo(ox2 - u * 0.025, crysY + oy2);
      ctx.closePath();
      ctx.fill();
    }
    // Rising motes of power.
    if (Math.random() < 0.1) {
      this.burst(p.x + (Math.random() - 0.5) * u * 0.5, p.y - Math.random() * H, 1, 'mote', hue, 0.7);
    }

    // Battle damage: cracks spider out as HP falls, glowing at low health.
    if (frac < 0.999) {
      const dmg = 1 - frac;
      ctx.strokeStyle = dmg > 0.6
        ? `hsla(${hue} 90% 60% / ${0.3 + dmg * 0.4})`
        : `rgba(5,3,10,${0.35 + dmg * 0.45})`;
      ctx.lineWidth = 1.6;
      const cracks = Math.ceil(dmg * 5);
      for (let c = 0; c < cracks; c++) {
        const seed = c * 137 + (ob.owner === 0 ? 7 : 31);
        let cx = ((seed % 10) / 10 - 0.5) * u * 0.5;
        let cy = baseY - ((seed % 7) / 7) * H * 0.8;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        for (let seg = 0; seg < 4; seg++) {
          cx += (((seed * (seg + 3)) % 9) / 9 - 0.5) * u * 0.24;
          cy += ((seed * (seg + 7)) % 5) / 5 * u * 0.22 + 2;
          ctx.lineTo(cx, cy);
        }
        ctx.stroke();
      }
    }

    // Hit flash.
    if (flash > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = Math.min(1, flash / 0.24) * 0.55;
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.moveTo(-topW, apexY);
      ctx.lineTo(topW, apexY);
      ctx.lineTo(botW, baseY);
      ctx.lineTo(-botW, baseY);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    // Objective HP bar — bigger than unit bars; this IS the scoreboard.
    // Sits above the levitating crown crystal.
    const hpw = u * 1.9;
    const hph = 7;
    const hy = -H - u * 1.12;
    ctx.fillStyle = 'rgba(4,3,8,0.82)';
    ctx.beginPath();
    ctx.roundRect(-hpw / 2 - 1.5, hy - 1.5, hpw + 3, hph + 3, 4.5);
    ctx.fill();
    const barG = ctx.createLinearGradient(0, hy, 0, hy + hph);
    if (mine) {
      barG.addColorStop(0, frac > 0.35 ? 'hsl(187 90% 62%)' : 'hsl(45 95% 66%)');
      barG.addColorStop(1, frac > 0.35 ? 'hsl(195 85% 42%)' : 'hsl(40 95% 46%)');
    } else {
      barG.addColorStop(0, 'hsl(4 92% 64%)');
      barG.addColorStop(1, 'hsl(2 85% 44%)');
    }
    ctx.fillStyle = barG;
    ctx.beginPath();
    ctx.roundRect(-hpw / 2, hy, Math.max(2, hpw * frac), hph, 3.5);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.fillRect(-hpw / 2 + 1, hy + 1, Math.max(1, hpw * frac - 2), 1.4);

    ctx.restore();
  }

  /* ------------------------- transition cutscene ------------------------- */

  private drawTransition(ctx: CanvasRenderingContext2D, st: GameState, W: number, H: number): void {
    // Crossfade the oasis painting in over the marching armies, with
    // letterbox bars for the cinematic beat.
    const total = 20;
    const p = clamp(1 - st.phaseTicksLeft / total, 0, 1);
    const oasisArt = getPhaseArt('oasis');
    if (oasisArt && p > 0.45) {
      this.drawArenaImage(ctx, oasisArt, (p - 0.45) / 0.55 * 0.9, (1 - p) * -this.unit * 2);
    }
    // Green dawn sweeping down the field.
    const sweep = ctx.createLinearGradient(0, H * (1.1 - p * 1.2), 0, H * (1.4 - p * 1.2));
    sweep.addColorStop(0, 'hsla(150 80% 60% / 0)');
    sweep.addColorStop(0.5, `hsla(150 80% 60% / ${0.12 * Math.sin(p * Math.PI)})`);
    sweep.addColorStop(1, 'hsla(150 80% 60% / 0)');
    ctx.fillStyle = sweep;
    ctx.fillRect(0, 0, W, H);
    // Letterbox.
    const bar = H * 0.07 * Math.sin(Math.min(1, p * 3) * Math.PI * 0.5);
    ctx.fillStyle = 'rgba(0,0,0,0.9)';
    ctx.fillRect(0, 0, W, bar);
    ctx.fillRect(0, H - bar, W, bar);
    // Marching dust.
    if (Math.random() < 0.5) {
      const r = this.boardRect();
      this.burst(r.left + Math.random() * r.w, r.top + r.h * (this.localSeat === 0 ? 0.85 : 0.15), 1, 'ash', 35, 0.7);
    }
  }

  /* ------------------------------- zones -------------------------------- */

  private drawZones(ctx: CanvasRenderingContext2D, st: GameState, layer: 'under' | 'over'): void {
    const t = this.time;
    for (const z of st.zones) {
      const p = this.worldToScreen(z.x, z.y);
      const rw = z.r * this.unit;
      const rh = z.r * this.unit * 0.86;
      if (z.kind === 'sulfur' && layer === 'over') {
        const g = ctx.createRadialGradient(p.x, p.y, 4, p.x, p.y, rw);
        g.addColorStop(0, `hsla(58 80% 55% / ${0.34 + Math.sin(t * 2.4) * 0.06})`);
        g.addColorStop(1, 'hsla(60 70% 40% / 0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, rw, rh, 0, 0, Math.PI * 2);
        ctx.fill();
        if (Math.random() < 0.15) {
          this.burst(p.x + (Math.random() - 0.5) * rw, p.y + (Math.random() - 0.5) * rh, 1, 'mist', 58, 0.8);
        }
      } else if (z.kind === 'thicket' && layer === 'under') {
        ctx.fillStyle = 'hsla(110 50% 25% / 0.5)';
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, rw, rh, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'hsla(100 60% 42% / 0.9)';
        ctx.lineWidth = 1.6;
        for (let b = 0; b < 12; b++) {
          const bx = p.x + Math.cos(b * 2.1) * rw * 0.7;
          const by = p.y + Math.sin(b * 1.3) * rh * 0.7;
          const sway = Math.sin(t * 1.8 + b) * 3;
          ctx.beginPath();
          ctx.moveTo(bx, by + 8);
          ctx.quadraticCurveTo(bx + sway * 0.5, by, bx + sway, by - 9);
          ctx.stroke();
        }
      } else if (z.kind === 'acidpool' && layer === 'under') {
        ctx.fillStyle = `hsla(80 80% 45% / ${0.3 + Math.sin(t * 3) * 0.05})`;
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, rw, rh, 0, 0, Math.PI * 2);
        ctx.fill();
        if (Math.random() < 0.1) this.burst(p.x, p.y, 1, 'bubble', 80, 0.6);
      } else if (z.kind === 'healmist' && layer === 'over') {
        const g = ctx.createRadialGradient(p.x, p.y, 2, p.x, p.y, rw);
        g.addColorStop(0, 'hsla(140 80% 65% / 0.4)');
        g.addColorStop(1, 'hsla(140 80% 55% / 0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, rw, rh, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  private drawTelegraphs(ctx: CanvasRenderingContext2D, st: GameState, now: number): void {
    for (const lv of st.pendingLava) {
      const p = this.worldToScreen(lv.x, lv.y);
      const progress = clamp(1 - (lv.resolveTick - st.tick - 1 + (1 - (now - this.lastTickAt) / TICK_MS)) / 4, 0, 1);
      const rw = this.unit * 2.6;
      const rh = this.unit * 2.3;
      ctx.fillStyle = `rgba(0,0,0,${0.28 + progress * 0.24})`;
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, rw * (0.5 + progress * 0.5), rh * (0.5 + progress * 0.5), 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = `hsla(14 100% 55% / ${0.5 + Math.sin(now * 0.02) * 0.3})`;
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 5]);
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, rw, rh, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      if (Math.random() < 0.4) this.burst(p.x + (Math.random() - 0.5) * rw, p.y - 60, 1, 'spark', 18, 0.5);
    }
  }

  /* ----------------------------- projectiles ----------------------------- */

  private drawProjectiles(ctx: CanvasRenderingContext2D, st: GameState, now: number): void {
    const k = clamp((now - this.lastTickAt) / TICK_MS, 0, 1);
    for (const pr of st.projectiles) {
      const wx = lerp(pr.px, pr.x, k);
      const wy = lerp(pr.py, pr.y, k);
      const p = this.worldToScreen(wx, wy);
      // Ballistic arc: rises then falls over remaining flight.
      const totalTicks = pr.ticksLeft + 1;
      const flight = clamp(1 - (pr.ticksLeft - k) / Math.max(1, totalTicks), 0, 1);
      const arc = Math.sin(flight * Math.PI) * this.unit * 1.1;
      const y = p.y - arc;
      // Glowing acid glob with a vapor trail.
      const g = ctx.createRadialGradient(p.x, y, 1, p.x, y, 9);
      g.addColorStop(0, 'hsl(85 100% 75%)');
      g.addColorStop(0.5, 'hsl(90 95% 55%)');
      g.addColorStop(1, 'hsla(95 90% 45% / 0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(p.x, y, 9, 0, Math.PI * 2);
      ctx.fill();
      if (Math.random() < 0.7) {
        this.particles.push({
          x: p.x, y, vx: (Math.random() - 0.5) * 14, vy: 6,
          life: 0, maxLife: 0.4, size: 2.4, hue: 90, sat: 90, lit: 60,
          kind: 'mist', alpha: 0.6, gravity: -8,
        });
      }
      // Target shadow.
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.beginPath();
      ctx.ellipse(p.x, p.y + 3, 6, 2.6, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /* ------------------------------- units --------------------------------- */

  /** Current frame pair: `a` blends into `b` by `mix` for smooth motion.
   *  `view` reports which painted angle was used so the caller can skip
   *  mirroring/lean for the directional (up/down) art. */
  private pickFrames(
    species: SpeciesId, d: DisplayUnit, moving: boolean, flying: boolean,
  ): { a: Sprite; b: Sprite | null; mix: number; view: ViewDir } | null {
    const anim = getAnim(species);
    if (!anim) {
      const s = getSprite(species, 0);
      return s ? { a: s, b: null, mix: 0, view: 'side' } : null;
    }
    const dirFrames = d.dir === 'up' ? anim.up : d.dir === 'down' ? anim.down : undefined;
    // Attack timeline: anticipation -> strike -> recoil over 0.55 s.
    // Strikes cut hard (no blending) so impacts stay crisp.
    if (d.atk) {
      const at = (this.time - d.atk.t0) / 0.55;
      if (at < 1) {
        // Strikes aimed mostly up/down the field play on the directional art
        // (the lunge + aim pitch supply the "bite"); side strikes use the
        // painted attack sheets.
        const vertical = Math.abs(d.atk.dirY) > Math.abs(d.atk.dirX) * 1.15;
        if (vertical && dirFrames && d.dir !== 'side') {
          const idx = at < 0.35 ? 0 : at < 0.65 ? 2 : 3;
          return { a: dirFrames[Math.min(idx, dirFrames.length - 1)], b: null, mix: 0, view: d.dir };
        }
        const frames = species === 'bear' && d.atk.air && anim.swat ? anim.swat : anim.attack;
        const idx = at < 0.35 ? 0 : at < 0.65 ? 1 : 2;
        return { a: frames[Math.min(idx, frames.length - 1)], b: null, mix: 0, view: 'side' };
      }
    }
    const cycle = dirFrames && d.dir !== 'side' ? dirFrames : anim.run;
    const view: ViewDir = cycle === anim.run ? 'side' : d.dir;
    // Flyers always flap; grounded units stride when moving, else hold contact.
    if (flying || moving) {
      const n = cycle.length;
      const i = Math.floor(d.runPhase) % n;
      const frac = d.runPhase - Math.floor(d.runPhase);
      const mix = frac * frac * (3 - 2 * frac); // smoothstep crossfade
      return { a: cycle[i], b: cycle[(i + 1) % n], mix, view };
    }
    return { a: cycle[0], b: null, mix: 0, view };
  }

  private drawUnits(ctx: CanvasRenderingContext2D, st: GameState, dt: number, now: number): void {
    const alive = new Set<number>();
    const unitById = new Map(st.units.map((u) => [u.id, u]));
    const order = [...st.units].sort((a, b) => {
      const da = this.display.get(a.id)?.dy ?? a.y;
      const db = this.display.get(b.id)?.dy ?? b.y;
      return this.localSeat === 1 ? db - da : da - db;
    });

    for (const [id, tLeft] of [...this.flashes]) {
      const nt = tLeft - dt;
      if (nt <= 0) this.flashes.delete(id);
      else this.flashes.set(id, nt);
    }

    for (const u of order) {
      alive.add(u.id);
      let d = this.display.get(u.id);
      if (!d) {
        d = {
          dx: u.x, dy: u.y, runPhase: (u.id * 0.7) % 4, age: 0, face: u.facing, faceHold: 0, lean: 0,
          // Fresh troops march toward the enemy: yours away from the camera,
          // theirs toward it.
          dir: u.owner === this.localSeat ? 'up' : 'down',
          dirHold: 0,
          wet: 0,
        };
        this.display.set(u.id, d);
      }
      d.age += dt;

      // CR-style constant-velocity interpolation across the tick window
      // (px,py -> x,y at the exact sim pace), then a light exponential
      // smoothing pass on top: per-tick steering corrections stop reading
      // as micro-jerks and paths round off into continuous curves.
      // Uses the render clock so hit-stop freezes motion too.
      const tickK = clamp((this.tickClock * 1000) / TICK_MS, 0, 1);
      const wantX = lerp(u.px, u.x, tickK);
      const wantY = lerp(u.py, u.y, tickK);
      if (Math.hypot(wantX - d.dx, wantY - d.dy) > 1.6) {
        // Teleports (spawn repositions, corrections) snap.
        d.dx = wantX;
        d.dy = wantY;
      } else {
        const sk = 1 - Math.exp(-dt * 13);
        d.dx += (wantX - d.dx) * sk;
        d.dy += (wantY - d.dy) * sk;
      }
      const stepX = u.x - u.px;
      const stepY = u.y - u.py;
      const stepLen = Math.hypot(stepX, stepY);
      const moving = stepLen > 0.02;

      const stats = speciesDef(u.species).stats!;
      const flying = stats.flying;
      // Plodding stride cadence: under one full 4-frame cycle per second,
      // rising only slightly with ground speed — every footfall is a
      // deliberate, weighted step. Frame-to-frame crossfading (below)
      // keeps the slow cadence smooth instead of strobing.
      const wps = (stats.speed / TICK_MS) * 1000;
      d.runPhase += dt * (
        flying ? (u.species === 'bees' ? 10 : 4.6)
          : moving ? 2.0 + wps * 3.2
            : 0.5
      );

      // Facing hysteresis: only flip after the sim holds a direction ~0.22 s,
      // so wall-slide wobble can't mirror-strobe the sprite.
      if (u.facing !== d.face) {
        d.faceHold += dt;
        if (d.faceHold > 0.22 || d.atk) {
          d.face = u.facing;
          d.faceHold = 0;
        }
      } else {
        d.faceHold = 0;
      }

      // Directional view: pick the painted angle that matches the travel
      // (or strike) direction in SCREEN space, with hysteresis so steering
      // wobble can't strobe between angles. Marching up-field shows the 3/4
      // rear art, down-field the 3/4 front art, sideways the profile art.
      const anim = getAnim(u.species);
      if (anim?.up && anim.down) {
        let wantDir: ViewDir | null = null;
        let vx = 0;
        let vy = 0;
        if (d.atk) {
          vx = d.atk.dirX;
          vy = d.atk.dirY;
        } else if (moving) {
          vx = (this.localSeat === 1 ? -stepX : stepX) / stepLen;
          vy = (this.localSeat === 1 ? -stepY : stepY) / stepLen;
        } else if (u.targetId !== null) {
          // Locked in a clash but between swings: square off toward the
          // opponent instead of holding a stale march direction.
          const tgt = unitById.get(u.targetId);
          if (tgt) {
            const tx = (this.localSeat === 1 ? -(tgt.x - d.dx) : tgt.x - d.dx);
            const ty = (this.localSeat === 1 ? -(tgt.y - d.dy) : tgt.y - d.dy);
            const tl = Math.hypot(tx, ty);
            if (tl > 0.001) {
              vx = tx / tl;
              vy = ty / tl;
            }
          }
        }
        if (vx !== 0 || vy !== 0) {
          if (Math.abs(vy) > Math.abs(vx) * 0.85) wantDir = vy < 0 ? 'up' : 'down';
          else if (Math.abs(vx) > Math.abs(vy) * 1.35) wantDir = 'side';
        }
        if (wantDir && wantDir !== d.dir) {
          d.dirHold += dt;
          if (d.dirHold > 0.18 || d.atk) {
            d.dir = wantDir;
            d.dirHold = 0;
          }
        } else {
          d.dirHold = 0;
        }
      } else {
        d.dir = 'side';
      }

      // Body lean. Side-profile art pitches toward the direction of travel
      // (so it reads as heading up/down field); the directional art already
      // faces the right way and only takes a whisper of sideways tilt while
      // drifting laterally.
      const MAX_LEAN = 1.0;
      let leanTarget = 0;
      if (moving) {
        const dxScreen = (this.localSeat === 1 ? -stepX : stepX) / stepLen;
        const dyScreen = (this.localSeat === 1 ? -stepY : stepY) / stepLen;
        leanTarget = d.dir === 'side'
          ? clamp(dyScreen, -1, 1) * MAX_LEAN
          : clamp(dxScreen, -1, 1) * 0.12 * (d.dir === 'up' ? 1 : -1);
      }
      d.lean += (leanTarget - d.lean) * clamp(dt * 6, 0, 1);

      const p = this.worldToScreen(d.dx, d.dy);
      const hover = flying ? -this.unit * 0.55 - Math.sin(this.time * 2.2 + u.id) * 3 : 0;

      // Pond immersion. Walking animals wading into the oasis pond sink:
      // shallow rim wets the paws, and the deeper the water (toward the
      // pond's centre) the further the legs disappear below the surface.
      // The depth value eases so shorelines never pop.
      const world: WorldId = st.phase === 'oasis' || st.phase === 'ended' ? 'oasis' : 'basalt';
      let wetTarget = 0;
      if (!flying && world === 'oasis') {
        const c = cellAt(world, d.dx, d.dy);
        if (c === CELL.SHALLOW || c === CELL.DEEP) {
          const centerness = clamp(
            1 - Math.hypot(d.dx - WORLD_W / 2, d.dy - WORLD_H / 2) / 2.6, 0, 1,
          );
          wetTarget = (c === CELL.DEEP ? 0.62 : 0.3) + centerness * 0.38;
        }
      }
      const wasWet = d.wet > 0.06;
      d.wet += (wetTarget - d.wet) * clamp(dt * 4.5, 0, 1);
      const isWet = d.wet > 0.06;
      // Clash-style depth: actors shrink slightly toward the far end of the
      // field and grow toward the near edge, selling the 3/4 camera.
      const depthK = clamp((p.y - this.oy) / Math.max(1, WORLD_H * this.unit), 0, 1);
      const depthScale = 0.9 + depthK * 0.2;
      const s = this.unit * unitScale(stats.colossal, stats.heavy) * depthScale;

      const popT = clamp(d.age / 0.45, 0, 1);
      const pb = popT - 1;
      const pop = 1 + 2.70158 * pb * pb * pb + 1.70158 * pb * pb;

      // Entry splash: the moment paws break the surface, water leaps.
      if (isWet && !wasWet && wetTarget > 0) {
        const wl = p.y + this.unit * 0.13;
        this.burst(p.x, wl, 12, 'spark', 197, 1.15);
        this.burst(p.x, wl, 5, 'bubble', 192, 0.8);
        this.burst(p.x, wl, 2, 'ripple', 195, 0.6);
        this.burst(p.x, wl - 2, 4, 'mist', 195, 0.9);
      }

      const stealthAlpha = u.stealthed ? (u.owner === this.localSeat ? 0.45 : 0.08) : 1;
      const mineUnit = u.owner === this.localSeat;
      ctx.save();
      ctx.globalAlpha = stealthAlpha;

      // Team ring + contact shadow. The shadow stretches slightly along the
      // stride and darkens at footfall, planting the animal on the ground.
      const ringHue = mineUnit ? 190 : 6;
      ctx.strokeStyle = `hsla(${ringHue} 90% ${mineUnit ? 62 : 56}% / 0.5)`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(p.x, p.y + this.unit * 0.14, s * 0.75 * pop, s * 0.28 * pop, 0, 0, Math.PI * 2);
      ctx.stroke();
      const stride = moving && !flying ? Math.abs(Math.sin(d.runPhase * Math.PI * 0.5)) : 0;
      // In water the contact shadow gives way to the surface disturbance.
      ctx.fillStyle = `rgba(0,0,0,${(flying ? 0.24 : 0.36 + stride * 0.06) * (1 - d.wet * 0.75)})`;
      ctx.beginPath();
      ctx.ellipse(
        p.x, p.y + this.unit * 0.15,
        s * (0.62 + stride * 0.1) * pop, s * (0.22 - stride * 0.02) * pop,
        0, 0, Math.PI * 2,
      );
      ctx.fill();

      // The ground answers the stride, which sells actual contact: dry land
      // kicks up dust (grey ash on basalt, green-brown scuff in the oasis);
      // wading throws droplets and drags ripple rings off each step.
      if (moving && !flying && Math.random() < 0.35) {
        const back = (this.localSeat === 1 ? -stepX : stepX) / stepLen;
        const fx = p.x - back * s * 0.4 + (Math.random() - 0.5) * s * 0.3;
        if (isWet) {
          this.burst(fx, p.y + this.unit * 0.13, 1, 'spark', 197, 0.45 + d.wet * 0.4);
          if (Math.random() < 0.5) this.burst(fx, p.y + this.unit * 0.13, 1, 'ripple', 195, 0.5);
          if (Math.random() < 0.25) this.burst(fx, p.y + this.unit * 0.12, 1, 'bubble', 192, 0.5);
        } else {
          this.burst(fx, p.y + this.unit * 0.12, 1, 'ash', world === 'basalt' ? 30 : 95, 0.32);
        }
      } else if (isWet && !flying && Math.random() < 0.04) {
        // Even standing still, the pond laps gently around the body.
        this.burst(p.x + (Math.random() - 0.5) * s * 0.5, p.y + this.unit * 0.13, 1, 'ripple', 195, 0.4);
      }

      const framePair = this.pickFrames(u.species, d, moving, flying);
      const frame = framePair?.a ?? null;

      // Offscreen composite (for outline fallback + hit flash tint).
      const pad = Math.ceil(s * 2.6);
      const size = pad * 2;
      if (this.artCanvas.width !== size) {
        this.artCanvas.width = size;
        this.artCanvas.height = size;
        this.tintCanvas.width = size;
        this.tintCanvas.height = size;
      }
      const ac = this.artCanvas.getContext('2d')!;
      ac.clearRect(0, 0, size, size);
      if (frame && framePair) {
        const targetH = spriteHeight(s, u.species, stats.colossal, stats.heavy);
        // Wading: the body settles below the surface plane in proportion to
        // the water depth (with a slow buoyant bob), and everything under
        // the waterline is cut away — the pond itself hides the legs.
        const sinkPx = d.wet > 0.01
          ? d.wet * targetH * 0.24 + Math.sin(this.time * 2.6 + u.id * 1.3) * d.wet * s * 0.03
          : 0;
        const drawFrame = (f: Sprite, alpha: number) => {
          const scale = targetH / f.h;
          ac.globalAlpha = alpha;
          ac.drawImage(
            f.canvas,
            pad - f.anchorX * scale,
            pad + s * 0.55 - f.anchorY * scale + sinkPx,
            f.canvas.width * scale,
            f.canvas.height * scale,
          );
        };
        // Crossfade successive stride frames — motion reads smooth, not
        // strobed, even at the slower deliberate cadence.
        if (framePair.b && framePair.mix > 0.01) {
          drawFrame(framePair.a, 1 - framePair.mix);
          drawFrame(framePair.b, framePair.mix);
        } else {
          drawFrame(framePair.a, 1);
        }
        if (sinkPx > 0.5) {
          const waterY = Math.round(pad + s * 0.55) + 1;
          ac.clearRect(0, waterY, size, size - waterY);
        }
        ac.globalAlpha = 1;
      } else {
        ac.save();
        ac.translate(pad, pad + s * 0.55);
        drawSpecies(ac, u.species, s, this.time + u.id * 0.61, u);
        ac.restore();
      }

      const flash = this.flashes.get(u.id) ?? 0;
      const tc = this.tintCanvas.getContext('2d')!;
      if (flash > 0 || !frame) {
        tc.clearRect(0, 0, size, size);
        tc.globalCompositeOperation = 'source-over';
        tc.drawImage(this.artCanvas, 0, 0);
        tc.globalCompositeOperation = 'source-in';
        tc.fillStyle = 'rgba(8,6,14,0.9)';
        tc.fillRect(0, 0, size, size);
      }

      // Ground units plant their feet at the shadow's centre — the sprite's
      // bottom anchor lands on the contact ellipse, never floating above it.
      const groundDrop = flying ? 0 : this.unit * 0.13;
      ctx.translate(p.x, p.y + hover - s * 0.55 + groundDrop);

      const view: ViewDir = framePair?.view ?? 'side';

      // Attack lunge + AIM: the body rotates toward the victim through the
      // strike (up to ~40°), so a chomp visibly bites AT its target even when
      // the target is up or down the field. Directional art already faces
      // its victim, so it only takes a light sideways tilt.
      let strikeStretch = 0;
      let aimRot = 0;
      let aimEnv = 0;
      if (d.atk) {
        const at = (this.time - d.atk.t0) / 0.55;
        if (at >= 1) {
          d.atk = undefined;
        } else {
          // Deeper anticipation: the body visibly coils back before the
          // strike snaps forward — each blow reads as its own event.
          let lunge: number;
          if (at < 0.35) lunge = -0.13 * (at / 0.35);
          else if (at < 0.6) {
            const kk = (at - 0.35) / 0.25;
            lunge = -0.13 + 0.38 * (1 - (1 - kk) * (1 - kk));
          } else lunge = 0.25 * (1 - (at - 0.6) / 0.4);
          const amp = (d.atk.crit ? 1.35 : 1) * s;
          ctx.translate(d.atk.dirX * lunge * amp, d.atk.dirY * lunge * amp);
          strikeStretch = at >= 0.35 && at < 0.6 ? 0.06 : at < 0.35 ? -0.04 : 0;
          aimEnv = at < 0.2 ? at / 0.2 : at < 0.75 ? 1 : (1 - at) / 0.25;
          aimRot = view === 'side'
            ? clamp(d.atk.dirY, -0.95, 0.95) * 0.7
            : clamp(d.atk.dirX, -1, 1) * 0.18;
        }
      }
      if (d.jig) {
        const jt = (this.time - d.jig.t0) / 0.3;
        if (jt >= 1) {
          d.jig = undefined;
        } else {
          const kk = Math.sin(jt * Math.PI * 3) * (1 - jt) * d.jig.mag;
          ctx.translate(d.jig.dirX * kk, d.jig.dirY * kk);
        }
      }

      const face = this.localSeat === 1 ? -d.face : d.face;
      const native = frame ? frame.nativeFacing : 1;
      // Travel lean blends into the attack aim during a strike. The rotation
      // sign flips with the mirror so the nose always pitches the right way.
      // Directional (up/down) art never mirrors — it faces the camera axis.
      const rot = d.lean * (1 - aimEnv) + aimRot * aimEnv;
      const mirrored = view === 'side' && face !== native;
      if (rot !== 0) ctx.rotate(rot * (mirrored ? -1 : 1));
      if (mirrored) ctx.scale(-1, 1);

      let sqx = 1;
      let sqy = 1;
      if (moving && !flying) {
        // A soft weight-shift, not a hop — the body barely oscillates while
        // the legs (painted frames) do the marching.
        const q = Math.sin(d.runPhase * Math.PI * 0.5) * 0.012;
        sqx = 1 + q;
        sqy = 1 - q;
      } else if (!moving && !d.atk) {
        if (u.targetId !== null) {
          // Braced combat stance between swings: a low coiled crouch with a
          // faster, tighter breath — squared off for the next blow.
          sqy *= 0.975 + Math.sin(this.time * 5 + u.id * 1.7) * 0.008;
          sqx *= 1.012;
        } else {
          sqy *= 1 + Math.sin(this.time * 2 + u.id * 1.7) * 0.012;
        }
      }
      sqx *= 1 + strikeStretch;
      sqy *= 1 - strikeStretch * 0.5;
      ctx.scale(sqx * pop, sqy * pop);

      if (!frame) {
        const o = Math.max(1.2, s * 0.045);
        for (const [ox2, oy2] of [[o, 0], [-o, 0], [0, o], [0, -o]] as const) {
          ctx.drawImage(this.tintCanvas, -pad + ox2, -pad + oy2);
        }
      }
      ctx.drawImage(this.artCanvas, -pad, -pad);
      if (flash > 0) {
        tc.fillStyle = 'rgba(255,255,255,1)';
        tc.fillRect(0, 0, size, size);
        ctx.globalAlpha = stealthAlpha * Math.min(1, flash / 0.22) * 0.75;
        ctx.drawImage(this.tintCanvas, -pad, -pad);
        ctx.globalAlpha = stealthAlpha;
      }
      ctx.restore();

      // Waterline: a bright foam collar hugging the body where it meets the
      // surface, wobbling with the wading motion, plus a soft cool sheen
      // just below so the submerged legs read as UNDER the water.
      if (isWet && !flying) {
        const wl = p.y + this.unit * 0.13;
        const bodyW = s * (0.5 + d.wet * 0.22);
        const wob = Math.sin(this.time * 5.2 + u.id * 2.1) * s * 0.02
          + (moving ? Math.sin(d.runPhase * Math.PI) * s * 0.025 : 0);
        ctx.save();
        ctx.globalAlpha = stealthAlpha;
        const sheen = ctx.createRadialGradient(p.x, wl + 2, 1, p.x, wl + 2, bodyW * 1.3);
        sheen.addColorStop(0, `hsla(192 70% 62% / ${0.16 + d.wet * 0.1})`);
        sheen.addColorStop(1, 'hsla(195 70% 55% / 0)');
        ctx.fillStyle = sheen;
        ctx.beginPath();
        ctx.ellipse(p.x, wl + 2, bodyW * 1.3, bodyW * 0.42, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = `hsla(190 60% 92% / ${0.4 + d.wet * 0.25})`;
        ctx.lineWidth = 1.6 + d.wet;
        ctx.beginPath();
        ctx.ellipse(p.x, wl + wob * 0.4, bodyW + wob, (bodyW + wob) * 0.3, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.strokeStyle = `hsla(190 55% 85% / ${0.2 + d.wet * 0.15})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.ellipse(p.x, wl + 1.5 - wob * 0.4, (bodyW + wob) * 1.28, (bodyW + wob) * 0.36, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      // Status FX.
      if (u.buffs.burnStacks > 0 && Math.random() < 0.3) {
        this.burst(p.x, p.y + hover - s * 0.4, 1, 'spark', 22, 0.5);
      }
      if (u.buffs.stun > 0) {
        ctx.fillStyle = 'hsl(55 100% 70%)';
        for (let i = 0; i < 3; i++) {
          const a = this.time * 4 + (i * Math.PI * 2) / 3;
          ctx.beginPath();
          ctx.arc(p.x + Math.cos(a) * s * 0.5, p.y + hover - s * 0.9 + Math.sin(a) * 3, 1.8, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      if (u.buffs.berserk && Math.random() < 0.35) {
        this.burst(p.x, p.y - s * 0.3, 1, 'spark', 0, 0.6);
      }
      if (u.buffs.blessed && Math.random() < 0.05) {
        this.burst(p.x, p.y + hover - s * 0.5, 1, 'mote', 48, 0.6);
      }

      // HP bar (only once damaged).
      const frac = clamp(u.hp / u.maxHp, 0, 1);
      if (frac < 0.999) {
        const hpw = s * 1.35;
        const hph = 5;
        const hy = p.y + hover - s * 1.5;
        ctx.globalAlpha = stealthAlpha;
        ctx.fillStyle = 'rgba(6,4,10,0.78)';
        ctx.beginPath();
        ctx.roundRect(p.x - hpw / 2 - 1, hy - 1, hpw + 2, hph + 2, 3.5);
        ctx.fill();
        const barG = ctx.createLinearGradient(0, hy, 0, hy + hph);
        if (mineUnit) {
          barG.addColorStop(0, frac > 0.35 ? 'hsl(150 85% 62%)' : 'hsl(45 95% 66%)');
          barG.addColorStop(1, frac > 0.35 ? 'hsl(155 80% 40%)' : 'hsl(40 95% 46%)');
        } else {
          barG.addColorStop(0, 'hsl(2 90% 66%)');
          barG.addColorStop(1, 'hsl(2 85% 46%)');
        }
        ctx.fillStyle = barG;
        ctx.beginPath();
        ctx.roundRect(p.x - hpw / 2, hy, Math.max(2, hpw * frac), hph, 2.5);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.fillRect(p.x - hpw / 2 + 1, hy + 0.6, Math.max(1, hpw * frac - 2), 1.2);
        ctx.globalAlpha = 1;
      }
    }

    for (const id of [...this.display.keys()]) {
      if (!alive.has(id)) this.display.delete(id);
    }

    // Fallen pieces: tip over, sink and dissolve.
    for (let i = this.ghosts.length - 1; i >= 0; i--) {
      const g = this.ghosts[i];
      g.t += dt;
      const DUR = 0.75;
      if (g.t >= DUR) {
        this.ghosts.splice(i, 1);
        continue;
      }
      const anim = getAnim(g.species);
      const sprite = anim ? anim.run[0] : getSprite(g.species, g.variant);
      if (!sprite) continue;
      const k = g.t / DUR;
      const p = this.worldToScreen(g.x, g.y);
      const s = this.unit * unitScale(g.colossal, g.heavy);
      const targetH = spriteHeight(s, g.species, g.colossal, g.heavy);
      const scale = targetH / sprite.h;
      const face = this.localSeat === 1 ? -g.facing : g.facing;
      ctx.save();
      ctx.globalAlpha = (1 - k) * 0.9;
      ctx.translate(p.x, p.y + k * 7);
      ctx.rotate(face * k * k * 1.25);
      if (face !== sprite.nativeFacing) ctx.scale(-1, 1);
      ctx.scale(1, 1 - k * 0.25);
      ctx.drawImage(
        sprite.canvas,
        -sprite.anchorX * scale,
        -sprite.anchorY * scale,
        sprite.canvas.width * scale,
        sprite.canvas.height * scale,
      );
      ctx.restore();
      if (Math.random() < 0.5) {
        this.burst(p.x + (Math.random() - 0.5) * s, p.y - k * 14, 1, g.owner === 0 ? 'spark' : 'petal', g.owner === 0 ? 18 : 130, 0.6);
      }
    }
  }

  /* --------------------------- atmosphere pass -------------------------- */

  private drawAtmosphere(ctx: CanvasRenderingContext2D, W: number, H: number): void {
    const t = this.time;
    const pan = this.camPan;

    for (let i = 0; i < 2; i++) {
      const cw = W * (0.55 + i * 0.2);
      const cx2 = ((t * (9 + i * 5) + i * 700) % (W + cw * 2)) - cw;
      const cy2 = H * (0.28 + i * 0.34) + Math.sin(t * 0.1 + i * 3) * 26;
      const g = ctx.createRadialGradient(cx2, cy2, cw * 0.1, cx2, cy2, cw * 0.55);
      g.addColorStop(0, 'rgba(2,2,12,0.09)');
      g.addColorStop(1, 'rgba(2,2,12,0)');
      ctx.fillStyle = g;
      ctx.fillRect(cx2 - cw, cy2 - cw, cw * 2, cw * 2);
    }

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    if (pan > 0.35) {
      const strength = (pan - 0.35) / 0.65;
      for (let i = 0; i < 3; i++) {
        const sway = Math.sin(t * 0.2 + i * 2.1) * W * 0.09;
        const topX = W * (0.22 + i * 0.26) + sway;
        const width = W * (0.07 + i * 0.02);
        const grad = ctx.createLinearGradient(topX, 0, topX + W * 0.16, H);
        grad.addColorStop(0, `hsla(75 80% 72% / ${0.075 * strength})`);
        grad.addColorStop(0.7, `hsla(120 70% 65% / ${0.028 * strength})`);
        grad.addColorStop(1, 'hsla(120 70% 60% / 0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.moveTo(topX, -10);
        ctx.lineTo(topX + width, -10);
        ctx.lineTo(topX + width + W * 0.16, H);
        ctx.lineTo(topX + W * 0.16 - width * 0.4, H);
        ctx.closePath();
        ctx.fill();
      }
    }
    if (pan < 0.65) {
      const strength = (0.65 - pan) / 0.65;
      for (let i = 0; i < 2; i++) {
        const yy = H - (((t * (26 + i * 14)) % (H * 1.3)) - H * 0.12);
        const grad = ctx.createLinearGradient(0, yy - 46, 0, yy + 46);
        grad.addColorStop(0, 'hsla(20 90% 55% / 0)');
        grad.addColorStop(0.5, `hsla(${22 + i * 10} 95% 58% / ${0.035 * strength})`);
        grad.addColorStop(1, 'hsla(20 90% 55% / 0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, yy - 46 + Math.sin(t * 2 + i * 2) * 6, W, 92);
      }
    }
    ctx.restore();
  }

  /* -------------------------- input overlays ----------------------------- */

  private drawDragOverlay(ctx: CanvasRenderingContext2D): void {
    if (!this.drag.active) return;
    const from = this.worldToScreen(this.drag.fromX, this.drag.fromY);
    const to = this.worldToScreen(this.drag.toX, this.drag.toY);
    const hue = this.drag.valid ? this.drag.hue : 0;
    const lit = this.drag.valid ? 60 : 45;

    ctx.strokeStyle = `hsla(${hue} 90% ${lit}% / 0.95)`;
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.ellipse(from.x, from.y, this.unit * 0.45, this.unit * 0.38, 0, 0, Math.PI * 2);
    ctx.stroke();

    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const len = Math.hypot(dx, dy);
    if (len > 8) {
      const nx = dx / len;
      const ny = dy / len;
      ctx.strokeStyle = `hsla(${hue} 90% ${lit}% / 0.9)`;
      ctx.lineWidth = 3.4;
      ctx.setLineDash([9, 7]);
      ctx.lineDashOffset = -this.time * 40;
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x - nx * 12, to.y - ny * 12);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = `hsla(${hue} 90% ${lit + 10}% / 0.95)`;
      ctx.beginPath();
      ctx.moveTo(to.x, to.y);
      ctx.lineTo(to.x - nx * 15 - ny * 7.5, to.y - ny * 15 + nx * 7.5);
      ctx.lineTo(to.x - nx * 15 + ny * 7.5, to.y - ny * 15 - nx * 7.5);
      ctx.closePath();
      ctx.fill();
    }
  }

  private drawPlacementTelegraph(ctx: CanvasRenderingContext2D): void {
    if (!this.telegraph.active) return;
    const p = this.worldToScreen(this.telegraph.x, this.telegraph.y);
    const r = this.telegraph.kind === 'ult' ? 2.6 : 1.5;
    const pulse = 0.65 + Math.sin(this.time * 5) * 0.25;
    ctx.strokeStyle = this.telegraph.kind === 'ult'
      ? `hsla(14 100% 58% / ${pulse})`
      : `hsla(150 90% 60% / ${pulse})`;
    ctx.lineWidth = 2.5;
    ctx.setLineDash([7, 6]);
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, r * this.unit, r * this.unit * 0.88, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  /* ------------------------------ particles ------------------------------ */

  private updateParticles(ctx: CanvasRenderingContext2D, dt: number): void {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life += dt;
      if (p.life >= p.maxLife) {
        this.particles.splice(i, 1);
        continue;
      }
      p.vy += p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const k = 1 - p.life / p.maxLife;

      switch (p.kind) {
        case 'spark':
          ctx.fillStyle = `hsla(${p.hue} ${p.sat}% ${p.lit + k * 25}% / ${k})`;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size * (0.5 + k * 0.5), 0, Math.PI * 2);
          ctx.fill();
          break;
        case 'flash':
          ctx.fillStyle = `hsla(${p.hue} ${p.sat}% ${p.lit}% / ${k * 0.9})`;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
          ctx.fill();
          break;
        case 'ash':
          ctx.fillStyle = `hsla(${p.hue} ${p.sat}% ${p.lit}% / ${k * p.alpha * 0.7})`;
          ctx.fillRect(p.x, p.y, p.size, p.size);
          break;
        case 'mist':
          ctx.fillStyle = `hsla(${p.hue} 60% 60% / ${k * 0.16})`;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size * (1.6 - k * 0.6), 0, Math.PI * 2);
          ctx.fill();
          break;
        case 'mote':
          ctx.fillStyle = `hsla(${p.hue} 90% 70% / ${k})`;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size * (0.6 + Math.sin(p.life * 12) * 0.3 + 0.4), 0, Math.PI * 2);
          ctx.fill();
          break;
        case 'bubble':
          ctx.strokeStyle = `hsla(${p.hue} 80% 65% / ${k * 0.8})`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(p.x, p.y - p.life * 18, p.size, 0, Math.PI * 2);
          ctx.stroke();
          break;
        case 'ripple':
          ctx.strokeStyle = `hsla(${p.hue} 70% 75% / ${k * 0.7})`;
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.ellipse(p.x, p.y, p.life * 46 + 3, (p.life * 46 + 3) * 0.5, 0, 0, Math.PI * 2);
          ctx.stroke();
          break;
        case 'shockwave':
          ctx.strokeStyle = `hsla(${p.hue} 90% 65% / ${k * 0.8})`;
          ctx.lineWidth = 3 * k;
          ctx.beginPath();
          ctx.ellipse(p.x, p.y, p.life * 130 + 4, (p.life * 130 + 4) * 0.6, 0, 0, Math.PI * 2);
          ctx.stroke();
          break;
        case 'petal':
          ctx.fillStyle = `hsla(${p.hue} 70% 65% / ${k})`;
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.life * 5);
          ctx.beginPath();
          ctx.ellipse(0, 0, p.size * 1.6, p.size * 0.8, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
          break;
      }
    }
  }

  private updateFloats(ctx: CanvasRenderingContext2D, dt: number): void {
    ctx.textAlign = 'center';
    for (let i = this.floats.length - 1; i >= 0; i--) {
      const f = this.floats[i];
      f.life += dt;
      if (f.life >= f.maxLife) {
        this.floats.splice(i, 1);
        continue;
      }
      const k = 1 - f.life / f.maxLife;
      const popK = 1 + 0.65 * Math.max(0, 1 - f.life * 6);
      ctx.font = `800 ${Math.round(f.size * popK)}px 'Segoe UI', system-ui, sans-serif`;
      ctx.strokeStyle = 'rgba(0,0,0,0.65)';
      ctx.lineWidth = 3;
      ctx.globalAlpha = k;
      ctx.strokeText(f.text, f.x, f.y - f.life * 34);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, f.y - f.life * 34);
      ctx.globalAlpha = 1;
    }
  }

  private drawVignette(ctx: CanvasRenderingContext2D, W: number, H: number): void {
    const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.78);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.4)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
}
