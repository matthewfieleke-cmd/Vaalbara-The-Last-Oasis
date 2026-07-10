import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  LAVA_RAIN_CARD, MAX_ARMY, PHASE1_TICKS, PHASE2_TICKS, PHASE_SPELL_CARD, TICK_MS, WORLD_H, WORLD_W,
  fortPads, inDeployBand,
} from '../types';
import type { CardId, GameEvent, GameState, PlayerId } from '../types';
import { cardDef } from '../data';
import { BotBrain, TickDriver } from '../engine';
import { Renderer } from '../render';
import { handleGameEvents, music, playUi } from '../audio';
import type { MatchSession } from '../net';
import { SpriteArt } from './SpriteArt';

interface Banner {
  id: number;
  title: string;
  body: string;
  color: string;
}

export function GameScreen({
  session,
  onEnd,
}: {
  session: MatchSession;
  onEnd: (winner: PlayerId | 'tie', finalState: GameState) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<Renderer | null>(null);
  const driverRef = useRef<TickDriver | null>(null);
  const botRef = useRef<BotBrain | null>(null);
  const seat = session.localSeat;

  const [ui, setUi] = useState<GameState | null>(null);
  const [selectedCard, setSelectedCard] = useState<CardId | null>(null);
  const [banner, setBanner] = useState<Banner | null>(null);
  const [toast, setToast] = useState<{ id: number; text: string } | null>(null);
  const selectedRef = useRef<CardId | null>(null);
  selectedRef.current = selectedCard;
  const endedRef = useRef(false);

  const showToast = useCallback((text: string) => {
    setToast({ id: Date.now(), text });
  }, []);

  /* ------------------------- engine + renderer wiring ------------------- */

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    const renderer = new Renderer(canvas);
    renderer.localSeat = seat;
    rendererRef.current = renderer;

    const fit = () => {
      const r = wrap.getBoundingClientRect();
      renderer.resize(r.width, r.height);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(wrap);
    renderer.start();

    const bot = session.mode === 'local' ? new BotBrain(1, session.seed) : null;
    botRef.current = bot;

    // Debug/playtest overrides (?p1ticks=20&p2ticks=15) shorten the phases.
    // Only honoured offline so online clients always share identical rules.
    const params = new URLSearchParams(window.location.search);
    const p1 = Number(params.get('p1ticks'));
    const p2 = Number(params.get('p2ticks'));
    const cfg = session.mode === 'local' && (p1 > 0 || p2 > 0)
      ? { phase1Ticks: p1 > 0 ? p1 : PHASE1_TICKS, phase2Ticks: p2 > 0 ? p2 : PHASE2_TICKS }
      : undefined;

    const driver = new TickDriver(session.seed, session.factions, {
      onTick: ({ state, events }) => {
        renderer.onTick(state, events);
        // Read-only snapshot for playtest/capture tooling (canvas UI has no
        // DOM to query, so scripts watch the sim through this hook).
        (window as unknown as { __vbState?: typeof state }).__vbState = state;
        handleGameEvents(events);
        routeEvents(events, state);
        // Battle density feeds the adaptive score.
        music.setIntensity(Math.min(1, state.units.length / 14));
        music.setMode(state.phase);
        setUi({ ...state });
        // Local bot thinks after seeing the tick, like a remote player would.
        if (bot && state.phase !== 'ended') {
          const action = bot.think(state);
          if (action) driver.submit(1, action);
        }
      },
      sendInput: (input) => session.sendInput(input),
    }, cfg);
    driverRef.current = driver;

    session.onRemoteInput((input) => driver.receiveRemote(input));
    session.onOpponentLeft(() => {
      if (!endedRef.current) {
        endedRef.current = true;
        showToast('Opponent left the battlefield');
        setTimeout(() => onEnd(seat, driver.state), 1400);
      }
    });

    const routeEvents = (events: GameEvent[], state: GameState) => {
      for (const e of events) {
        if (e.type === 'phaseChange' && e.phase === 'transition') {
          setBanner({
            id: Date.now(),
            title: 'The March to the Oasis',
            body: 'Survivors carry their scars onward…',
            color: '#7dffce',
          });
        } else if (e.type === 'phaseChange' && e.phase === 'oasis') {
          setBanner({
            id: Date.now(),
            title: 'Phase II — Hold the Pond',
            body: 'Keep more fighters in the water — fill the bar to claim it.',
            color: '#4fd8ff',
          });
        } else if (e.type === 'obeliskDown') {
          const razed = state.obelisks
            .filter((o) => o.owner === e.owner)
            .every((o) => o.hp <= 0);
          setBanner({
            id: Date.now(),
            title: e.owner === seat
              ? (razed ? 'Your Fortress Falls!' : 'Your Gatehouse Crumbles!')
              : (razed ? 'Enemy Fortress Razed!' : 'Enemy Gatehouse Crumbles!'),
            body: e.owner === seat
              ? (razed ? 'The enemy takes the Basalt Fields…' : 'Hold the last gatehouse at all costs!')
              : (razed ? 'The Basalt Fields are yours — march on the Oasis!' : 'One gatehouse down — bring down the other!'),
            color: e.owner === seat ? '#ff7d6d' : '#ffc94d',
          });
        } else if (e.type === 'pondClaimed') {
          setBanner({
            id: Date.now(),
            title: e.player === seat ? 'The Pond Is Yours!' : 'The Pond Is Lost',
            body: e.player === seat ? 'Total control of the last water on Earth.' : 'The enemy claims the last water…',
            color: e.player === seat ? '#7dffce' : '#ff7d6d',
          });
        } else if (e.type === 'blessing') {
          setBanner({
            id: Date.now(),
            title: e.player === seat ? 'Vaalbara Blessing!' : 'Enemy Blessed',
            body: e.player === seat ? 'Your dominance grants +10% speed & damage.' : 'Their dominance grants them +10% power.',
            color: '#ffc94d',
          });
        } else if (e.type === 'gameOver' && !endedRef.current) {
          endedRef.current = true;
          setTimeout(() => onEnd(e.winner, state), 2200);
        }
      }
    };

    music.start();
    music.setMode('basalt');
    driver.start();
    setBanner({
      id: Date.now(),
      title: 'Phase I — Raze Their Fortress',
      body: 'Tap a gate to deploy. Bring down both enemy gatehouses.',
      color: '#ffab7a',
    });

    return () => {
      driver.stop();
      renderer.stop();
      ro.disconnect();
      music.stop();
      session.leave();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  /* ------------------------------ input ---------------------------------- */

  const dragRef = useRef<{ pointerId: number; fromX: number; fromY: number } | null>(null);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    const renderer = rendererRef.current;
    const driver = driverRef.current;
    if (!renderer || !driver) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const t = renderer.screenToWorld(px, py);
    // Forgiving one-handed input: touches just outside the world clamp to the
    // nearest point (thumbs often land below the baseline). Far away = ignore.
    if (t.x < -1.6 || t.x > WORLD_W + 1.6 || t.y < -1.6 || t.y > WORLD_H + 1.6) return;
    const gx = Math.max(0.25, Math.min(WORLD_W - 0.25, t.x));
    const gy = Math.max(0.25, Math.min(WORLD_H - 0.25, t.y));
    const st = driver.state;
    if (st.phase !== 'basalt' && st.phase !== 'oasis') return;

    const card = selectedRef.current;
    if (!card) return;
    const def = cardDef(card, st.phase);

    if (def.kind === 'spell') {
      driver.submit(seat, { type: 'spell', card, x: gx, y: gy });
      setSelectedCard(null);
      renderer.telegraph.active = false;
      playUi('tap');
      return;
    }

    if (st.units.filter((u) => u.owner === seat && u.hp > 0).length >= MAX_ARMY) {
      showToast('Army at full strength — lose a fighter first');
      playUi('error');
      return;
    }

    // Phase 1: tap one of your two GATES — the warrior spawns in the arch
    // and marches out through it, over that lane's bridge.
    if (st.phase === 'basalt') {
      const pads = fortPads(seat);
      const pad = pads.reduce((best, cur) =>
        Math.hypot(cur.x - gx, cur.y - gy) < Math.hypot(best.x - gx, best.y - gy) ? cur : best);
      if (Math.hypot(pad.x - gx, pad.y - gy) > 2.6) {
        showToast('Tap one of your gates to deploy');
        playUi('error');
        return;
      }
      driver.submit(seat, { type: 'deploy', card, x: pad.x, y: pad.y, dirX: 0, dirY: seat === 0 ? -1 : 1 });
      setSelectedCard(null);
      playUi('tap');
      return;
    }

    // Oasis: free vector deploy — touch must begin inside the local band.
    if (!inDeployBand(seat, gy)) {
      showToast('Deploy from your baseline — drag to aim the charge');
      playUi('error');
      return;
    }
    dragRef.current = { pointerId: e.pointerId, fromX: gx, fromY: gy };
    renderer.drag = {
      active: true, fromX: gx, fromY: gy, toX: t.x, toY: t.y, valid: true, hue: def.hue,
    };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    playUi('drag');
  }, [seat, showToast]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const renderer = rendererRef.current;
    const drag = dragRef.current;
    const card = selectedRef.current;
    if (renderer && card === LAVA_RAIN_CARD) {
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const t = renderer.screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
      if (t.x >= -1.6 && t.x <= WORLD_W + 1.6 && t.y >= -1.6 && t.y <= WORLD_H + 1.6) {
        renderer.telegraph.active = true;
        renderer.telegraph.kind = 'lavarain';
        renderer.telegraph.x = Math.max(0.25, Math.min(WORLD_W - 0.25, t.x));
        renderer.telegraph.y = Math.max(0.25, Math.min(WORLD_H - 0.25, t.y));
      }
    }
    if (!renderer || !drag || drag.pointerId !== e.pointerId) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const t = renderer.screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
    renderer.drag.toX = t.x;
    renderer.drag.toY = t.y;
  }, []);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    const renderer = rendererRef.current;
    const driver = driverRef.current;
    const drag = dragRef.current;
    if (!renderer || !driver || !drag || drag.pointerId !== e.pointerId) return;
    dragRef.current = null;
    renderer.drag.active = false;
    const card = selectedRef.current;
    if (!card) return;

    const dirX = renderer.drag.toX - drag.fromX;
    const dirY = renderer.drag.toY - drag.fromY;
    const len = Math.hypot(dirX, dirY);
    // A bare tap launches straight ahead; a drag flings along the vector.
    const fx = len < 0.35 ? 0 : dirX;
    const fy = len < 0.35 ? (seat === 0 ? -1 : 1) : dirY;

    driver.submit(seat, { type: 'deploy', card, x: drag.fromX, y: drag.fromY, dirX: fx, dirY: fy });
    setSelectedCard(null);
    playUi('tap');
  }, [seat]);

  /* -------------------------------- HUD ---------------------------------- */

  const me = ui?.players[seat];
  const phase = ui?.phase ?? 'basalt';
  const secondsLeft = Math.max(0, Math.round((ui?.phaseTicksLeft ?? 0) * (TICK_MS / 1000)));
  // The siege has no fixed end (it runs until a fortress falls), so Phase 1
  // shows battle time ELAPSED; the Oasis keeps its hard countdown.
  const basaltElapsed = ui?.phase === 'basalt'
    ? Math.max(0, Math.round(((ui.cfg?.phase1Ticks ?? PHASE1_TICKS) - ui.phaseTicksLeft) * (TICK_MS / 1000)))
    : 0;
  const clockSecs = ui?.phase === 'basalt' ? basaltElapsed : secondsLeft;
  const mm = Math.floor(clockSecs / 60);
  const ss = String(clockSecs % 60).padStart(2, '0');

  // Phase 1 objective: each fortress's combined gatehouse health (both
  // wings), from the local seat's view. The per-wing bars live on the field.
  const obelisks = useMemo(() => {
    if (!ui || ui.obelisks.length === 0) return null;
    const sum = (owner: PlayerId) => {
      const wings = ui.obelisks.filter((o) => o.owner === owner);
      const hp = wings.reduce((s, o) => s + Math.max(0, o.hp), 0);
      const max = wings.reduce((s, o) => s + o.maxHp, 0);
      return { hp, max };
    };
    const mine = sum(seat);
    const theirs = sum(seat === 0 ? 1 : 0);
    if (mine.max === 0 || theirs.max === 0) return null;
    return {
      mine: Math.max(0, mine.hp / mine.max),
      theirs: Math.max(0, theirs.hp / theirs.max),
      mineHp: Math.max(0, Math.round(mine.hp)),
      theirsHp: Math.max(0, Math.round(theirs.hp)),
    };
  }, [ui, seat]);

  // Phase 2 objective: capture percentage + which way it is ticking.
  const prevMeterRef = useRef(0);
  const capture = useMemo(() => {
    if (!ui || (ui.phase !== 'oasis' && ui.phase !== 'ended')) return null;
    const m = seat === 0 ? ui.captureMeter : -ui.captureMeter;
    const trend = m - prevMeterRef.current;
    prevMeterRef.current = m;
    return {
      pct: Math.abs(m),
      mineLeads: m > 0,
      gaining: trend > 0,
      losing: trend < 0,
      fill: 50 + m / 2,
    };
  }, [ui, seat]);

  // Pulse the gate pads while a unit card is armed in Phase 1.
  useEffect(() => {
    const r = rendererRef.current;
    if (!r) return;
    const def = selectedCard && ui ? cardDef(selectedCard, ui.phase) : null;
    r.padHint = ui?.phase === 'basalt' && def?.kind === 'unit';
  }, [selectedCard, ui]);

  const selectCard = (card: CardId) => {
    if (!me || !ui) return;
    const def = cardDef(card, ui.phase);
    if (me.aqua < def.cost) {
      playUi('error');
      showToast(`Need ${def.cost} aqua for ${def.name}`);
      return;
    }
    setSelectedCard((c) => {
      const next = c === card ? null : card;
      if (rendererRef.current) {
        // Telegraph only appears once the finger moves — never at (0,0) on select.
        rendererRef.current.telegraph.active = false;
        rendererRef.current.telegraph.kind = next === LAVA_RAIN_CARD ? 'lavarain' : 'spell';
      }
      if (next === LAVA_RAIN_CARD) showToast('Drag over the arena — sky falls where you release');
      return next;
    });
    playUi('tap');
  };

  return (
    <div className="game-screen">
      {/* The HUD lives IN FLOW above the canvas — it can never cover the
          arena, so the enemy towers and gate openings always stay clear. */}
      <div className="hud-top">
        <div className="hud-row">
          <span className={`phase-pill ${phase === 'oasis' || phase === 'ended' ? 'oasis' : 'basalt'}`}>
            {phase === 'basalt' ? 'I · Basalt Fields' : phase === 'transition' ? '⇧ The March' : 'II · The Oasis'}
          </span>
          <span className={`timer ${secondsLeft <= 30 && phase === 'oasis' ? 'urgent' : ''}`}>
            {mm}:{ss}
          </span>
        </div>
        {obelisks ? (
          /* Phase 1 scoreboard: the two towers' health, side by side. */
          <div className="objective-bars">
            <div className="obelisk-track mine-side">
              <span className="ob-label">YOURS</span>
              <div className="ob-bar">
                <div className="fill mine" style={{ width: `${obelisks.mine * 100}%` }} />
              </div>
              <span className="ob-hp">{obelisks.mineHp}</span>
            </div>
            <span className="ob-vs">⚔</span>
            <div className="obelisk-track their-side">
              <span className="ob-hp">{obelisks.theirsHp}</span>
              <div className="ob-bar">
                <div className="fill theirs" style={{ width: `${obelisks.theirs * 100}%` }} />
              </div>
              <span className="ob-label">ENEMY</span>
            </div>
          </div>
        ) : capture ? (
          /* Phase 2 scoreboard: pond claim percentage with live trend. */
          <div className="capture-wrap">
            <div className="meter-bar">
              <div className="mine" style={{ width: `${capture.fill}%` }} />
              <div className="theirs" style={{ width: `${100 - capture.fill}%` }} />
              <span className="capture-pct">
                {capture.pct > 0
                  ? `${capture.mineLeads ? 'YOU' : 'ENEMY'} ${capture.pct}%`
                  : 'CONTESTED'}
                {capture.gaining ? ' ▲' : capture.losing ? ' ▼' : ''}
              </span>
            </div>
          </div>
        ) : (
          <div className="meter-bar">
            <div className="mine" style={{ width: '50%' }} />
            <div className="theirs" style={{ width: '50%' }} />
          </div>
        )}
        <div className="objective-pill">
          {phase === 'basalt'
            ? '⛨ Raze both enemy gatehouses — defend your fortress'
            : phase === 'transition'
              ? 'The armies march to the last water…'
              : '❖ Hold the pond — 100% claims victory'}
        </div>
        {me?.blessed && <div className="blessing-tag">✦ Vaalbara Blessing ✦</div>}
      </div>

      <div
        className="game-canvas-wrap"
        ref={wrapRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <canvas ref={canvasRef} />
      </div>

      <div className="hand-dock">
        <div className="aqua-bar">
          <div className="aqua-cells">
            {Array.from({ length: 10 }, (_, i) => (
              <div key={i} className={`aqua-cell ${me && i < Math.floor(me.aqua) ? 'full' : ''}`} />
            ))}
          </div>
          <span className="aqua-count">{Math.floor(me?.aqua ?? 0)}</span>
          <span className="army-count">
            ⚑ {ui ? ui.units.filter((u) => u.owner === seat && u.hp > 0).length : 0}/{MAX_ARMY}
          </span>
        </div>
        <div className="hand">
          {(me?.hand ?? []).map((card, i) => {
            const def = ui ? cardDef(card, ui.phase) : null;
            if (!def) return <div key={i} className="card" />;
            const affordable = (me?.aqua ?? 0) >= def.cost;
            return (
              <button
                key={`${card}-${i}`}
                className={[
                  'card',
                  selectedCard === card ? 'selected' : '',
                  !affordable ? 'unaffordable' : '',
                  def.kind === 'spell' ? 'spell-card' : '',
                ].join(' ')}
                onClick={() => selectCard(card)}
              >
                <span className="cost">{def.cost}</span>
                <div className="art">
                  {def.species ? (
                    <SpriteArt species={def.species} hue={def.hue} />
                  ) : card === LAVA_RAIN_CARD ? (
                    <LavaRainArt hue={def.hue} />
                  ) : (
                    <SpellArt hue={def.hue} phase2={card === PHASE_SPELL_CARD && (ui?.phase === 'oasis' || ui?.phase === 'ended')} />
                  )}
                </div>
                <span className="name">{def.name}</span>
              </button>
            );
          })}
        </div>
      </div>

      {banner && (
        <div className="banner" key={banner.id} style={{ color: banner.color }}>
          <h2>{banner.title}</h2>
          <p>{banner.body}</p>
        </div>
      )}
      {toast && (
        <div className="toast" key={toast.id}>
          {toast.text}
        </div>
      )}
    </div>
  );
}

