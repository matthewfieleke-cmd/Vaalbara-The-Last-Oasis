/* Measures pathing health: counts "stuck" unit episodes — a living ground
 * unit that wants to move (action idle/move, out of attack reach) yet stays
 * within a 0.15-unit circle for 20+ consecutive ticks (6 s).
 *
 *   npx tsx scripts/stucktest.ts
 */
import { BotBrain, advanceTick, createGame, resetIds } from '../src/engine';
import { isWater } from '../src/navmask';
import type { GameState, PlayerInput } from '../src/types';
import { PHASE1_TICKS, PHASE2_TICKS, TRANSITION_TICKS } from '../src/types';

const MAX_TICKS = PHASE1_TICKS + TRANSITION_TICKS + PHASE2_TICKS + 5;
const STUCK_TICKS = 20;

function runMatch(seed: number): { episodes: number; worst: number } {
  resetIds();
  const st: GameState = createGame(seed, ['magma', 'oasis']);
  const bots = [new BotBrain(0, seed + 1), new BotBrain(1, seed + 2)];
  let seq = 0;

  const anchor = new Map<number, { x: number; y: number; ticks: number; counted: boolean }>();
  let episodes = 0;
  let worst = 0;

  for (let i = 0; i < MAX_TICKS && st.phase !== 'ended'; i++) {
    const inputs: PlayerInput[] = [];
    for (const p of [0, 1] as const) {
      const action = bots[p].think(st);
      if (action) inputs.push({ seq: ++seq, player: p, tick: st.tick + 1, action });
    }
    advanceTick(st, inputs);

    const world = st.phase === 'basalt' ? 'basalt' as const : 'oasis' as const;
    for (const u of st.units) {
      if (u.hp <= 0) { anchor.delete(u.id); continue; }
      // Attacking or dueling units are allowed to stand still, and so are
      // units holding the pond (that IS the Phase-2 objective).
      if (u.action === 'attack' || u.targetId !== null) { anchor.delete(u.id); continue; }
      if (st.phase === 'oasis' && isWater(world, u.x, u.y)) { anchor.delete(u.id); continue; }
      const a = anchor.get(u.id);
      if (!a || Math.hypot(u.x - a.x, u.y - a.y) > 0.15) {
        anchor.set(u.id, { x: u.x, y: u.y, ticks: 0, counted: false });
        continue;
      }
      a.ticks++;
      worst = Math.max(worst, a.ticks);
      if (a.ticks >= STUCK_TICKS && !a.counted) {
        a.counted = true;
        episodes++;
      }
    }
  }
  return { episodes, worst };
}

let totalEpisodes = 0;
let worstAll = 0;
const seeds: number[] = [];
for (let s = 0; s < 30; s++) seeds.push(52000 + s * 7717);
for (const seed of seeds) {
  const r = runMatch(seed);
  totalEpisodes += r.episodes;
  worstAll = Math.max(worstAll, r.worst);
  if (r.episodes > 0) console.log(`seed ${seed}: stuck episodes=${r.episodes} worst=${r.worst} ticks`);
}
console.log(`\nTOTAL stuck episodes across ${seeds.length} matches: ${totalEpisodes} (worst hold: ${worstAll} ticks)`);
