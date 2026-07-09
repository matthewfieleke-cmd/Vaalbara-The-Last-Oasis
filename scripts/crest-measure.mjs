/* Measure the rubble-mound crest line of the processed ruin sprites: at the
 * razed (left) lane column, the topmost opaque stone pixel as a fraction of
 * sprite height. */
import sharp from 'sharp';

const jobs = [
  ['public/art/fort-front-ruin.webp', 0.229],
  ['public/art/fort-rear-ruin.webp', 0.242],
];
for (const [src, laneFrac] of jobs) {
  const { data, info } = await sharp(src).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  const probe = (fx) => {
    const x = Math.round(w * fx);
    for (let y = 0; y < h; y++) {
      const i = (y * w + x) * 4;
      const lum = data[i] * 0.3 + data[i + 1] * 0.6 + data[i + 2] * 0.1;
      if (data[i + 3] > 200 && lum < 150) return y / h;
    }
    return -1;
  };
  const around = [];
  for (let o = -0.03; o <= 0.03001; o += 0.01) around.push(probe(laneFrac + o));
  console.log(src, `${w}x${h}`, 'lane col crest fracs:', around.map((v) => v.toFixed(3)).join(' '));
  // Also the full mound profile at 2% steps for the breach shape.
  const prof = [];
  for (let f = 0.02; f <= 0.5; f += 0.02) prof.push(`${f.toFixed(2)}:${probe(f).toFixed(2)}`);
  console.log('  breach profile:', prof.join(' '));
}