/** Procedural art for the Lava Rain spell card — volcanic desolation, brutal. */
function LavaRainArt({ hue }: { hue: number }) {
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
      // Ash-choked sky — near-black, no soft gradients.
      const sky = ctx.createLinearGradient(0, 0, 0, H);
      sky.addColorStop(0, `hsl(${hue - 12} 18% 4%)`);
      sky.addColorStop(0.55, `hsl(${hue - 6} 28% 7%)`);
      sky.addColorStop(1, `hsl(${hue} 35% 3%)`);
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, W, H);
      // Scorched basalt floor — jagged horizon, not a circle.
      ctx.fillStyle = `hsl(${hue - 18} 22% 8%)`;
      ctx.beginPath();
      ctx.moveTo(0, H * 0.72);
      for (let x = 0; x <= W; x += W / 8) {
        const jag = Math.sin(x * 0.04 + t * 0.3) * H * 0.012 + Math.sin(x * 0.11) * H * 0.006;
        ctx.lineTo(x, H * 0.68 + jag);
      }
      ctx.lineTo(W, H);
      ctx.lineTo(0, H);
      ctx.closePath();
      ctx.fill();
      // Distant caldera glare — thin, harsh, not a soft orb.
      const pulse = 0.45 + Math.sin(t * 1.8) * 0.18;
      ctx.fillStyle = `hsla(${hue + 8} 90% 42% / ${0.22 * pulse})`;
      ctx.fillRect(0, H * 0.62, W, H * 0.04);
      // Lava veins crawling across the ground.
      for (let v = 0; v < 4; v++) {
        const vy = H * (0.74 + v * 0.05);
        ctx.strokeStyle = `hsla(${hue + 14} 95% 48% / ${0.35 + pulse * 0.2})`;
        ctx.lineWidth = Math.max(1, W * 0.008);
        ctx.beginPath();
        let px = 0;
        ctx.moveTo(0, vy);
        while (px < W) {
          px += W * (0.06 + (v % 3) * 0.02);
          const py = vy + Math.sin(px * 0.02 + t * 1.2 + v) * H * 0.018;
          ctx.lineTo(px, py);
        }
        ctx.stroke();
      }
      // Falling debris — angular shards, not round embers.
      for (let i = 0; i < 9; i++) {
        const seed = i * 2.41;
        const fall = ((t * 0.75 + seed) % 1);
        const tx = W * (0.12 + (seed % 5) * 0.16);
        const ty = H * (0.06 + fall * 0.58);
        const len = W * (0.035 + (i % 3) * 0.012);
        const ang = 0.6 + seed * 0.3 + t * 0.4;
        ctx.strokeStyle = `hsla(${hue + 10} 85% 55% / ${0.75 * (1 - fall * 0.3)})`;
        ctx.lineWidth = Math.max(1.2, W * 0.01);
        ctx.lineCap = 'butt';
        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.lineTo(tx + Math.cos(ang) * len, ty + Math.sin(ang) * len * 1.6);
        ctx.stroke();
      }
      // Central impact column — vertical heat shimmer, not a pin or bubble.
      const shimmer = Math.sin(t * 4.2) * W * 0.006;
      const colX = W * 0.5 + shimmer;
      const colGrad = ctx.createLinearGradient(colX, H * 0.2, colX, H * 0.78);
      colGrad.addColorStop(0, `hsla(${hue + 20} 100% 70% / 0)`);
      colGrad.addColorStop(0.35, `hsla(${hue + 16} 100% 58% / ${0.55 * pulse})`);
      colGrad.addColorStop(0.7, `hsla(${hue + 6} 90% 38% / ${0.35 * pulse})`);
      colGrad.addColorStop(1, `hsla(${hue} 70% 18% / 0)`);
      ctx.fillStyle = colGrad;
      ctx.fillRect(colX - W * 0.06, H * 0.18, W * 0.12, H * 0.62);
      // Fractured crust chunks at the strike zone.
      for (let c = 0; c < 5; c++) {
        const cx = W * 0.5 + Math.sin(c * 2.1 + t * 0.5) * W * 0.1;
        const cy = H * 0.62 + c * H * 0.025;
        ctx.fillStyle = `hsl(${hue - 10} 30% ${12 + c * 2}%)`;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + W * 0.04, cy - H * 0.02);
        ctx.lineTo(cx + W * 0.03, cy + H * 0.015);
        ctx.closePath();
        ctx.fill();
      }
      // Smoke plume — layered rects, gritty not fluffy.
      for (let s = 0; s < 6; s++) {
        const sx = W * 0.5 + Math.sin(t * 0.6 + s * 1.7) * W * 0.08;
        const sy = H * (0.28 - s * 0.04) - Math.sin(t * 0.9 + s) * H * 0.02;
        const sw = W * (0.14 + s * 0.02);
        const sh = H * 0.035;
        ctx.fillStyle = `hsla(${hue - 20} 12% 12% / ${0.18 - s * 0.02})`;
        ctx.fillRect(sx - sw / 2, sy, sw, sh);
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [hue]);
  return <canvas ref={ref} />;
}

