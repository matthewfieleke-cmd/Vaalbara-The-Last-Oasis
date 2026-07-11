import { BotBrain, advanceTick, createGame, resetIds } from '../src/engine';
import type { FactionId, PlayerInput } from '../src/types';
import { PHASE1_TICKS } from '../src/types';

const N = 200;
const firstMagmaGate: number[] = []; // tick when oasis loses first gate (magma scored)
const firstOasisGate: number[] = [];
const secondAny: number[] = [];
let bothFirst = 0;

for (let i = 0; i < N; i++) {
  resetIds();
  const magmaSeat = (i % 2) as 0 | 1;
  const factions: [FactionId, FactionId] = magmaSeat === 0 ? ['magma', 'oasis'] : ['oasis', 'magma'];
  const st = createGame(500_000 + i * 71, factions);
  const bots = [new BotBrain(0, 500_000 + i * 71 + 5), new BotBrain(1, 500_000 + i * 71 + 19)];
  let seq = 0;
  let mFirst = -1, oFirst = -1, second = -1;
  const ms = magmaSeat;
  const os = (1 - ms) as 0 | 1;
  for (let t = 0; t < PHASE1_TICKS + 2 && st.phase === 'basalt'; t++) {
    const inputs: PlayerInput[] = [];
    for (const p of [0, 1] as const) {
      const a = bots[p].think(st);
      if (a) inputs.push({ seq: ++seq, player: p, tick: st.tick + 1, action: a });
    }
    advanceTick(st, inputs);
    const oasisLost = st.obelisks.filter((o) => o.owner === os && o.hp <= 0).length;
    const magmaLost = st.obelisks.filter((o) => o.owner === ms && o.hp <= 0).length;
    if (mFirst < 0 && oasisLost >= 1) mFirst = st.tick;
    if (oFirst < 0 && magmaLost >= 1) oFirst = st.tick;
    if (second < 0 && (oasisLost >= 2 || magmaLost >= 2)) second = st.tick;
  }
  if (mFirst >= 0) firstMagmaGate.push(mFirst);
  if (oFirst >= 0) firstOasisGate.push(oFirst);
  if (second >= 0) secondAny.push(second);
  if (mFirst >= 0 && oFirst >= 0) bothFirst++;
}
const avg = (a: number[]) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : -1;
console.log(`Magma scores first gate: ${firstMagmaGate.length}/${N} avgTick=${avg(firstMagmaGate).toFixed(0)}`);
console.log(`Oasis scores first gate: ${firstOasisGate.length}/${N} avgTick=${avg(firstOasisGate).toFixed(0)}`);
console.log(`Both sides score ≥1 gate in same match: ${bothFirst}/${N} (${((100*bothFirst)/N).toFixed(1)}%)`);
console.log(`Someone scores 2nd gate: ${secondAny.length}/${N} avgTick=${avg(secondAny).toFixed(0)}`);
