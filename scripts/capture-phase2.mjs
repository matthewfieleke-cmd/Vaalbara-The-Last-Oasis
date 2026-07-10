/* Run all Phase-2 visual capture scripts in sequence.
 *   npm run build && npx vite preview --port 4310 &
 *   node scripts/capture-phase2.mjs
 *
 * Outputs:
 *   /tmp/vaalbara-shots/          — intro, flyers, scorpion duel, lava rain
 *   /tmp/vaalbara-causeway/       — razed-lane perspective march
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));
const scripts = [
  'capture-intro.mjs',
  'capture-causeway.mjs',
  'capture-flyers.mjs',
  'capture-scorpion-duel.mjs',
  'capture-lava-rain.mjs',
];

function run(script) {
  return new Promise((resolve, reject) => {
    const p = spawn('node', [path.join(root, script)], { stdio: 'inherit' });
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${script} exited ${code}`))));
  });
}

for (const s of scripts) {
  console.log(`\n=== ${s} ===`);
  await run(s);
}
console.log('\nAll Phase-2 captures complete.');
