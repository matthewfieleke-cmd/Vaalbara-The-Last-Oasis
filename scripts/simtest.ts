/* ============================================================================
 * Headless simulation harness — proves the engine is deterministic, stable
 * and reasonably balanced without ever opening a browser.
 *
 *   npm run sim            # quick suite: 12 seeded matches + determinism
 * ========================================================================== */

import { BotBrain, advanceTick, createGame, resetIds } from '../src/engine';
import type { GameState, PlayerInput } from '../src/types';
import { PHASE1_TICKS, PHASE2_TICKS, TRANSITION_TICKS } from '../src/types';

const MAX_TICKS = PHASE1_TICKS + TRANSITION_TICKS + PHASE2_TICKS + 5;

interface MatchStats {
  winner: string;
  ticks: number;
  unitsSpawnedP0: number;
  unitsSpawnedP1: number;
  dmgP0: number;
  dmgP1: number;
  dominanceP0: number;
  captureMeter: number;
  maxUnitsAlive: number;
  eventsTotal: number;
}

function runMatch(seed: number, factions: ['magma', 'oasis'] | ['oasis', 'magma']): MatchStats {
  resetIds();
  const st: GameState = createGame(seed, factions);
  const bots = [new BotBrain(0, seed + 1), new BotBrain(1, seed + 2)];
  let seq = 0;
  let spawned0 = 0;
  let spawned1 = 0;
  let maxAlive = 0;
  let eventsTotal = 0;

  for (let i = 0; i < MAX_TICKS && st.phase !== 'ended'; i++) {
    const inputs: PlayerInput[] = [];
    for (const p of [0, 1] as const) {
      const action = bots[p].think(st);
      if (action) inputs.push({ seq: ++seq, player: p, tick: st.tick + 1, action });
    }
    const { events } = advanceTick(st, inputs);
    eventsTotal += events.length;
    for (const e of events) {
      if (e.type === 'spawn') {
        if (e.owner === 0) spawned0++;
        else spawned1++;
      }
    }
    maxAlive = Math.max(maxAlive, st.units.length);
  }

  return {
    winner: String(st.winner),
    ticks: st.tick,
    unitsSpawnedP0: spawned0,
    unitsSpawnedP1: spawned1,
    dmgP0: Math.round(st.players[0].damageDealt),
    dmgP1: Math.round(st.players[1].damageDealt),
    dominanceP0: Math.round(st.dominanceP0 * 100) / 100,
    captureMeter: st.captureMeter,
    maxUnitsAlive: maxAlive,
    eventsTotal,
  };
}

/** Deterministic replay check: same seed & inputs => identical final state. */
function determinismCheck(seed: number): boolean {
  const play = (): string => {
    resetIds();
    const st = createGame(seed, ['magma', 'oasis']);
    const bots = [new BotBrain(0, seed + 1), new BotBrain(1, seed + 2)];
    let seq = 0;
    for (let i = 0; i < MAX_TICKS && st.phase !== 'ended'; i++) {
      const inputs: PlayerInput[] = [];
      for (const p of [0, 1] as const) {
        const action = bots[p].think(st);
        if (action) inputs.push({ seq: ++seq, player: p, tick: st.tick + 1, action });
      }
      advanceTick(st, inputs);
    }
    return JSON.stringify(st);
  };
  return play() === play();
}

console.log('— Vaalbara headless simulation suite —\n');

let failures = 0;
const wins: Record<string, number> = { '0': 0, '1': 0, tie: 0 };
const factionWins: Record<string, number> = { magma: 0, oasis: 0, tie: 0 };

for (let s = 1; s <= 24; s++) {
  const factions = s % 2 === 0 ? (['oasis', 'magma'] as const) : (['magma', 'oasis'] as const);
  try {
    const r = runMatch(s * 7919, [...factions] as ['magma', 'oasis'] | ['oasis', 'magma']);
    wins[r.winner] = (wins[r.winner] ?? 0) + 1;
    factionWins[r.winner === 'tie' ? 'tie' : factions[Number(r.winner) as 0 | 1]]++;
    const ok =
      r.ticks >= PHASE1_TICKS &&
      r.unitsSpawnedP0 > 5 &&
      r.unitsSpawnedP1 > 5 &&
      r.dmgP0 > 100 &&
      r.dmgP1 > 100 &&
      r.winner !== 'null';
    if (!ok) failures++;
    console.log(
      `seed ${String(s * 7919).padStart(6)} [${factions[0]} vs ${factions[1]}]  winner=${r.winner.padEnd(4)} ` +
      `ticks=${r.ticks} spawns=${r.unitsSpawnedP0}/${r.unitsSpawnedP1} dmg=${r.dmgP0}/${r.dmgP1} ` +
      `dom0=${r.dominanceP0} meter=${r.captureMeter} maxAlive=${r.maxUnitsAlive} ${ok ? 'OK' : '** SUSPECT **'}`,
    );
  } catch (err) {
    failures++;
    console.error(`seed ${s * 7919} CRASHED:`, err);
  }
}

console.log(`\nwin split  seat0=${wins['0']}  seat1=${wins['1']}  tie=${wins['tie']}`);
console.log(`faction split  magma=${factionWins.magma}  oasis=${factionWins.oasis}  tie=${factionWins.tie}`);

const det = determinismCheck(424242);
console.log(`determinism check: ${det ? 'PASS' : 'FAIL'}`);
if (!det) failures++;

// Perf: a full match should simulate far faster than real time.
const t0 = performance.now();
runMatch(31337, ['magma', 'oasis']);
const ms = performance.now() - t0;
console.log(`full-match sim time: ${ms.toFixed(1)} ms ${ms < 2000 ? '(PASS)' : '(SLOW)'}`);
if (ms >= 2000) failures++;

if (failures > 0) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log('\nAll checks passed.');
