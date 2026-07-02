import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BOARD_H, BOARD_W, DEPLOY_ROWS, PHASE1_TICKS, PHASE2_TICKS, PHASE_SPELL_CARD, TICK_MS,
} from '../types';
import type { CardId, GameEvent, GameState, PlayerId } from '../types';
import { cardDef } from '../data';
import { BotBrain, TickDriver } from '../engine';
import { Renderer } from '../render';
import { handleGameEvents, music, playUi } from '../audio';
import type { MatchSession } from '../net';
import { CardArt } from './CardArt';

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
  const [ultArming, setUltArming] = useState(false);
  const [banner, setBanner] = useState<Banner | null>(null);
  const [toast, setToast] = useState<{ id: number; text: string } | null>(null);
  const selectedRef = useRef<CardId | null>(null);
  const ultArmingRef = useRef(false);
  selectedRef.current = selectedCard;
  ultArmingRef.current = ultArming;
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
        handleGameEvents(events);
        routeEvents(events, state);
        // Battle density feeds the adaptive score.
        music.setIntensity(Math.min(1, state.units.length / 14));
        music.setPhase(state.phase);
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
            title: 'Phase II — The Oasis',
            body: 'Hold the pond. Aqua flows double.',
            color: '#4fd8ff',
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
    music.setPhase('basalt');
    driver.start();

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
    const t = renderer.screenToTile(px, py);
    // Forgiving one-handed input: touches just outside the board clamp to the
    // nearest tile (thumbs often land below the baseline row). Touches far
    // away are ignored.
    if (t.x < -1.6 || t.x > BOARD_W + 0.6 || t.y < -1.6 || t.y > BOARD_H + 0.6) return;
    const gx = Math.max(0, Math.min(BOARD_W - 1, Math.round(t.x)));
    const gy = Math.max(0, Math.min(BOARD_H - 1, Math.round(t.y)));
    const st = driver.state;
    if (st.phase !== 'basalt' && st.phase !== 'oasis') return;

    // Ultimate targeting takes priority.
    if (ultArmingRef.current) {
      driver.submit(seat, { type: 'ult', x: gx, y: gy });
      setUltArming(false);
      renderer.telegraph.active = false;
      playUi('tap');
      return;
    }

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

    // Unit deploy: touch must begin on the local baseline rows.
    if (!DEPLOY_ROWS[seat].includes(gy)) {
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
    if (!renderer || !drag || drag.pointerId !== e.pointerId) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const t = renderer.screenToTile(e.clientX - rect.left, e.clientY - rect.top);
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
  const mm = Math.floor(secondsLeft / 60);
  const ss = String(secondsLeft % 60).padStart(2, '0');

  // Dominance (phase 1) / capture (phase 2) meter from the local seat's view.
  const meterMine = useMemo(() => {
    if (!ui) return 50;
    if (ui.phase === 'oasis' || ui.phase === 'ended') {
      const m = seat === 0 ? ui.captureMeter : -ui.captureMeter;
      return 50 + m / 2;
    }
    const p0 = ui.players[0];
    const p1 = ui.players[1];
    const terrTotal = p0.territoryScore + p1.territoryScore;
    const dmgTotal = p0.damageDealt + p1.damageDealt;
    const terr = terrTotal > 0 ? p0.territoryScore / terrTotal : 0.5;
    const dmg = dmgTotal > 0 ? p0.damageDealt / dmgTotal : 0.5;
    const dom0 = (terr * 0.5 + dmg * 0.5) * 100;
    return seat === 0 ? dom0 : 100 - dom0;
  }, [ui, seat]);

  const selectCard = (card: CardId) => {
    if (!me || !ui) return;
    const def = cardDef(card, ui.phase);
    if (me.aqua < def.cost) {
      playUi('error');
      showToast(`Need ${def.cost} aqua for ${def.name}`);
      return;
    }
    setUltArming(false);
    if (rendererRef.current) rendererRef.current.telegraph.active = false;
    setSelectedCard((c) => (c === card ? null : card));
    playUi('tap');
  };

  const armUlt = () => {
    if (!me || me.ultUsed) return;
    setSelectedCard(null);
    setUltArming((v) => {
      const next = !v;
      if (rendererRef.current) rendererRef.current.telegraph.active = false;
      if (next) showToast('Tap anywhere — the sky will fall in 1.2 s');
      return next;
    });
    playUi('tap');
  };

  return (
    <div className="game-screen">
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

      <div className="hud-top">
        <div className="hud-row">
          <span className={`phase-pill ${phase === 'oasis' || phase === 'ended' ? 'oasis' : 'basalt'}`}>
            {phase === 'basalt' ? 'I · Basalt Fields' : phase === 'transition' ? '⇧ The March' : 'II · The Oasis'}
          </span>
          <span className={`timer ${secondsLeft <= 30 && (phase === 'basalt' || phase === 'oasis') ? 'urgent' : ''}`}>
            {mm}:{ss}
          </span>
        </div>
        <div className="meter-bar">
          <div className="mine" style={{ width: `${meterMine}%` }} />
          <div className="theirs" style={{ width: `${100 - meterMine}%` }} />
        </div>
        {me?.blessed && <div className="blessing-tag">✦ Vaalbara Blessing ✦</div>}
      </div>

      <button
        className={`ult-btn ${ultArming ? 'arming' : ''}`}
        disabled={!me || me.ultUsed || phase === 'transition' || phase === 'ended'}
        onClick={armUlt}
        aria-label="Lava Rain ultimate"
      >
        <span className="flame">☄</span>
        Lava Rain
      </button>

      <div className="hand-dock">
        <div className="aqua-bar">
          <div className="aqua-cells">
            {Array.from({ length: 10 }, (_, i) => (
              <div key={i} className={`aqua-cell ${me && i < me.aqua ? 'full' : ''}`} />
            ))}
          </div>
          <span className="aqua-count">{me?.aqua ?? 0}</span>
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
                    <CardArt species={def.species} hue={def.hue} />
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
