/* Terrain-honesty audit for the Basalt Fields: across full bot-vs-bot
 * matches, asserts that NO living ground unit ever occupies a blocked cell
 * (lava / wall) and that every unit inside a river band or arch corridor is
 * within its lane's radius-aware play — i.e. its body stays on the deck.
 *
 *   npx tsx scripts/lavatest.ts
 */
import { BotBrain, advanceTick, createGame, resetIds } from '../src/engine';
import { speciesDef } from '../src/data';
import { cellAt } from '../src/navmask';
import type { GameState, PlayerInput } from '../src/types';
import {
  BRIDGE_HALF_W, FORT_ARCH_HALF_W, FORT_LANES, FORT_WALL_FRONT,
  PHASE1_TICKS, RIVER_BANDS,
} from '../src/types';

function runMatch(seed: number): { blocked: number; offLane: number } {
  resetIds();
  const st: GameState = createGame(seed, ['magma', 'oasis']);
  const bots = [new BotBrain(0, seed + 1), new BotBrain(1, seed + 2)];
  let seq = 0;
  let blocked = 0;
  let offLane = 0;

  for (let i = 0; i < PHASE1_TICKS + 5 && st.phase === 'basalt'; i++) {
    const inputs: PlayerInput[] = [];
    for (const p of [0, 1] as const) {
      const action = bots[p].think(st);
      if (action) inputs.push({ seq: ++seq, player: p, tick: st.tick + 1, action });
    }
    advanceTick(st, inputs);

    for (const u of st.units) {
      if (u.hp <= 0) continue;
      const stats = speciesDef(u.species).stats!;
      if (stats.flying) continue;
      if (cellAt('basalt', u.x, u.y) === 1) {
        blocked++;
        if (blocked < 4) console.log(`  seed ${seed} tick ${st.tick}: ${u.species} on BLOCKED cell at ${u.x.toFixed(2)},${u.y.toFixed(2)}`);
      }
      let lanes: readonly [number, number] | null = null;
      let halfW = 0;
      if (u.y > FORT_WALL_FRONT[0]) { lanes = FORT_LANES[0]; halfW = FORT_ARCH_HALF_W; }
      else if (u.y < FORT_WALL_FRONT[1]) { lanes = FORT_LANES[1]; halfW = FORT_ARCH_HALF_W; }
      else {
        for (const o of [0, 1] as const) {
          const b = RIVER_BANDS[o];
          if (u.y >= b.y0 && u.y <= b.y1) { lanes = FORT_LANES[o]; halfW = BRIDGE_HALF_W; }
        }
      }
      if (!lanes) continue;
      const laneX = Math.abs(u.x - lanes[0]) < Math.abs(u.x - lanes[1]) ? lanes[0] : lanes[1];
      const play = Math.max(0.05, halfW - stats.radius) + 1e-6;
      if (Math.abs(u.x - laneX) > play) {
        offLane++;
        if (offLane < 4) console.log(`  seed ${seed} tick ${st.tick}: ${u.species} off-lane |dx|=${Math.abs(u.x - laneX).toFixed(3)} play=${play.toFixed(3)} at y=${u.y.toFixed(2)}`);
      }
    }
  }
  return { blocked, offLane };
}

let totBlocked = 0;
let totOffLane = 0;
for (let s = 0; s < 30; s++) {
  const r = runMatch(52000 + s * 7717);
  totBlocked += r.blocked;
  totOffLane += r.offLane;
}
console.log(`\nTOTAL across 30 matches: blocked-cell ticks=${totBlocked}, off-lane ticks=${totOffLane}`);
if (totBlocked > 0 || totOffLane > 0) process.exit(1);
console.log('PASS: no ground unit ever stood in lava or off its lane.');
