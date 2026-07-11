/* Phase-1 gatehouse outcome distribution harness. */
import { BotBrain, advanceTick, createGame, resetIds } from '../src/engine';
import type { FactionId, GameState, PlayerInput } from '../src/types';
import { PHASE1_TICKS, TICK_MS } from '../src/types';

const FIVE_MIN = Math.round((5 * 60 * 1000) / TICK_MS);
const N = Number(process.argv[2] ?? 200);

type Bucket =
  | '1-1'
  | 'oasis_2_magma_1'
  | 'magma_2_oasis_1'
  | 'oasis_2_magma_0'
  | 'magma_2_oasis_0'
  | 'other';

function razedBy(st: GameState, attacker: FactionId): number {
  const atk = st.players[0].faction === attacker ? 0 : 1;
  const def = (1 - atk) as 0 | 1;
  return st.obelisks.filter((o) => o.owner === def && o.hp <= 0).length;
}

function bucketOf(m: number, o: number): Bucket {
  if (m === 1 && o === 1) return '1-1';
  if (o === 2 && m === 1) return 'oasis_2_magma_1';
  if (m === 2 && o === 1) return 'magma_2_oasis_1';
  if (o === 2 && m === 0) return 'oasis_2_magma_0';
  if (m === 2 && o === 0) return 'magma_2_oasis_0';
  return 'other';
}

function runOne(seed: number, magmaSeat: 0 | 1, until: number) {
  resetIds();
  const factions: [FactionId, FactionId] = magmaSeat === 0 ? ['magma', 'oasis'] : ['oasis', 'magma'];
  const st = createGame(seed, factions);
  const bots = [new BotBrain(0, seed + 11), new BotBrain(1, seed + 29)];
  let seq = 0;
  for (let i = 0; i < until + 2 && st.phase === 'basalt'; i++) {
    const inputs: PlayerInput[] = [];
    for (const p of [0, 1] as const) {
      const a = bots[p].think(st);
      if (a) inputs.push({ seq: ++seq, player: p, tick: st.tick + 1, action: a });
    }
    advanceTick(st, inputs);
  }
  const m = razedBy(st, 'magma');
  const o = razedBy(st, 'oasis');
  const ms = st.players[0].faction === 'magma' ? 0 : 1;
  const os = (1 - ms) as 0 | 1;
  return {
    m, o, bucket: bucketOf(m, o), ticks: st.tick, phase: st.phase,
    sm: st.units.filter((u) => u.hp > 0 && u.owner === ms).length,
    so: st.units.filter((u) => u.hp > 0 && u.owner === os).length,
    beetle: st.units.some((u) => u.hp > 0 && u.species === 'beetles' && u.owner === os),
    gateHp: st.obelisks.map((g) => ({
      owner: st.players[g.owner].faction,
      wing: g.wing,
      hp: Math.max(0, Math.round(g.hp)),
    })),
  };
}

function report(label: string, until: number) {
  const counts: Record<Bucket, number> = {
    '1-1': 0, oasis_2_magma_1: 0, magma_2_oasis_1: 0,
    oasis_2_magma_0: 0, magma_2_oasis_0: 0, other: 0,
  };
  const otherPairs: Record<string, number> = {};
  let wipeM = 0, wipeO = 0, beetle = 0, early = 0, sumTicks = 0;
  for (let i = 0; i < N; i++) {
    const r = runOne(200_000 + i * 91, (i % 2) as 0 | 1, until);
    counts[r.bucket]++;
    sumTicks += r.ticks;
    if (r.bucket === 'other') {
      const k = `${r.o}o-${r.m}m`;
      otherPairs[k] = (otherPairs[k] ?? 0) + 1;
    }
    if (r.sm === 0 && r.so >= 4) wipeM++;
    if (r.so === 0 && r.sm >= 4) wipeO++;
    if (r.beetle) beetle++;
    if (r.phase !== 'basalt' && r.ticks < FIVE_MIN) early++;
  }
  const p = (k: Bucket) => ((100 * counts[k]) / N).toFixed(1);
  console.log(`\n=== ${label} (N=${N}, until=${until} ticks) ===`);
  console.log(`1-1                    ${String(counts['1-1']).padStart(4)}  ${p('1-1')}%   (tgt 50)`);
  console.log(`oasis2/magma1          ${String(counts.oasis_2_magma_1).padStart(4)}  ${p('oasis_2_magma_1')}%   (tgt 20)`);
  console.log(`magma2/oasis1          ${String(counts.magma_2_oasis_1).padStart(4)}  ${p('magma_2_oasis_1')}%   (tgt 20)`);
  console.log(`oasis sweep            ${String(counts.oasis_2_magma_0).padStart(4)}  ${p('oasis_2_magma_0')}%   (tgt 5)`);
  console.log(`magma sweep            ${String(counts.magma_2_oasis_0).padStart(4)}  ${p('magma_2_oasis_0')}%   (tgt 5)`);
  console.log(`other                  ${String(counts.other).padStart(4)}  ${p('other')}%`);
  console.log(`avg ticks ${ (sumTicks/N).toFixed(0) }  early<5:00 ${early}  beetleAlive ${beetle}  magmaWiped ${wipeM}  oasisWiped ${wipeO}`);
  if (counts.other) console.log(' other pairs', otherPairs);
}

report('at 5:00 or P1 end', FIVE_MIN);
report('at full P1 valve (6:00) or end', PHASE1_TICKS);
