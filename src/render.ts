/* ============================================================================
 * VAALBARA: THE LAST OASIS — render.ts
 * Procedural 2.5D canvas renderer. ZERO external image assets.
 *
 *  - Foreshortened isometric-style board: tiles are drawn as beveled slabs
 *    with painted side faces, ambient occlusion and phase-specific gradient
 *    palettes; units are layered vector drawings with elliptical contact
 *    shadows, so the scene reads as 2.5D depth on a strictly portrait canvas.
 *  - Runs its own requestAnimationFrame loop at display refresh (60fps),
 *    fully decoupled from the 1.2 s simulation tick.
 *  - Visual catch-up interpolation: every unit owns a display position that
 *    chases its simulation tile with an exponential smoothing factor. Normal
 *    ticks glide; a network rewind/replay correction (teleporting sim state)
 *    is absorbed by the same chase — sprites accelerate smoothly to the
 *    corrected position instead of popping.
 *  - Particle engines: lava sparks, drifting ash, water ripples, glowing
 *    mist, sulfur fog, acid bubbles, hit flashes, healing motes.
 * ========================================================================== */

import { BOARD_H, BOARD_W, TICK_MS, idx } from './types';
import type { GameEvent, GameState, PlayerId, SpeciesId, UnitState } from './types';
import { speciesDef } from './data';

/* ------------------------------------------------------------------------ */
/* Small math helpers                                                         */
/* ------------------------------------------------------------------------ */

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

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

interface DisplayUnit {
  dx: number; dy: number; // smoothed display tile coords (float)
  bob: number;
  lastSeenTick: number;
  deathT?: number;
}

export interface DragOverlay {
  active: boolean;
  fromX: number; fromY: number; // tile coords
  toX: number; toY: number; // tile coords (float)
  valid: boolean;
  hue: number;
}

export interface TelegraphOverlay {
  active: boolean;
  x: number; y: number;
  kind: 'spell' | 'ult';
}

/* ------------------------------------------------------------------------ */
/* Renderer                                                                   */
/* ------------------------------------------------------------------------ */

