/* Dumps details of stuck episodes for one seed. */
import { BotBrain, advanceTick, createGame, resetIds } from '../src/engine';
import { cellAt, worldToPath, pathNodeOpen } from '../src/navmask';
import type { GameState, PlayerInput } from '../src/types';
import { PHASE1_TICKS, PHASE2_TICKS, TRANSITION_TICKS } from '../src/types';

const seed = Number(process.argv[2] ?? 198623);
const MAX_TICKS = PHASE1_TICKS + TRANSITION_TICKS + PHASE2_TICKS + 5;

resetIds();
const st: GameState = createGame(seed, ['magma', 'oasis']);
const bots = [new BotBrain(0, seed + 1), new BotBrain(1, seed + 2)];
let seq = 0;
const anchor = new Map<number, { x: number; y: number; ticks: number }>();

for (let i = 0; i < MAX_TICKS && st.phase !== 'ended'; i++) {
  const inputs: PlayerInput[] = [];
  for (const p of [0, 1] as const) {
    const action = bots[p].think(st);
    if (action) inputs.push({ seq: ++seq, player: p, tick: st.tick + 1, action });
  }
  advanceTick(st, inputs);
  for (const u of st.units) {
    if (u.hp <= 0) { anchor.delete(u.id); continue; }
    if (u.action === 'attack' || u.targetId !== null) { anchor.delete(u.id); continue; }
    const a = anchor.get(u.id);
    if (!a || Math.hypot(u.x - a.x, u.y - a.y) > 0.15) {
      anchor.set(u.id, { x: u.x, y: u.y, ticks: 0 });
      continue;
    }
    a.ticks++;
    if (a.ticks === 20 || a.ticks === 60) {
      const world = st.phase === 'oasis' || st.phase === 'transition' ? 'oasis' : 'basalt';
      const pn = worldToPath(u.x, u.y);
      console.log(
        `tick=${st.tick} phase=${st.phase} ${u.species}#${u.id} owner=${u.owner}`
        + ` pos=(${u.x.toFixed(2)},${u.y.toFixed(2)}) action=${u.action}`
        + ` waypoint=${u.waypoint ? `(${u.waypoint.x.toFixed(2)},${u.waypoint.y.toFixed(2)})` : 'none'}`
        + ` cell=${cellAt(world, u.x, u.y)} node=(${pn.px},${pn.py}) open=${pathNodeOpen(world, pn.px, pn.py)}`
        + ` stuckFor=${a.ticks}`,
      );
    }
  }
}
console.log('done, phase:', st.phase, 'winner:', st.winner);
