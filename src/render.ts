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
import type { GameEvent, GameState, PlayerId, SpeciesId } from './types';
import { speciesDef } from './data';
import { getAnim, getPhaseArt, getSprite } from './sprites';
import type { Sprite } from './sprites';
import { CELL, cellAt } from './navmask';
import type { WorldId } from './navmask';
import { drawSpecies } from './vector-art';

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Per-species sprite size trims. */
const SIZE_TWEAK: Partial<Record<SpeciesId, number>> = {
  fireants: 0.8,
  wolves: 0.94,
};

const spriteHeight = (s: number, species: SpeciesId, colossal: boolean, heavy: boolean): number =>
  s * (colossal ? 2.5 : heavy ? 2.2 : 1.9) * (SIZE_TWEAK[species] ?? 1);

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

interface DisplayUnit {
  dx: number; dy: number;
  runPhase: number;
  age: number;
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
  private ghosts: Ghost[] = [];
  private hitStop = 0;
  private lastHitDir = new Map<number, { x: number; y: number }>();
  private raf = 0;
  private running = false;
  private time = 0;
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
          if (e.amount >= 30) this.hitStop = Math.max(this.hitStop, 0.05);
        }
        this.floats.push({
          x: p.x + (Math.random() - 0.5) * 14, y: p.y - this.unit * 0.5,
          text: `-${e.amount}`, life: 0, maxLife: 0.9,
          color: e.kind === 'burn' ? '#ff9d45' : e.kind === 'reflect' ? '#6dffc9' : '#ffffff',
          size: clamp(10 + e.amount * 0.12, 10, 20),
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

  private pickFrame(species: SpeciesId, d: DisplayUnit, moving: boolean, flying: boolean): Sprite | null {
    const anim = getAnim(species);
    if (!anim) return getSprite(species, 0);
    // Attack timeline: anticipation -> strike -> recoil over 0.5 s.
    if (d.atk) {
      const at = (this.time - d.atk.t0) / 0.5;
      if (at < 1) {
        const frames = species === 'bear' && d.atk.air && anim.swat ? anim.swat : anim.attack;
        const idx = at < 0.35 ? 0 : at < 0.65 ? 1 : 2;
        return frames[Math.min(idx, frames.length - 1)];
      }
    }
    // Flyers always flap; grounded units run when moving, else hold contact.
    if (flying || moving) {
      return anim.run[Math.floor(d.runPhase) % anim.run.length];
    }
    return anim.run[0];
  }

  private drawUnits(ctx: CanvasRenderingContext2D, st: GameState, dt: number, now: number): void {
    const alive = new Set<number>();
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
        d = { dx: u.x, dy: u.y, runPhase: (u.id * 0.7) % 4, age: 0 };
        this.display.set(u.id, d);
      }
      d.age += dt;

      // Visual catch-up interpolation toward the sim position.
      const distW = Math.hypot(u.x - d.dx, u.y - d.dy);
      const rate = clamp((4.2 + distW * 3.4) * dt, 0, 1);
      d.dx = lerp(d.dx, u.x, rate);
      d.dy = lerp(d.dy, u.y, rate);
      const moving = distW > 0.05;

      const stats = speciesDef(u.species).stats!;
      const flying = stats.flying;
      // Run cadence tied to actual ground speed (world units/second).
      const wps = (stats.speed / TICK_MS) * 1000;
      d.runPhase += dt * (flying ? 9 : moving ? 5 + wps * 22 : 1.2);

      const p = this.worldToScreen(d.dx, d.dy);
      const hover = flying ? -this.unit * 0.55 - Math.sin(this.time * 2.2 + u.id) * 3 : 0;
      const s = this.unit * (stats.colossal ? 0.78 : stats.heavy ? 0.68 : 0.54);

      const popT = clamp(d.age / 0.45, 0, 1);
      const pb = popT - 1;
      const pop = 1 + 2.70158 * pb * pb * pb + 1.70158 * pb * pb;

      const stealthAlpha = u.stealthed ? (u.owner === this.localSeat ? 0.45 : 0.08) : 1;
      const mineUnit = u.owner === this.localSeat;
      ctx.save();
      ctx.globalAlpha = stealthAlpha;

      // Team ring + contact shadow.
      const ringHue = mineUnit ? 190 : 6;
      ctx.strokeStyle = `hsla(${ringHue} 90% ${mineUnit ? 62 : 56}% / 0.5)`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(p.x, p.y + this.unit * 0.14, s * 0.75 * pop, s * 0.28 * pop, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = `rgba(0,0,0,${flying ? 0.24 : 0.36})`;
      ctx.beginPath();
      ctx.ellipse(p.x, p.y + this.unit * 0.15, s * 0.62 * pop, s * 0.22 * pop, 0, 0, Math.PI * 2);
      ctx.fill();

      const frame = this.pickFrame(u.species, d, moving, flying);

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
      if (frame) {
        const targetH = spriteHeight(s, u.species, stats.colossal, stats.heavy);
        const scale = targetH / frame.h;
        ac.drawImage(
          frame.canvas,
          pad - frame.anchorX * scale,
          pad + s * 0.55 - frame.anchorY * scale,
          frame.canvas.width * scale,
          frame.canvas.height * scale,
        );
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

      ctx.translate(p.x, p.y + hover - s * 0.55);

      // Attack lunge (subtle now that real strike frames exist).
      let strikeStretch = 0;
      if (d.atk) {
        const at = (this.time - d.atk.t0) / 0.5;
        if (at >= 1) {
          d.atk = undefined;
        } else {
          let lunge: number;
          if (at < 0.35) lunge = -0.09 * (at / 0.35);
          else if (at < 0.6) {
            const kk = (at - 0.35) / 0.25;
            lunge = -0.09 + 0.34 * (1 - (1 - kk) * (1 - kk));
          } else lunge = 0.25 * (1 - (at - 0.6) / 0.4);
          const amp = (d.atk.crit ? 1.35 : 1) * s;
          ctx.translate(d.atk.dirX * lunge * amp, d.atk.dirY * lunge * amp);
          strikeStretch = at >= 0.35 && at < 0.6 ? 0.06 : at < 0.35 ? -0.04 : 0;
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

      const face = this.localSeat === 1 ? -u.facing : u.facing;
      const native = frame ? frame.nativeFacing : 1;
      if (face !== native) ctx.scale(-1, 1);

      let sqx = 1;
      let sqy = 1;
      if (moving && !flying) {
        const q = Math.sin(d.runPhase * Math.PI * 0.5) * 0.03;
        sqx = 1 + q;
        sqy = 1 - q;
      } else if (!moving && !d.atk) {
        sqy *= 1 + Math.sin(this.time * 2 + u.id * 1.7) * 0.012;
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
      const s = this.unit * (g.colossal ? 0.78 : g.heavy ? 0.68 : 0.54);
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