export class Renderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private state: GameState | null = null;
  private lastTickAt = 0;
  private particles: Particle[] = [];
  private floats: FloatText[] = [];
  private display = new Map<number, DisplayUnit>();
  private raf = 0;
  private running = false;
  private time = 0;
  private lastFrame = 0;
  /** Camera pan progress for the phase transition (0 = basalt, 1 = oasis). */
  private camPan = 0;
  private shake = 0;
  /** Which seat the local player views from (board is flipped for seat 1). */
  localSeat: PlayerId = 0;
  drag: DragOverlay = { active: false, fromX: 0, fromY: 0, toX: 0, toY: 0, valid: false, hue: 0 };
  telegraph: TelegraphOverlay = { active: false, x: 0, y: 0, kind: 'spell' };

  // Layout (recomputed on resize).
  private tileW = 40;
  private tileH = 30;
  private ox = 0;
  private oy = 0;
  private dpr = 1;

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
    // Fit the board with margins for the sky band and HUD.
    this.tileW = Math.floor(Math.min(cssW / (BOARD_W + 0.6), cssH / ((BOARD_H + 2.5) * 0.82)));
    this.tileH = Math.floor(this.tileW * 0.82);
    this.ox = Math.round((cssW - BOARD_W * this.tileW) / 2);
    this.oy = Math.round((cssH - BOARD_H * this.tileH) / 2) + this.tileH * 0.4;
  }

  /** Board tile -> screen px (centre of tile top face). Flips for seat 1. */
  tileToScreen(gx: number, gy: number): { x: number; y: number } {
    const fx = this.localSeat === 1 ? BOARD_W - 1 - gx : gx;
    const fy = this.localSeat === 1 ? BOARD_H - 1 - gy : gy;
    return {
      x: this.ox + (fx + 0.5) * this.tileW,
      y: this.oy + (fy + 0.5) * this.tileH,
    };
  }

  screenToTile(px: number, py: number): { x: number; y: number } {
    const fx = (px - this.ox) / this.tileW - 0.5;
    const fy = (py - this.oy) / this.tileH - 0.5;
    const gx = this.localSeat === 1 ? BOARD_W - 1 - fx : fx;
    const gy = this.localSeat === 1 ? BOARD_H - 1 - fy : fy;
    return { x: gx, y: gy };
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
        const p = this.tileToScreen(e.x, e.y);
        this.burst(p.x, p.y, 10, 'mist', e.owner === this.localSeat ? 190 : 20, 1.4);
        break;
      }
      case 'attack': {
        if (e.crit) {
          const p = this.tileToScreen(e.tx, e.ty);
          this.burst(p.x, p.y, 16, 'spark', 45, 2.2);
          this.shake = Math.max(this.shake, 6);
        }
        break;
      }
      case 'hit': {
        const p = this.tileToScreen(e.x, e.y);
        const hue = e.kind === 'burn' ? 20 : e.kind === 'lava' ? 8 : e.kind === 'vent' ? 55 : e.kind === 'reflect' ? 160 : 0;
        this.burst(p.x, p.y, e.kind === 'lava' ? 18 : 5, e.kind === 'lava' ? 'spark' : 'flash', hue, 1.4);
        this.floats.push({
          x: p.x + (Math.random() - 0.5) * 14, y: p.y - this.tileH * 0.5,
          text: `-${e.amount}`, life: 0, maxLife: 0.9,
          color: e.kind === 'burn' ? '#ff9d45' : e.kind === 'reflect' ? '#6dffc9' : '#ffffff',
          size: clamp(10 + e.amount * 0.12, 10, 20),
        });
        break;
      }
      case 'death': {
        const p = this.tileToScreen(e.x, e.y);
        this.burst(p.x, p.y, 22, 'spark', e.owner === 0 ? 14 : 165, 2.0);
        this.burst(p.x, p.y, 8, 'mist', 0, 1.5);
        break;
      }
      case 'heal': {
        const p = this.tileToScreen(e.x, e.y);
        this.burst(p.x, p.y, 12, 'mote', 140, 1.6);
        this.floats.push({ x: p.x, y: p.y - this.tileH * 0.6, text: `+${e.amount}`, life: 0, maxLife: 1, color: '#7dffa8', size: 13 });
        break;
      }
      case 'roar': {
        const p = this.tileToScreen(e.x, e.y);
        this.burst(p.x, p.y, 3, 'shockwave', 40, 1);
        this.shake = Math.max(this.shake, 5);
        break;
      }
      case 'stomp': {
        const p = this.tileToScreen(e.x, e.y);
        this.burst(p.x, p.y, 1, 'shockwave', 25, 1);
        this.burst(p.x, p.y, 8, 'ash', 30, 1.2);
        this.shake = Math.max(this.shake, 3);
        break;
      }
      case 'charge': {
        const p = this.tileToScreen(e.x, e.y);
        this.burst(p.x, p.y, 10, 'spark', 90, 1.8);
        break;
      }
      case 'spellCast': {
        const p = this.tileToScreen(e.x, e.y);
        if (e.spell === 'sulfur') this.burst(p.x, p.y, 20, 'mist', 55, 2.2);
        else if (e.spell === 'thicket') this.burst(p.x, p.y, 16, 'petal', 110, 2);
        break;
      }
      case 'lavaStrike': {
        const p = this.tileToScreen(e.x, e.y);
        this.burst(p.x, p.y, 46, 'spark', 12, 3.2);
        this.burst(p.x, p.y, 4, 'shockwave', 12, 1);
        this.burst(p.x, p.y, 16, 'ash', 20, 2);
        this.shake = 14;
        break;
      }
      case 'lotusBurst': {
        const p = this.tileToScreen(e.x, e.y);
        this.burst(p.x, p.y, 20, 'mote', 140, 2.4);
        this.burst(p.x, p.y, 10, 'petal', 320, 1.8);
        break;
      }
      case 'lilySink': {
        const p = this.tileToScreen(e.x, e.y);
        this.burst(p.x, p.y, 12, 'ripple', 200, 1.6);
        break;
      }
      case 'phaseChange':
        break;
      default:
        break;
    }
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
      const dt = clamp((now - this.lastFrame) / 1000, 0, 0.1);
      this.lastFrame = now;
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

    // Camera shake decay.
    this.shake = Math.max(0, this.shake - dt * 26);
    if (this.shake > 0) {
      ctx.translate((Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake);
    }

    // Phase transition camera pan: ease camPan toward the target.
    const wantPan = st && (st.phase === 'oasis' || st.phase === 'ended') ? 1 : st?.phase === 'transition' ? 0.5 : 0;
    this.camPan += (wantPan - this.camPan) * clamp(dt * 1.6, 0, 1);

    this.drawBackdrop(ctx, W, H);
    if (st) {
      this.drawBoard(ctx, st);
      this.drawZones(ctx, st, 'under');
      this.drawTelegraphs(ctx, st, now);
      this.drawUnits(ctx, st, dt, now);
      this.drawZones(ctx, st, 'over');
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
    // Sky gradient morphs from ash-red dusk to jade dawn.
    const g = ctx.createLinearGradient(0, 0, 0, H);
    const topH = lerp(356, 168, pan);
    const topS = lerp(45, 42, pan);
    const topL = lerp(9, 14, pan);
    const botH = lerp(18, 150, pan);
    g.addColorStop(0, `hsl(${topH} ${topS}% ${topL}%)`);
    g.addColorStop(0.55, `hsl(${lerp(8, 165, pan)} ${lerp(40, 35, pan)}% ${lerp(13, 12, pan)}%)`);
    g.addColorStop(1, `hsl(${botH} ${lerp(60, 45, pan)}% ${lerp(8, 9, pan)}%)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // Distant parallax ridgelines.
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
      const hh = lerp(6, 155, pan);
      ctx.fillStyle = `hsla(${hh} ${lerp(50, 30, pan)}% ${7 + layer * 3}% / ${0.55 - layer * 0.12})`;
      ctx.fill();
    }

    // Ambient atmosphere: ash flakes in phase 1, fireflies/mist in phase 2.
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

  /* ------------------------------- board -------------------------------- */

  private tileFill(ctx: CanvasRenderingContext2D, terrain: string, destroyed: boolean, sx: number, sy: number, gy: number): void {
    const w = this.tileW;
    const h = this.tileH;
    const t = this.time;
    const x0 = sx - w / 2;
    const y0 = sy - h / 2;
    let grad: CanvasGradient;

    switch (terrain) {
      case 'basalt': {
        grad = ctx.createLinearGradient(x0, y0, x0, y0 + h);
        const shade = 16 + ((gy * 7 + Math.floor(sx)) % 3) * 2;
        grad.addColorStop(0, `hsl(258 12% ${shade + 5}%)`);
        grad.addColorStop(1, `hsl(255 14% ${shade}%)`);
        break;
      }
      case 'magma': {
        grad = ctx.createLinearGradient(x0, y0, x0 + w, y0 + h);
        const pulse = 50 + Math.sin(t * 2.4 + gy * 1.7 + sx * 0.02) * 9;
        grad.addColorStop(0, `hsl(14 95% ${pulse}%)`);
        grad.addColorStop(0.5, `hsl(30 100% ${pulse + 10}%)`);
        grad.addColorStop(1, `hsl(8 90% ${pulse - 8}%)`);
        break;
      }
      case 'vent': {
        grad = ctx.createRadialGradient(sx, sy, 2, sx, sy, w * 0.6);
        const puff = 30 + Math.sin(t * 3.1 + gy) * 8;
        grad.addColorStop(0, `hsl(58 70% ${puff}%)`);
        grad.addColorStop(1, 'hsl(256 13% 17%)');
        break;
      }
      case 'grass': {
        grad = ctx.createLinearGradient(x0, y0, x0, y0 + h);
        const gsh = 24 + ((gy * 5 + Math.floor(sx)) % 3) * 3;
        grad.addColorStop(0, `hsl(120 42% ${gsh + 5}%)`);
        grad.addColorStop(1, `hsl(133 46% ${gsh}%)`);
        break;
      }
      case 'sand': {
        grad = ctx.createLinearGradient(x0, y0, x0, y0 + h);
        grad.addColorStop(0, 'hsl(45 42% 42%)');
        grad.addColorStop(1, 'hsl(40 40% 34%)');
        break;
      }
      case 'shallow': {
        grad = ctx.createLinearGradient(x0, y0, x0, y0 + h);
        const wl = 40 + Math.sin(t * 1.8 + gy * 2 + sx * 0.04) * 4;
        grad.addColorStop(0, `hsl(185 65% ${wl}%)`);
        grad.addColorStop(1, `hsl(196 70% ${wl - 8}%)`);
        break;
      }
      case 'deep': {
        grad = ctx.createLinearGradient(x0, y0, x0, y0 + h);
        const dl = 26 + Math.sin(t * 1.4 + gy * 1.4) * 3;
        grad.addColorStop(0, `hsl(203 75% ${dl}%)`);
        grad.addColorStop(1, `hsl(214 80% ${dl - 7}%)`);
        break;
      }
      case 'reeds': {
        grad = ctx.createLinearGradient(x0, y0, x0, y0 + h);
        grad.addColorStop(0, 'hsl(95 45% 26%)');
        grad.addColorStop(1, 'hsl(105 50% 19%)');
        break;
      }
      case 'lily': {
        grad = ctx.createLinearGradient(x0, y0, x0, y0 + h);
        if (destroyed) {
          grad.addColorStop(0, 'hsl(207 78% 22%)');
          grad.addColorStop(1, 'hsl(215 82% 16%)');
        } else {
          grad.addColorStop(0, 'hsl(203 75% 27%)');
          grad.addColorStop(1, 'hsl(210 78% 21%)');
        }
        break;
      }
      case 'lotus': {
        grad = ctx.createLinearGradient(x0, y0, x0, y0 + h);
        const wl2 = 38 + Math.sin(t * 1.8 + gy * 2) * 4;
        grad.addColorStop(0, `hsl(188 62% ${wl2}%)`);
        grad.addColorStop(1, `hsl(197 68% ${wl2 - 8}%)`);
        break;
      }
      default: {
        grad = ctx.createLinearGradient(x0, y0, x0, y0 + h);
        grad.addColorStop(0, '#333');
        grad.addColorStop(1, '#222');
      }
    }
    ctx.fillStyle = grad;
  }

  private drawBoard(ctx: CanvasRenderingContext2D, st: GameState): void {
    const w = this.tileW;
    const h = this.tileH;
    const t = this.time;

    // Board base slab (gives the 2.5D "floating island" read).
    const b0 = this.tileToScreen(0, 0);
    const b1 = this.tileToScreen(BOARD_W - 1, BOARD_H - 1);
    const left = Math.min(b0.x, b1.x) - w / 2;
    const top = Math.min(b0.y, b1.y) - h / 2;
    const bw = BOARD_W * w;
    const bh = BOARD_H * h;
    ctx.fillStyle = 'rgba(0,0,0,0.42)';
    ctx.beginPath();
    ctx.roundRect(left - 5, top - 3, bw + 10, bh + 14, 10);
    ctx.fill();

    for (let gy = 0; gy < BOARD_H; gy++) {
      for (let gx = 0; gx < BOARD_W; gx++) {
        const tile = st.board[idx(gx, gy)];
        const p = this.tileToScreen(gx, gy);
        const x0 = p.x - w / 2;
        const y0 = p.y - h / 2;

        this.tileFill(ctx, tile.terrain, tile.destroyed, p.x, p.y, gy);
        ctx.beginPath();
        ctx.roundRect(x0 + 0.6, y0 + 0.6, w - 1.2, h - 1.2, 3);
        ctx.fill();

        // Bevel highlight along the top edge = the 2.5D slab illusion.
        ctx.fillStyle = 'rgba(255,255,255,0.06)';
        ctx.fillRect(x0 + 1, y0 + 1, w - 2, 2);
        ctx.fillStyle = 'rgba(0,0,0,0.16)';
        ctx.fillRect(x0 + 1, y0 + h - 3, w - 2, 2);

        // Terrain decorations.
        switch (tile.terrain) {
          case 'basalt':
            if ((gx * 31 + gy * 17) % 7 === 0) {
              ctx.strokeStyle = 'rgba(0,0,0,0.35)';
              ctx.lineWidth = 1;
              ctx.beginPath();
              ctx.moveTo(x0 + w * 0.25, y0 + h * 0.3);
              ctx.lineTo(x0 + w * 0.55, y0 + h * 0.55);
              ctx.lineTo(x0 + w * 0.45, y0 + h * 0.8);
              ctx.stroke();
            }
            break;
          case 'magma': {
            // Drifting bright veins + occasional spark.
            ctx.strokeStyle = `hsla(45 100% ${70 + Math.sin(t * 3 + gx) * 12}% / 0.7)`;
            ctx.lineWidth = 1.6;
            ctx.beginPath();
            const ph = t * 1.1 + gx * 0.8 + gy;
            ctx.moveTo(x0 + 2, p.y + Math.sin(ph) * 4);
            ctx.quadraticCurveTo(p.x, p.y + Math.cos(ph * 1.3) * 5, x0 + w - 2, p.y + Math.sin(ph + 1.5) * 4);
            ctx.stroke();
            if (Math.random() < 0.006) this.burst(p.x, p.y, 2, 'spark', 25, 0.8);
            break;
          }
          case 'vent':
            if (Math.random() < 0.02) this.burst(p.x, p.y - 4, 1, 'mist', 58, 0.7);
            break;
          case 'shallow':
          case 'deep': {
            // Water ripples.
            const rp = (t * 0.7 + gx * 0.35 + gy * 0.6) % 1;
            ctx.strokeStyle = `rgba(255,255,255,${0.14 * (1 - rp)})`;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.ellipse(p.x, p.y, (w * 0.36) * rp + 2, (h * 0.3) * rp + 1.4, 0, 0, Math.PI * 2);
            ctx.stroke();
            break;
          }
          case 'grass':
            if ((gx * 13 + gy * 29) % 5 === 0) {
              ctx.strokeStyle = 'hsla(110 50% 40% / 0.8)';
              ctx.lineWidth = 1.2;
              for (let b = 0; b < 3; b++) {
                const bx = x0 + w * (0.25 + b * 0.25);
                ctx.beginPath();
                ctx.moveTo(bx, y0 + h * 0.75);
                ctx.quadraticCurveTo(bx + Math.sin(t * 1.8 + b + gx) * 3, y0 + h * 0.5, bx + Math.sin(t * 1.8 + b + gx) * 5, y0 + h * 0.32);
                ctx.stroke();
              }
            }
            break;
          case 'reeds': {
            ctx.strokeStyle = 'hsla(85 55% 45% / 0.9)';
            ctx.lineWidth = 1.6;
            for (let r = 0; r < 4; r++) {
              const rx = x0 + w * (0.18 + r * 0.22);
              const sway = Math.sin(t * 1.4 + r * 1.3 + gx * 2) * 4;
              ctx.beginPath();
              ctx.moveTo(rx, y0 + h * 0.9);
              ctx.quadraticCurveTo(rx + sway * 0.4, y0 + h * 0.4, rx + sway, y0 - h * 0.25);
              ctx.stroke();
              ctx.fillStyle = 'hsla(38 60% 55% / 0.9)';
              ctx.beginPath();
              ctx.ellipse(rx + sway, y0 - h * 0.25, 2, 4.5, sway * 0.05, 0, Math.PI * 2);
              ctx.fill();
            }
            break;
          }
          case 'lily':
            if (!tile.destroyed) {
              ctx.fillStyle = 'hsl(120 50% 34%)';
              ctx.beginPath();
              ctx.ellipse(p.x, p.y + Math.sin(t * 1.6 + gx) * 1.4, w * 0.34, h * 0.3, 0, 0.25, Math.PI * 2 - 0.15);
              ctx.lineTo(p.x, p.y + Math.sin(t * 1.6 + gx) * 1.4);
              ctx.closePath();
              ctx.fill();
              ctx.fillStyle = 'hsla(120 60% 48% / 0.6)';
              ctx.beginPath();
              ctx.ellipse(p.x - 3, p.y - 2, w * 0.14, h * 0.1, -0.4, 0, Math.PI * 2);
              ctx.fill();
            }
            break;
          case 'lotus':
            if (!tile.destroyed) {
              const bloom = 1 + Math.sin(t * 2.2 + gx * 3) * 0.08;
              ctx.fillStyle = 'hsl(320 70% 72%)';
              for (let pt = 0; pt < 6; pt++) {
                const a = (pt / 6) * Math.PI * 2 + t * 0.15;
                ctx.beginPath();
                ctx.ellipse(p.x + Math.cos(a) * 4 * bloom, p.y + Math.sin(a) * 3 * bloom, 4.4, 2.6, a, 0, Math.PI * 2);
                ctx.fill();
              }
              ctx.fillStyle = 'hsl(48 95% 62%)';
              ctx.beginPath();
              ctx.arc(p.x, p.y, 2.6, 0, Math.PI * 2);
              ctx.fill();
            }
            break;
          default:
            break;
        }
      }
    }

    // Deploy-zone glow along the local baseline.
    if (st.phase === 'basalt' || st.phase === 'oasis') {
      const rows = this.localSeat === 0 ? [BOARD_H - 3, BOARD_H - 2, BOARD_H - 1] : [0, 1, 2];
      const p0 = this.tileToScreen(0, rows[0]);
      const p1 = this.tileToScreen(BOARD_W - 1, rows[rows.length - 1]);
      const yTop = Math.min(p0.y, p1.y) - h / 2;
      const yBot = Math.max(p0.y, p1.y) + h / 2;
      const glow = ctx.createLinearGradient(0, yTop, 0, yBot);
      const pulse = 0.05 + Math.sin(t * 2.2) * 0.02;
      glow.addColorStop(0, `hsla(190 90% 60% / ${this.localSeat === 0 ? 0 : pulse * 2})`);
      glow.addColorStop(1, `hsla(190 90% 60% / ${this.localSeat === 0 ? pulse * 2 : 0})`);
      ctx.fillStyle = glow;
      ctx.fillRect(this.ox, yTop, BOARD_W * w, yBot - yTop);
    }
  }

  /* ------------------------------- zones -------------------------------- */

  private drawZones(ctx: CanvasRenderingContext2D, st: GameState, layer: 'under' | 'over'): void {
    const w = this.tileW;
    const h = this.tileH;
    const t = this.time;
    for (const z of st.zones) {
      const p = this.tileToScreen(z.x, z.y);
      const rw = (z.r * 2 + 1) * w * 0.52;
      const rh = (z.r * 2 + 1) * h * 0.52;
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
        ctx.fillStyle = 'hsla(110 50% 25% / 0.55)';
        ctx.beginPath();
        ctx.roundRect(p.x - rw, p.y - rh, rw * 2, rh * 2, 8);
        ctx.fill();
        ctx.strokeStyle = 'hsla(100 60% 42% / 0.9)';
        ctx.lineWidth = 1.6;
        for (let b = 0; b < 14; b++) {
          const bx = p.x - rw + ((b * 73) % Math.round(rw * 2));
          const by = p.y - rh + (((b * 41) % Math.round(rh * 2)));
          const sway = Math.sin(t * 1.8 + b) * 3;
          ctx.beginPath();
          ctx.moveTo(bx, by + 8);
          ctx.quadraticCurveTo(bx + sway * 0.5, by, bx + sway, by - 9);
          ctx.stroke();
        }
      } else if (z.kind === 'acidpool' && layer === 'under') {
        ctx.fillStyle = `hsla(80 80% 45% / ${0.3 + Math.sin(t * 3) * 0.05})`;
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, rw * 0.8, rh * 0.8, 0, 0, Math.PI * 2);
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
    // Lava Rain telegraph: growing shadow disc + falling ember glow.
    for (const lv of st.pendingLava) {
      const p = this.tileToScreen(lv.x, lv.y);
      const progress = clamp(1 - (lv.resolveTick - st.tick - 1 + (1 - (now - this.lastTickAt) / TICK_MS)), 0, 1);
      const rw = this.tileW * 2.5;
      const rh = this.tileH * 2.5;
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

  /* ------------------------------- units --------------------------------- */

  private drawUnits(ctx: CanvasRenderingContext2D, st: GameState, dt: number, now: number): void {
    // Sort by display row for painter's-algorithm depth.
    const alive = new Set<number>();
    const order = [...st.units].sort((a, b) => {
      const da = this.display.get(a.id)?.dy ?? a.y;
      const db = this.display.get(b.id)?.dy ?? b.y;
      return da - db;
    });

    for (const u of order) {
      alive.add(u.id);
      let d = this.display.get(u.id);
      if (!d) {
        d = { dx: u.x, dy: u.y, bob: Math.random() * 10, lastSeenTick: st.tick };
        this.display.set(u.id, d);
      }
      // Visual catch-up interpolation: the display position chases the sim
      // tile with a rate proportional to distance. Regular ticks -> smooth
      // glide across one tile; rewind corrections -> swift, smooth catch-up.
      const dist = Math.hypot(u.x - d.dx, u.y - d.dy);
      const rate = clamp((1.8 + dist * 2.2) * dt, 0, 1);
      d.dx = lerp(d.dx, u.x, rate);
      d.dy = lerp(d.dy, u.y, rate);
      d.bob += dt * (u.action === 'move' ? 9 : 3.6);

      const p = this.tileToScreen(d.dx, d.dy);
      const stats = speciesDef(u.species).stats!;
      const flying = stats.flying;
      const hover = flying ? -this.tileH * 0.55 - Math.sin(d.bob) * 3 : 0;
      const bobY = flying ? 0 : Math.abs(Math.sin(d.bob)) * -2;
      const s = this.tileW * (stats.colossal ? 0.62 : stats.heavy ? 0.55 : 0.42);

      const stealthAlpha = u.stealthed ? (u.owner === this.localSeat ? 0.45 : 0.08) : 1;
      ctx.save();
      ctx.globalAlpha = stealthAlpha;

      // Contact shadow.
      ctx.fillStyle = `rgba(0,0,0,${flying ? 0.22 : 0.34})`;
      ctx.beginPath();
      ctx.ellipse(p.x, p.y + this.tileH * 0.22, s * 0.8, s * 0.3, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.translate(p.x, p.y + hover + bobY);
      const face = this.localSeat === 1 ? -u.facing : u.facing;
      if (face === -1) ctx.scale(-1, 1);

      // Attack lunge animation within the current tick window.
      if (u.action === 'attack') {
        const a = clamp((now - this.lastTickAt) / 300, 0, 1);
        const lunge = Math.sin(a * Math.PI) * s * 0.24;
        ctx.translate(lunge, 0);
      }

      drawSpecies(ctx, u.species, s, this.time + u.id * 0.61, u);
      ctx.restore();

      // Status FX drawn un-flipped.
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

      // HP bar.
      const hpw = s * 1.5;
      const frac = clamp(u.hp / u.maxHp, 0, 1);
      const hy = p.y + hover - s * 1.18;
      ctx.globalAlpha = stealthAlpha;
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.beginPath();
      ctx.roundRect(p.x - hpw / 2, hy, hpw, 3.6, 2);
      ctx.fill();
      const mine = u.owner === this.localSeat;
      ctx.fillStyle = mine ? (frac > 0.35 ? 'hsl(150 80% 48%)' : 'hsl(45 95% 55%)') : 'hsl(2 85% 55%)';
      ctx.beginPath();
      ctx.roundRect(p.x - hpw / 2, hy, hpw * frac, 3.6, 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    for (const id of [...this.display.keys()]) {
      if (!alive.has(id)) this.display.delete(id);
    }
  }

  /* -------------------------- input overlays ----------------------------- */

  private drawDragOverlay(ctx: CanvasRenderingContext2D): void {
    if (!this.drag.active) return;
    const from = this.tileToScreen(this.drag.fromX, this.drag.fromY);
    const to = this.tileToScreen(this.drag.toX, this.drag.toY);
    const hue = this.drag.valid ? this.drag.hue : 0;
    const sat = this.drag.valid ? 90 : 90;
    const lit = this.drag.valid ? 60 : 45;

    // Spawn tile highlight.
    ctx.strokeStyle = `hsla(${hue} ${sat}% ${lit}% / 0.95)`;
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.roundRect(from.x - this.tileW / 2 + 2, from.y - this.tileH / 2 + 2, this.tileW - 4, this.tileH - 4, 4);
    ctx.stroke();

    // Trajectory arrow with animated dashes.
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const len = Math.hypot(dx, dy);
    if (len > 8) {
      const nx = dx / len;
      const ny = dy / len;
      ctx.strokeStyle = `hsla(${hue} ${sat}% ${lit}% / 0.9)`;
      ctx.lineWidth = 3.4;
      ctx.setLineDash([9, 7]);
      ctx.lineDashOffset = -this.time * 40;
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x - nx * 12, to.y - ny * 12);
      ctx.stroke();
      ctx.setLineDash([]);
      // Arrowhead.
      ctx.fillStyle = `hsla(${hue} ${sat}% ${lit + 10}% / 0.95)`;
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
    const p = this.tileToScreen(this.telegraph.x, this.telegraph.y);
    const r = this.telegraph.kind === 'ult' ? 2.5 : 1.5;
    const pulse = 0.65 + Math.sin(this.time * 5) * 0.25;
    ctx.strokeStyle = this.telegraph.kind === 'ult'
      ? `hsla(14 100% 58% / ${pulse})`
      : `hsla(150 90% 60% / ${pulse})`;
    ctx.lineWidth = 2.5;
    ctx.setLineDash([7, 6]);
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, r * this.tileW, r * this.tileH, 0, 0, Math.PI * 2);
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
        case 'spark': {
          ctx.fillStyle = `hsla(${p.hue} ${p.sat}% ${p.lit + k * 25}% / ${k})`;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size * (0.5 + k * 0.5), 0, Math.PI * 2);
          ctx.fill();
          break;
        }
        case 'flash': {
          ctx.fillStyle = `hsla(${p.hue} ${p.sat}% ${p.lit}% / ${k * 0.9})`;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
          ctx.fill();
          break;
        }
        case 'ash': {
          ctx.fillStyle = `hsla(${p.hue} ${p.sat}% ${p.lit}% / ${k * p.alpha * 0.7})`;
          ctx.fillRect(p.x, p.y, p.size, p.size);
          break;
        }
        case 'mist': {
          ctx.fillStyle = `hsla(${p.hue} 60% 60% / ${k * 0.16})`;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size * (1.6 - k * 0.6), 0, Math.PI * 2);
          ctx.fill();
          break;
        }
        case 'mote': {
          ctx.fillStyle = `hsla(${p.hue} 90% 70% / ${k})`;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size * (0.6 + Math.sin(p.life * 12) * 0.3 + 0.4), 0, Math.PI * 2);
          ctx.fill();
          break;
        }
        case 'bubble': {
          ctx.strokeStyle = `hsla(${p.hue} 80% 65% / ${k * 0.8})`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(p.x, p.y - p.life * 18, p.size, 0, Math.PI * 2);
          ctx.stroke();
          break;
        }
        case 'ripple': {
          ctx.strokeStyle = `hsla(${p.hue} 70% 75% / ${k * 0.7})`;
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.ellipse(p.x, p.y, p.life * 46 + 3, (p.life * 46 + 3) * 0.5, 0, 0, Math.PI * 2);
          ctx.stroke();
          break;
        }
        case 'shockwave': {
          ctx.strokeStyle = `hsla(${p.hue} 90% 65% / ${k * 0.8})`;
          ctx.lineWidth = 3 * k;
          ctx.beginPath();
          ctx.ellipse(p.x, p.y, p.life * 130 + 4, (p.life * 130 + 4) * 0.6, 0, 0, Math.PI * 2);
          ctx.stroke();
          break;
        }
        case 'petal': {
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
      ctx.font = `700 ${f.size}px 'Segoe UI', system-ui, sans-serif`;
      ctx.fillStyle = f.color;
      ctx.globalAlpha = k;
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

/* ============================================================================
 * Species vector art — every animal is pure canvas path geometry.
 * Each drawing is centred at (0,0), scaled by s (~half tile width), facing +x.
 * ========================================================================== */

export function drawSpecies(
  ctx: CanvasRenderingContext2D, species: SpeciesId, s: number, t: number, u?: UnitState,
): void {
  const walk = Math.sin(t * 8) * (u?.action === 'move' ? 1 : 0.3);
  switch (species) {
    case 'trex': {
      // Tail
      ctx.fillStyle = 'hsl(12 45% 34%)';
      ctx.beginPath();
      ctx.moveTo(-s * 0.5, -s * 0.25);
      ctx.quadraticCurveTo(-s * 1.25, -s * 0.32 + walk * 2, -s * 1.35, -s * 0.02);
      ctx.quadraticCurveTo(-s * 1.0, -s * 0.02, -s * 0.45, s * 0.1);
      ctx.closePath();
      ctx.fill();
      // Legs
      ctx.fillStyle = 'hsl(12 42% 28%)';
      ctx.beginPath();
      ctx.roundRect(-s * 0.34 + walk * 2.4, -s * 0.1, s * 0.26, s * 0.55, 3);
      ctx.roundRect(s * 0.02 - walk * 2.4, -s * 0.1, s * 0.26, s * 0.55, 3);
      ctx.fill();
      // Body
      const bg = ctx.createLinearGradient(0, -s, 0, s * 0.4);
      bg.addColorStop(0, 'hsl(14 55% 44%)');
      bg.addColorStop(1, 'hsl(10 45% 30%)');
      ctx.fillStyle = bg;
      ctx.beginPath();
      ctx.ellipse(-s * 0.1, -s * 0.32, s * 0.62, s * 0.42, -0.18, 0, Math.PI * 2);
      ctx.fill();
      // Head + jaw
      ctx.beginPath();
      ctx.ellipse(s * 0.52, -s * 0.66, s * 0.4, s * 0.28, 0.1, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'hsl(8 50% 24%)';
      ctx.beginPath();
      ctx.moveTo(s * 0.36, -s * 0.56);
      ctx.lineTo(s * 0.92, -s * 0.5 + Math.abs(walk) * 2);
      ctx.lineTo(s * 0.4, -s * 0.42);
      ctx.closePath();
      ctx.fill();
      // Teeth + eye
      ctx.fillStyle = '#f4ead8';
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.moveTo(s * (0.5 + i * 0.13), -s * 0.55);
        ctx.lineTo(s * (0.54 + i * 0.13), -s * 0.46);
        ctx.lineTo(s * (0.58 + i * 0.13), -s * 0.55);
        ctx.closePath();
        ctx.fill();
      }
      ctx.fillStyle = 'hsl(50 100% 60%)';
      ctx.beginPath();
      ctx.arc(s * 0.55, -s * 0.72, s * 0.05, 0, Math.PI * 2);
      ctx.fill();
      // Back plates
      ctx.fillStyle = 'hsl(6 60% 25%)';
      for (let i = 0; i < 4; i++) {
        ctx.beginPath();
        ctx.moveTo(-s * 0.55 + i * s * 0.26, -s * 0.62);
        ctx.lineTo(-s * 0.45 + i * s * 0.26, -s * 0.86);
        ctx.lineTo(-s * 0.34 + i * s * 0.26, -s * 0.62);
        ctx.closePath();
        ctx.fill();
      }
      break;
    }
    case 'lion': {
      // Tail
      ctx.strokeStyle = 'hsl(36 60% 45%)';
      ctx.lineWidth = s * 0.09;
      ctx.beginPath();
      ctx.moveTo(-s * 0.55, -s * 0.3);
      ctx.quadraticCurveTo(-s * 0.95, -s * 0.5 + walk * 2, -s * 0.85, -s * 0.75);
      ctx.stroke();
      // Legs
      ctx.fillStyle = 'hsl(36 55% 42%)';
      ctx.beginPath();
      ctx.roundRect(-s * 0.4 + walk * 2, -s * 0.05, s * 0.17, s * 0.42, 3);
      ctx.roundRect(s * 0.12 - walk * 2, -s * 0.05, s * 0.17, s * 0.42, 3);
      ctx.fill();
      // Body
      const bg = ctx.createLinearGradient(0, -s * 0.7, 0, s * 0.2);
      bg.addColorStop(0, 'hsl(40 70% 56%)');
      bg.addColorStop(1, 'hsl(33 60% 42%)');
      ctx.fillStyle = bg;
      ctx.beginPath();
      ctx.ellipse(-s * 0.05, -s * 0.3, s * 0.52, s * 0.3, 0, 0, Math.PI * 2);
      ctx.fill();
      // Mane — radial gradient sunburst
      const mg = ctx.createRadialGradient(s * 0.42, -s * 0.52, s * 0.05, s * 0.42, -s * 0.52, s * 0.42);
      mg.addColorStop(0, 'hsl(28 80% 48%)');
      mg.addColorStop(1, 'hsl(14 75% 30%)');
      ctx.fillStyle = mg;
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2 + t * 0.4;
        ctx.beginPath();
        ctx.ellipse(s * 0.42 + Math.cos(a) * s * 0.16, -s * 0.52 + Math.sin(a) * s * 0.16, s * 0.2, s * 0.12, a, 0, Math.PI * 2);
        ctx.fill();
      }
      // Face
      ctx.fillStyle = 'hsl(40 70% 58%)';
      ctx.beginPath();
      ctx.arc(s * 0.42, -s * 0.52, s * 0.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#2a1608';
      ctx.beginPath();
      ctx.arc(s * 0.49, -s * 0.56, s * 0.035, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'hsl(20 50% 32%)';
      ctx.beginPath();
      ctx.ellipse(s * 0.58, -s * 0.47, s * 0.05, s * 0.035, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'eagle': {
      const flap = Math.sin(t * 10) * 0.7;
      // Wings
      const wg = ctx.createLinearGradient(0, -s, 0, 0);
      wg.addColorStop(0, 'hsl(24 55% 40%)');
      wg.addColorStop(1, 'hsl(18 45% 26%)');
      ctx.fillStyle = wg;
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(0, -s * 0.35);
        ctx.quadraticCurveTo(side * s * 0.5, -s * 0.75 - flap * s * 0.4 * side * side, side * s * 1.0, -s * 0.45 - flap * s * 0.5);
        ctx.quadraticCurveTo(side * s * 0.55, -s * 0.25, 0, -s * 0.18);
        ctx.closePath();
        ctx.fill();
      }
      // Body
      ctx.fillStyle = 'hsl(20 40% 28%)';
      ctx.beginPath();
      ctx.ellipse(0, -s * 0.3, s * 0.24, s * 0.38, 0.15, 0, Math.PI * 2);
      ctx.fill();
      // White head
      ctx.fillStyle = '#efe8da';
      ctx.beginPath();
      ctx.arc(s * 0.16, -s * 0.62, s * 0.15, 0, Math.PI * 2);
      ctx.fill();
      // Beak
      ctx.fillStyle = 'hsl(42 90% 55%)';
      ctx.beginPath();
      ctx.moveTo(s * 0.28, -s * 0.64);
      ctx.lineTo(s * 0.42, -s * 0.58);
      ctx.lineTo(s * 0.27, -s * 0.54);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#000';
      ctx.beginPath();
      ctx.arc(s * 0.2, -s * 0.64, s * 0.03, 0, Math.PI * 2);
      ctx.fill();
      // Tail feathers
      ctx.fillStyle = '#efe8da';
      ctx.beginPath();
      ctx.moveTo(-s * 0.18, -s * 0.1);
      ctx.lineTo(-s * 0.48, s * 0.08);
      ctx.lineTo(-s * 0.1, -0.0);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'honeybadger': {
      // Low, long body
      const bg = ctx.createLinearGradient(0, -s * 0.6, 0, s * 0.1);
      bg.addColorStop(0, 'hsl(0 0% 82%)');
      bg.addColorStop(0.45, 'hsl(0 0% 75%)');
      bg.addColorStop(0.5, 'hsl(0 0% 22%)');
      bg.addColorStop(1, 'hsl(0 0% 14%)');
      ctx.fillStyle = 'hsl(0 0% 16%)';
      ctx.beginPath();
      ctx.roundRect(-s * 0.42 + walk * 1.6, -s * 0.02, s * 0.16, s * 0.3, 2);
      ctx.roundRect(s * 0.16 - walk * 1.6, -s * 0.02, s * 0.16, s * 0.3, 2);
      ctx.fill();
      ctx.fillStyle = bg;
      ctx.beginPath();
      ctx.ellipse(-s * 0.02, -s * 0.26, s * 0.55, s * 0.27, 0, 0, Math.PI * 2);
      ctx.fill();
      // Head
      ctx.fillStyle = 'hsl(0 0% 20%)';
      ctx.beginPath();
      ctx.ellipse(s * 0.5, -s * 0.32, s * 0.22, s * 0.17, 0.15, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'hsl(0 0% 84%)';
      ctx.beginPath();
      ctx.ellipse(s * 0.46, -s * 0.42, s * 0.2, s * 0.08, 0.15, 0, Math.PI);
      ctx.fill();
      // Eye + claws
      const rage = u && u.buffs.berserk;
      ctx.fillStyle = rage ? 'hsl(0 100% 55%)' : '#fff';
      ctx.beginPath();
      ctx.arc(s * 0.55, -s * 0.35, s * 0.035, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#ddd';
      ctx.lineWidth = 1.2;
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.moveTo(s * (0.24 + i * 0.05) - walk * 1.6, s * 0.28);
        ctx.lineTo(s * (0.28 + i * 0.05) - walk * 1.6, s * 0.36);
        ctx.stroke();
      }
      break;
    }
    case 'scorpion': {
      ctx.fillStyle = 'hsl(285 30% 30%)';
      // Legs
      ctx.strokeStyle = 'hsl(285 30% 26%)';
      ctx.lineWidth = s * 0.05;
      for (let i = 0; i < 3; i++) {
        for (const side of [-1, 1]) {
          const lx = -s * 0.2 + i * s * 0.2;
          ctx.beginPath();
          ctx.moveTo(lx, -s * 0.15);
          ctx.lineTo(lx + side * s * 0.18, s * 0.02 + Math.sin(t * 9 + i) * 1.5);
          ctx.lineTo(lx + side * s * 0.26, s * 0.14);
          ctx.stroke();
        }
      }
      // Segmented body
      const sg = ctx.createLinearGradient(0, -s * 0.4, 0, 0);
      sg.addColorStop(0, 'hsl(288 38% 42%)');
      sg.addColorStop(1, 'hsl(282 34% 26%)');
      ctx.fillStyle = sg;
      ctx.beginPath();
      ctx.ellipse(0, -s * 0.18, s * 0.42, s * 0.2, 0, 0, Math.PI * 2);
      ctx.fill();
      // Claws
      ctx.beginPath();
      ctx.ellipse(s * 0.5, -s * 0.28, s * 0.15, s * 0.1, 0.5, 0, Math.PI * 2);
      ctx.ellipse(s * 0.5, -s * 0.05, s * 0.15, s * 0.1, -0.5, 0, Math.PI * 2);
      ctx.fill();
      // Tail arcs over the back to a glowing stinger
      ctx.strokeStyle = 'hsl(286 36% 36%)';
      ctx.lineWidth = s * 0.11;
      ctx.beginPath();
      const curl = Math.sin(t * 3) * 0.06;
      ctx.moveTo(-s * 0.35, -s * 0.2);
      ctx.quadraticCurveTo(-s * 0.75, -s * (0.75 + curl), -s * 0.3, -s * (0.85 + curl));
      ctx.stroke();
      ctx.fillStyle = 'hsl(320 90% 60%)';
      ctx.beginPath();
      ctx.arc(-s * 0.28, -s * (0.86 + curl), s * 0.08, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'fireants': {
      // A single ant (the swarm is three units).
      const ag = ctx.createLinearGradient(0, -s * 0.5, 0, 0);
      ag.addColorStop(0, 'hsl(16 90% 52%)');
      ag.addColorStop(1, 'hsl(4 80% 36%)');
      ctx.fillStyle = ag;
      // Abdomen, thorax, head
      ctx.beginPath();
      ctx.ellipse(-s * 0.3, -s * 0.2, s * 0.24, s * 0.17, 0, 0, Math.PI * 2);
      ctx.ellipse(0, -s * 0.24, s * 0.14, s * 0.11, 0, 0, Math.PI * 2);
      ctx.ellipse(s * 0.22, -s * 0.26, s * 0.13, s * 0.11, 0, 0, Math.PI * 2);
      ctx.fill();
      // Glow abdomen tip
      ctx.fillStyle = `hsla(30 100% 60% / ${0.6 + Math.sin(t * 6) * 0.3})`;
      ctx.beginPath();
      ctx.arc(-s * 0.42, -s * 0.2, s * 0.08, 0, Math.PI * 2);
      ctx.fill();
      // Legs
      ctx.strokeStyle = 'hsl(6 70% 30%)';
      ctx.lineWidth = 1.4;
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.moveTo(-s * 0.1 + i * s * 0.12, -s * 0.15);
        ctx.lineTo(-s * 0.16 + i * s * 0.12 + walk * 2, s * 0.05);
        ctx.stroke();
      }
      // Mandibles
      ctx.strokeStyle = 'hsl(16 90% 55%)';
      ctx.beginPath();
      ctx.moveTo(s * 0.32, -s * 0.3);
      ctx.quadraticCurveTo(s * 0.44, -s * 0.28, s * 0.4, -s * 0.2);
      ctx.stroke();
      break;
    }
    case 'bear': {
      // Legs
      ctx.fillStyle = 'hsl(25 40% 22%)';
      ctx.beginPath();
      ctx.roundRect(-s * 0.42 + walk * 2, -s * 0.02, s * 0.24, s * 0.5, 4);
      ctx.roundRect(s * 0.1 - walk * 2, -s * 0.02, s * 0.24, s * 0.5, 4);
      ctx.fill();
      // Massive body
      const bg = ctx.createLinearGradient(0, -s * 0.95, 0, s * 0.3);
      bg.addColorStop(0, 'hsl(28 45% 38%)');
      bg.addColorStop(1, 'hsl(22 40% 24%)');
      ctx.fillStyle = bg;
      ctx.beginPath();
      ctx.ellipse(-s * 0.05, -s * 0.42, s * 0.6, s * 0.5, -0.1, 0, Math.PI * 2);
      ctx.fill();
      // Head + ears + snout
      ctx.beginPath();
      ctx.arc(s * 0.45, -s * 0.72, s * 0.26, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(s * 0.3, -s * 0.94, s * 0.09, 0, Math.PI * 2);
      ctx.arc(s * 0.58, -s * 0.94, s * 0.09, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'hsl(30 45% 52%)';
      ctx.beginPath();
      ctx.ellipse(s * 0.62, -s * 0.66, s * 0.13, s * 0.09, 0.1, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#1c0f06';
      ctx.beginPath();
      ctx.arc(s * 0.68, -s * 0.68, s * 0.04, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(s * 0.48, -s * 0.76, s * 0.035, 0, Math.PI * 2);
      ctx.fill();
      // Claw swipe arcs
      ctx.strokeStyle = 'hsl(40 30% 75%)';
      ctx.lineWidth = 1.6;
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.moveTo(s * (0.16 + i * 0.06) - walk * 2, s * 0.42);
        ctx.lineTo(s * (0.2 + i * 0.06) - walk * 2, s * 0.5);
        ctx.stroke();
      }
      break;
    }
    case 'bighorn': {
      // Legs
      ctx.fillStyle = 'hsl(35 25% 40%)';
      ctx.beginPath();
      ctx.roundRect(-s * 0.34 + walk * 2.4, -s * 0.05, s * 0.14, s * 0.42, 2);
      ctx.roundRect(s * 0.18 - walk * 2.4, -s * 0.05, s * 0.14, s * 0.42, 2);
      ctx.fill();
      // Body
      const bg = ctx.createLinearGradient(0, -s * 0.7, 0, s * 0.15);
      bg.addColorStop(0, 'hsl(38 30% 58%)');
      bg.addColorStop(1, 'hsl(32 26% 42%)');
      ctx.fillStyle = bg;
      ctx.beginPath();
      ctx.ellipse(-s * 0.02, -s * 0.34, s * 0.5, s * 0.3, 0, 0, Math.PI * 2);
      ctx.fill();
      // Head
      ctx.fillStyle = 'hsl(35 28% 50%)';
      ctx.beginPath();
      ctx.ellipse(s * 0.42, -s * 0.5, s * 0.2, s * 0.16, 0.35, 0, Math.PI * 2);
      ctx.fill();
      // Curled horns — the signature
      ctx.strokeStyle = 'hsl(38 45% 68%)';
      ctx.lineWidth = s * 0.1;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(s * 0.36, -s * 0.62, s * 0.17, -0.5, Math.PI * 1.35);
      ctx.stroke();
      ctx.lineWidth = s * 0.07;
      ctx.beginPath();
      ctx.arc(s * 0.36, -s * 0.62, s * 0.09, 0.4, Math.PI * 1.7);
      ctx.stroke();
      ctx.lineCap = 'butt';
      ctx.fillStyle = '#221507';
      ctx.beginPath();
      ctx.arc(s * 0.5, -s * 0.52, s * 0.03, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'bees': {
      // A cloud of buzzing bees.
      for (let i = 0; i < 7; i++) {
        const a = t * (3 + (i % 3)) + i * 0.9;
        const bx = Math.cos(a) * s * (0.3 + (i % 3) * 0.14);
        const by = -s * 0.4 + Math.sin(a * 1.4) * s * 0.3;
        // Wings
        ctx.fillStyle = `rgba(220,240,255,${0.5 + Math.sin(t * 30 + i) * 0.3})`;
        ctx.beginPath();
        ctx.ellipse(bx - 1, by - 3, 3, 1.6, Math.sin(t * 30 + i), 0, Math.PI * 2);
        ctx.fill();
        // Body with stripes
        ctx.fillStyle = 'hsl(48 95% 55%)';
        ctx.beginPath();
        ctx.ellipse(bx, by, 3.6, 2.4, 0.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#1a1206';
        ctx.fillRect(bx - 1.2, by - 2.2, 1.1, 4.4);
      }
      break;
    }
    case 'wolves': {
      // Sleek body
      ctx.fillStyle = 'hsl(215 12% 38%)';
      ctx.beginPath();
      ctx.roundRect(-s * 0.36 + walk * 2, -s * 0.02, s * 0.13, s * 0.36, 2);
      ctx.roundRect(s * 0.2 - walk * 2, -s * 0.02, s * 0.13, s * 0.36, 2);
      ctx.fill();
      const bg = ctx.createLinearGradient(0, -s * 0.6, 0, s * 0.1);
      bg.addColorStop(0, 'hsl(214 15% 55%)');
      bg.addColorStop(1, 'hsl(216 14% 36%)');
      ctx.fillStyle = bg;
      ctx.beginPath();
      ctx.ellipse(-s * 0.02, -s * 0.28, s * 0.46, s * 0.24, -0.05, 0, Math.PI * 2);
      ctx.fill();
      // Bushy tail
      ctx.beginPath();
      ctx.ellipse(-s * 0.5, -s * 0.4 + walk, s * 0.22, s * 0.1, -0.6, 0, Math.PI * 2);
      ctx.fill();
      // Head with pointed ears
      ctx.beginPath();
      ctx.ellipse(s * 0.42, -s * 0.44, s * 0.18, s * 0.14, 0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(s * 0.3, -s * 0.54);
      ctx.lineTo(s * 0.32, -s * 0.74);
      ctx.lineTo(s * 0.42, -s * 0.58);
      ctx.closePath();
      ctx.fill();
      // Muzzle + eye
      ctx.fillStyle = 'hsl(214 12% 70%)';
      ctx.beginPath();
      ctx.moveTo(s * 0.52, -s * 0.46);
      ctx.lineTo(s * 0.68, -s * 0.4);
      ctx.lineTo(s * 0.52, -s * 0.36);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'hsl(190 100% 65%)';
      ctx.beginPath();
      ctx.arc(s * 0.46, -s * 0.47, s * 0.03, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'porcupine': {
      // Quills — radiating strokes with gradient tips
      for (let i = 0; i < 15; i++) {
        const a = Math.PI * (0.95 + (i / 15) * 1.15) + Math.sin(t * 2 + i) * 0.03;
        const qLen = s * (0.55 + (i % 3) * 0.12);
        ctx.strokeStyle = i % 2 ? 'hsl(35 25% 68%)' : 'hsl(20 20% 30%)';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(-s * 0.05, -s * 0.3);
        ctx.lineTo(-s * 0.05 + Math.cos(a) * qLen, -s * 0.3 - Math.abs(Math.sin(a)) * qLen);
        ctx.stroke();
      }
      // Body
      const bg = ctx.createLinearGradient(0, -s * 0.5, 0, s * 0.1);
      bg.addColorStop(0, 'hsl(25 30% 34%)');
      bg.addColorStop(1, 'hsl(20 26% 22%)');
      ctx.fillStyle = bg;
      ctx.beginPath();
      ctx.ellipse(0, -s * 0.24, s * 0.42, s * 0.26, 0, 0, Math.PI * 2);
      ctx.fill();
      // Face
      ctx.fillStyle = 'hsl(28 32% 44%)';
      ctx.beginPath();
      ctx.ellipse(s * 0.4, -s * 0.22, s * 0.15, s * 0.11, 0.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#160c04';
      ctx.beginPath();
      ctx.arc(s * 0.5, -s * 0.24, s * 0.035, 0, Math.PI * 2);
      ctx.fill();
      // Little feet
      ctx.fillStyle = 'hsl(20 26% 18%)';
      ctx.beginPath();
      ctx.roundRect(-s * 0.24 + walk, -s * 0.02, s * 0.12, s * 0.14, 2);
      ctx.roundRect(s * 0.1 - walk, -s * 0.02, s * 0.12, s * 0.14, 2);
      ctx.fill();
      break;
    }
    case 'beetles': {
      // Shell with iridescent gradient
      const bg = ctx.createLinearGradient(-s * 0.4, -s * 0.6, s * 0.4, 0);
      bg.addColorStop(0, 'hsl(150 45% 30%)');
      bg.addColorStop(0.5, 'hsl(170 55% 38%)');
      bg.addColorStop(1, 'hsl(130 45% 26%)');
      ctx.fillStyle = bg;
      ctx.beginPath();
      ctx.ellipse(-s * 0.05, -s * 0.26, s * 0.42, s * 0.3, 0, 0, Math.PI * 2);
      ctx.fill();
      // Wing split line
      ctx.strokeStyle = 'rgba(0,0,0,0.4)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(-s * 0.4, -s * 0.26);
      ctx.lineTo(s * 0.3, -s * 0.26);
      ctx.stroke();
      // Head
      ctx.fillStyle = 'hsl(140 35% 22%)';
      ctx.beginPath();
      ctx.arc(s * 0.4, -s * 0.28, s * 0.13, 0, Math.PI * 2);
      ctx.fill();
      // Abdomen cannon aims up-forward
      ctx.save();
      ctx.translate(-s * 0.36, -s * 0.34);
      ctx.rotate(-0.8 + Math.sin(t * 2.4) * 0.06);
      ctx.fillStyle = 'hsl(80 45% 35%)';
      ctx.beginPath();
      ctx.roundRect(-s * 0.06, -s * 0.34, s * 0.12, s * 0.34, 3);
      ctx.fill();
      ctx.fillStyle = `hsla(70 90% 60% / ${0.5 + Math.sin(t * 5) * 0.3})`;
      ctx.beginPath();
      ctx.arc(0, -s * 0.36, s * 0.06, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      // Legs
      ctx.strokeStyle = 'hsl(140 30% 20%)';
      ctx.lineWidth = 1.4;
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.moveTo(-s * 0.15 + i * s * 0.15, -s * 0.1);
        ctx.lineTo(-s * 0.2 + i * s * 0.15 + walk * 1.5, s * 0.08);
        ctx.stroke();
      }
      // Eye
      ctx.fillStyle = 'hsl(60 100% 70%)';
      ctx.beginPath();
      ctx.arc(s * 0.45, -s * 0.31, s * 0.03, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
  }
}
