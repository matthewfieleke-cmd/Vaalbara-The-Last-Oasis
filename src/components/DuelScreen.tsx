import { useEffect, useRef, useState } from 'react';
import type { FactionId, SpeciesId } from '../types';
import {
  activeDuelist,
  createDuelMatch,
  pickBotIntent,
  pickBotReplacement,
  resolveExchange,
  sendNext,
  DUEL_STATS,
} from '../duel';
import type { DuelIntent, DuelMatch, DuelSide, Duelist } from '../duel';
import { DuelStage } from '../duel-stage';
import type { DuelWorld } from '../duel-stage';
import { music, playKo, playResult, playSpeciesAttack, playSpeciesSpawn, playUi } from '../audio';
import { DuelStatCard } from './DuelCards';

type UiPhase = 'intro' | 'choose' | 'playing' | 'pick' | 'over';

/* ------------------------------------------------------------------------ */
/* HUD pieces                                                                 */
/* ------------------------------------------------------------------------ */

function statusChips(d: Duelist): { txt: string; hue: number }[] {
  const chips: { txt: string; hue: number }[] = [];
  if (d.status.poison > 0) chips.push({ txt: `☠ ${d.status.poison}`, hue: 120 });
  if (d.status.burn > 0) chips.push({ txt: `🔥 ${d.status.burn}`, hue: 22 });
  if (d.status.stunned) chips.push({ txt: '✶ stun', hue: 55 });
  if (d.status.stagger > 0) chips.push({ txt: `↯ −ATK ${d.status.stagger}`, hue: 285 });
  if (d.status.thorns > 0) chips.push({ txt: `❋ quills ${d.status.thorns}`, hue: 160 });
  if (d.status.defShred > 0) chips.push({ txt: `⛨ −DEF`, hue: 130 });
  return chips;
}