/** Procedural art for the shifting phase-spell card. */
function SpellArt({ hue, phase2 }: { hue: number; phase2: boolean }) {
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
      const g = ctx.createRadialGradient(W / 2, H / 2, 2, W / 2, H / 2, W * 0.7);
      g.addColorStop(0, `hsl(${hue} 70% 32%)`);
      g.addColorStop(1, `hsl(${hue} 55% 9%)`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      if (phase2) {
        // Thicket: swaying grass blades.
        ctx.strokeStyle = `hsl(${hue} 65% 52%)`;
        ctx.lineWidth = Math.max(1.4, W * 0.02);
        for (let i = 0; i < 8; i++) {
          const bx = (W / 9) * (i + 1);
          const sway = Math.sin(t * 2 + i) * W * 0.05;
          ctx.beginPath();
          ctx.moveTo(bx, H * 0.92);
          ctx.quadraticCurveTo(bx + sway * 0.4, H * 0.55, bx + sway, H * 0.2);
          ctx.stroke();
        }
      } else {
        // Sulfur cloud: overlapping drifting puffs.
        for (let i = 0; i < 6; i++) {
          const a = t * 0.6 + i;
          ctx.fillStyle = `hsla(${hue} 75% ${48 + (i % 3) * 8}% / 0.35)`;
          ctx.beginPath();
          ctx.arc(
            W / 2 + Math.cos(a) * W * 0.2,
            H / 2 + Math.sin(a * 1.4) * H * 0.16,
            W * (0.14 + (i % 3) * 0.05),
            0, Math.PI * 2,
          );
          ctx.fill();
        }
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [hue, phase2]);
  return <canvas ref={ref} />;
}
