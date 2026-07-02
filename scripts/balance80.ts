import { BotBrain, advanceTick, createGame, resetIds } from '../src/engine';
import type { PlayerInput } from '../src/types';

function run(seed: number, f: ['magma', 'oasis'] | ['oasis', 'magma']) {
  resetIds();
  const st = createGame(seed, f);
  const bots = [new BotBrain(0, seed + 1), new BotBrain(1, seed + 2)];
  let seq = 0;
  for (let i = 0; i < 420 && st.phase !== 'ended'; i++) {
    const inputs: PlayerInput[] = [];
    for (const p of [0, 1] as const) {
      const a = bots[p].think(st);
      if (a) inputs.push({ seq: ++seq, player: p, tick: st.tick + 1, action: a });
    }
    advanceTick(st, inputs);
  }
  return st.winner;
}

const fw = { magma: 0, oasis: 0, tie: 0 };
const sw = { s0: 0, s1: 0, tie: 0 };
for (let s = 1; s <= 80; s++) {
  const f = (s % 2 === 0 ? ['oasis', 'magma'] : ['magma', 'oasis']) as ['magma', 'oasis'] | ['oasis', 'magma'];
  const w = run(s * 104729 + 17, f);
  if (w === 'tie' || w === null) {
    fw.tie++;
    sw.tie++;
    continue;
  }
  fw[f[w]]++;
  if (w === 0) sw.s0++;
  else sw.s1++;
}
console.log('factions:', fw, ' seats:', sw);