function HudPanel({
  m,
  side,
  hp,
  meter,
}: {
  m: DuelMatch;
  side: DuelSide;
  hp: number;
  meter: number;
}) {
  const d = activeDuelist(m, side);
  const pct = Math.max(0, Math.min(100, (hp / d.maxHp) * 100));
  const low = pct < 30;
  return (
    <div className={`duel-hud ${side === 0 ? 'left' : 'right'}`}>
      <div className="duel-hud-name">
        {d.name}
        <span className="duel-hud-side">{side === 0 ? 'YOU' : 'FOE'}</span>
      </div>
      <div className="duel-hp-track">
        <div
          className={`duel-hp-fill ${low ? 'low' : ''}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="duel-hud-row">
        <span className="duel-hp-num">{Math.max(0, Math.round(hp))} / {d.maxHp}</span>
        <div className={`duel-fury ${meter >= 100 ? 'full' : ''}`}>
          <div className="duel-fury-fill" style={{ width: `${meter}%` }} />
        </div>
      </div>
      <div className="duel-chips">
        {statusChips(d).map((c, i) => (
          <span key={i} className="duel-chip" style={{ ['--hue' as string]: c.hue }}>{c.txt}</span>
        ))}
      </div>
      <div className="duel-pips">
        {m.teams[side].map((t, i) => (
          <span
            key={i}
            className={`duel-pip ${t.ko ? 'ko' : ''} ${i === m.active[side] ? 'active' : ''}`}
          />
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* Screen                                                                     */
/* ------------------------------------------------------------------------ */

export function DuelScreen({
  faction,
  order,
  onExit,
}: {
  faction: FactionId;
  order: SpeciesId[];
  onExit: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const matchRef = useRef<DuelMatch | null>(null);
  const stageRef = useRef<DuelStage | null>(null);
  const [phase, setPhase] = useState<UiPhase>('intro');
  const [hud, setHud] = useState<{ hp: [number, number]; meter: [number, number] }>({
    hp: [1, 1],
    meter: [0, 0],
  });
  const [round, setRound] = useState(1);
  const [nonce, setNonce] = useState(0); // rematch remounts the arena

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const m = createDuelMatch(faction, order);
    matchRef.current = m;
    const world: DuelWorld = m.rng() < 0.5 ? 'basalt' : 'oasis';
    const stage = new DuelStage(canvas, world);
    stageRef.current = stage;

    const syncHud = () => {
      setHud({
        hp: [activeDuelist(m, 0).hp, activeDuelist(m, 1).hp],
        meter: [activeDuelist(m, 0).meter, activeDuelist(m, 1).meter],
      });
    };

    const a = activeDuelist(m, 0);
    const b = activeDuelist(m, 1);
    stage.setFighter(0, a.species, a.hue, true);
    stage.setFighter(1, b.species, b.hue, true);
    playSpeciesSpawn(a.species);
    syncHud();
    setRound(1);
    setPhase('intro');
    const introTimer = setTimeout(() => setPhase('choose'), 2100);

    music.start();
    music.setMode(world === 'basalt' ? 'basalt' : 'oasis');
    music.setIntensity(0.55);

    stage.onEventApplied = (ev) => {
      setHud({ hp: [...ev.after.hp], meter: [...ev.after.meter] });
    };
    stage.onImpact = (sp, special, ko) => {
      if (ko) playKo();
      else playSpeciesAttack(sp);
      if (special) music.braam(98, 1.2, 0.4);
    };
    stage.onScriptDone = () => {
      if (m.winner !== null) {
        music.setIntensity(0.3);
        playResult(m.winner === 0);
        setPhase('over');
        return;
      }
      const pKo = activeDuelist(m, 0).ko;
      const bKo = activeDuelist(m, 1).ko;
      if (bKo) {
        const i = pickBotReplacement(m);
        if (i >= 0) {
          sendNext(m, 1, i);
          const nb = activeDuelist(m, 1);
          stage.setFighter(1, nb.species, nb.hue, true);
          playSpeciesSpawn(nb.species);
        }
      }
      setRound(m.round);
      music.setIntensity(Math.min(1, 0.5 + (m.round - 1) * 0.06));
      if (pKo) {
        setPhase('pick');
      } else {
        syncHud();
        setPhase('choose');
      }
    };

    return () => {
      clearTimeout(introTimer);
      stage.dispose();
      stageRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [faction, order, nonce]);

  const act = (intent: DuelIntent) => {
    const m = matchRef.current;
    const stage = stageRef.current;
    if (!m || !stage || phase !== 'choose' || stage.busy) return;
    playUi('tap');
    const events = resolveExchange(m, [intent, pickBotIntent(m)]);
    setPhase('playing');
    stage.playScript(events);
  };

  const pickNext = (teamIndex: number) => {
    const m = matchRef.current;
    const stage = stageRef.current;
    if (!m || !stage) return;
    playUi('tap');
    sendNext(m, 0, teamIndex);
    const d = activeDuelist(m, 0);
    stage.setFighter(0, d.species, d.hue, true);
    playSpeciesSpawn(d.species);
    setHud({
      hp: [d.hp, activeDuelist(m, 1).hp],
      meter: [d.meter, activeDuelist(m, 1).meter],
    });
    setPhase('choose');
  };

  const m = matchRef.current;
  const me = m ? activeDuelist(m, 0) : null;
  const specialDef = me ? DUEL_STATS[me.species].special : null;
  const canSpecial = !!me && me.meter >= 100;

  return (
    <div className="duel-screen">
      <div className="duel-stage-wrap">
        <canvas ref={canvasRef} className="duel-canvas" />
        {m && <HudPanel m={m} side={0} hp={hud.hp[0]} meter={hud.meter[0]} />}
        {m && <HudPanel m={m} side={1} hp={hud.hp[1]} meter={hud.meter[1]} />}
        <div className="duel-round-tag">ROUND {round}</div>

        {phase === 'intro' && m && (
          <div className="duel-intro-overlay">
            <div className="duel-intro-vs">
              <span>{activeDuelist(m, 0).name}</span>
              <b>VS</b>
              <span>{activeDuelist(m, 1).name}</span>
            </div>
          </div>
        )}

        {phase === 'over' && m && (
          <div className="duel-over-overlay">
            <h2 className={m.winner === 0 ? 'win' : 'lose'}>
              {m.winner === 0 ? 'VICTORY' : 'DEFEAT'}
            </h2>
            <p>
              {m.winner === 0
                ? `${m.teams[0].filter((d) => !d.ko).length} of your champions still stand.`
                : 'Your coalition has fallen. The water changes hands.'}
            </p>
            <div className="menu-actions">
              <button
                className="btn btn-primary"
                onClick={() => {
                  playUi('tap');
                  setNonce((n) => n + 1);
                }}
              >
                ⚔ Rematch
              </button>
              <button className="btn btn-ghost" onClick={onExit}>
                ◂ Main menu
              </button>
            </div>
          </div>
        )}
      </div>

      {phase === 'pick' && m && (
        <div className="duel-pick-overlay">
          <h3>Your champion has fallen. Send the next.</h3>
          <div className="duel-pick-grid">
            {m.teams[0].map((d, i) => (
              <DuelStatCard
                key={d.species}
                species={d.species}
                faction={m.factions[0]}
                compact
                disabled={d.ko}
                onClick={() => !d.ko && pickNext(i)}
              />
            ))}
          </div>
        </div>
      )}

      <div className="duel-controls">
        {phase === 'choose' && me ? (
          <>
            <button className="duel-btn strike" onClick={() => act('strike')}>
              <b>Strike</b>
              <span>Attack — beware the guard</span>
            </button>
            <button className="duel-btn guard" onClick={() => act('guard')}>
              <b>Guard</b>
              <span>Block 70% + counter-blow</span>
            </button>
            <button
              className={`duel-btn special ${canSpecial ? 'ready' : ''}`}
              disabled={!canSpecial}
              onClick={() => act('special')}
            >
              <b>✦ {specialDef?.name ?? 'Special'}</b>
              <span>{canSpecial ? 'FURY FULL — UNLEASH IT' : 'Needs full Fury'}</span>
            </button>
          </>
        ) : (
          <div className="duel-wait">
            {phase === 'playing' ? '— the clash unfolds —' : phase === 'intro' ? 'the champions enter…' : ' '}
          </div>
        )}
        <button className="duel-flee" onClick={onExit} title="Concede">
          ✕
        </button>
      </div>
    </div>
  );
}
