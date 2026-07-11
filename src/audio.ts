/* ============================================================================
 * VAALBARA: THE LAST OASIS — audio.ts
 * A fully procedural Web Audio synthesizer. Zero audio files.
 *
 *  - Soundtrack: generative layers on a 100 BPM musical clock.
 *    Phase 1 (Basalt Fields) — 2–2–1 corps / Zimmer book:
 *      Act 1 (0:00–2:00): front ensemble — 8th ostinato, hats, shimmer, theme
 *      Act 2 (2:00–4:00): full corps — 16ths, octave strings, low brass, choir air
 *      Act 3 (4:00–5:00): additive apex (Time / Babylon craft) — sustained rich
 *                       chords, melody through them, ≤3 braams; triumph → awe
 *    Clock owns the arc; warriors are battery + depth color (presence beds).
 *    Early double-raze skips the last crest into the transition riser.
 *    Cinematic intro: pre-corps intensity-gated bed (not the battle finale).
 *    Phase 2 (Oasis): D-dorian score, crossfaded over the march.
 *  - Warriors: battle DRUMLINE on the shared grid (ticks = 8ths @ 100 BPM);
 *    species also thicken the Act 3 tapestry as non-percussive color.
 * ========================================================================== */

import type { GameEvent, SpeciesId } from './types';
import { TICK_MS } from './types';

/** One 16th note at 100 BPM — soundtrack scheduler step. */
export const MUSIC_16TH_SEC = 0.15;
/** One 8th note at 100 BPM — equals one sim tick (TICK_MS). */
export const MUSIC_TICK_SEC = TICK_MS / 1000;

/* ------------------------------------------------------------------------ */
/* Core                                                                       */
/* ------------------------------------------------------------------------ */

class AudioCore {
  ctx: AudioContext | null = null;
  master: GainNode | null = null;
  musicBus: GainNode | null = null;
  sfxBus: GainNode | null = null;
  enabled = true;

  ensure(): AudioContext | null {
    if (!this.enabled) return null;
    if (!this.ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.7;
      this.master.connect(this.ctx.destination);
      this.musicBus = this.ctx.createGain();
      this.musicBus.gain.value = 0.55;
      this.musicBus.connect(this.master);
      this.sfxBus = this.ctx.createGain();
      this.sfxBus.gain.value = 0.9;
      this.sfxBus.connect(this.master);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  setMuted(muted: boolean): void {
    this.enabled = !muted;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(muted ? 0 : 0.7, this.ctx.currentTime, 0.05);
    }
  }
}

const core = new AudioCore();

/** Must be called from a user gesture (tap) to unlock audio on mobile. */
export function unlockAudio(): void {
  core.ensure();
}

export function setMuted(muted: boolean): void {
  core.setMuted(muted);
}

/* ------------------------------------------------------------------------ */
/* Reusable synth voices                                                      */
/* ------------------------------------------------------------------------ */

interface VoiceOpts {
  type?: OscillatorType;
  freq: number;
  /** End frequency for pitch glide. */
  freqEnd?: number;
  dur: number;
  gain?: number;
  attack?: number;
  filterFreq?: number;
  filterQ?: number;
  bus?: GainNode | null;
  when?: number;
  /** Stereo position -1..1 — the score uses this for orchestral width. */
  pan?: number;
}

function voice(o: VoiceOpts): void {
  const ctx = core.ensure();
  if (!ctx) return;
  const bus = o.bus ?? core.sfxBus;
  if (!bus) return;
  const t0 = o.when ?? ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = o.type ?? 'sine';
  osc.frequency.setValueAtTime(o.freq, t0);
  if (o.freqEnd !== undefined) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.freqEnd), t0 + o.dur);
  }
  const g = ctx.createGain();
  const attack = o.attack ?? 0.008;
  const peak = o.gain ?? 0.2;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(peak, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);

  let head: AudioNode = osc;
  if (o.filterFreq) {
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = o.filterFreq;
    f.Q.value = o.filterQ ?? 1;
    head.connect(f);
    head = f;
  }
  head.connect(g);
  if (o.pan && typeof ctx.createStereoPanner === 'function') {
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, o.pan));
    g.connect(p);
    p.connect(bus);
  } else {
    g.connect(bus);
  }
  osc.start(t0);
  osc.stop(t0 + o.dur + 0.05);
}

let noiseBuffer: AudioBuffer | null = null;
function getNoise(ctx: AudioContext): AudioBuffer {
  if (!noiseBuffer) {
    noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  return noiseBuffer;
}

interface NoiseOpts {
  dur: number;
  gain?: number;
  filterFreq?: number;
  filterType?: BiquadFilterType;
  filterEnd?: number;
  bus?: GainNode | null;
  when?: number;
}

function noise(o: NoiseOpts): void {
  const ctx = core.ensure();
  if (!ctx) return;
  const bus = o.bus ?? core.sfxBus;
  if (!bus) return;
  const t0 = o.when ?? ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = getNoise(ctx);
  src.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = o.filterType ?? 'lowpass';
  f.frequency.setValueAtTime(o.filterFreq ?? 1200, t0);
  if (o.filterEnd !== undefined) {
    f.frequency.exponentialRampToValueAtTime(Math.max(30, o.filterEnd), t0 + o.dur);
  }
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(o.gain ?? 0.15, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
  src.connect(f);
  f.connect(g);
  g.connect(bus);
  src.start(t0);
  src.stop(t0 + o.dur + 0.05);
}

/* ------------------------------------------------------------------------ */
/* Species SFX profiles                                                       */
/* ------------------------------------------------------------------------ */
/* Species voices — warriors are the BATTLE DRUMLINE                         */
/*                                                                            */
/* The soundtrack carries melody, harmony and pulse. Warriors add percussion  */
/* and rhythm that sits on that pulse: bass thuds for titans, cracks for      */
/* strikers, ticks for swarms, and a sustained buzz bed for bees. Animal      */
/* vocal colour is reserved for deploy entrances and rare punctuation — not   */
/* every swing — so a full fight stays beautiful instead of muddy.            */
/* ------------------------------------------------------------------------ */

type SfxFn = (when?: number) => void;

function nowOr(when?: number): number {
  return when ?? (core.ctx?.currentTime ?? 0);
}

/** Soft pitch/gain jitter so repeated hits don't machine-gun. */
function varN(base: number, spread = 0.04): number {
  return base * (1 + (Math.random() * 2 - 1) * spread);
}

const SPECIES_SFX: Record<SpeciesId, { spawn: SfxFn; attack: SfxFn }> = {
  trex: {
    // Entrance: short sub roar under a ceremonial drum — then the kit takes over.
    spawn: (when) => {
      const t = nowOr(when);
      voice({ type: 'sine', freq: 72, freqEnd: 38, dur: 0.55, gain: 0.42, when: t });
      noise({ dur: 0.22, gain: 0.2, filterFreq: 700, filterEnd: 120, when: t });
      voice({ type: 'sawtooth', freq: 90, freqEnd: 48, dur: 0.45, gain: 0.12, filterFreq: 220, attack: 0.04, when: t + 0.04 });
    },
    // Kick / taiko: BOOM
    attack: (when) => {
      const t = nowOr(when);
      voice({ type: 'sine', freq: varN(78), freqEnd: 36, dur: 0.32, gain: varN(0.44, 0.06), when: t });
      noise({ dur: 0.12, gain: 0.22, filterFreq: 900, filterEnd: 160, when: t });
    },
  },
  lion: {
    spawn: (when) => {
      const t = nowOr(when);
      voice({ type: 'sawtooth', freq: 150, freqEnd: 100, dur: 0.4, gain: 0.18, filterFreq: 700, attack: 0.03, when: t });
      voice({ type: 'sine', freq: 110, freqEnd: 70, dur: 0.28, gain: 0.28, when: t + 0.05 });
      noise({ dur: 0.15, gain: 0.1, filterFreq: 800, filterEnd: 250, when: t });
    },
    // Mid tom: tom–TOM
    attack: (when) => {
      const t = nowOr(when);
      voice({ type: 'sine', freq: varN(160), freqEnd: 85, dur: 0.12, gain: 0.22, when: t });
      voice({ type: 'sine', freq: varN(140), freqEnd: 70, dur: 0.18, gain: 0.3, when: t + 0.07 });
      noise({ dur: 0.06, gain: 0.1, filterFreq: 1400, filterEnd: 400, when: t + 0.07 });
    },
  },
  eagle: {
    spawn: (when) => {
      const t = nowOr(when);
      // Brief cry on entrance only.
      voice({ type: 'triangle', freq: 1400, freqEnd: 2200, dur: 0.12, gain: 0.14, when: t });
      voice({ type: 'triangle', freq: 2000, freqEnd: 900, dur: 0.22, gain: 0.12, when: t + 0.1 });
      noise({ dur: 0.08, gain: 0.08, filterFreq: 4500, filterType: 'highpass', when: t + 0.08 });
    },
    // High peck: swoop — ting
    attack: (when) => {
      const t = nowOr(when);
      noise({ dur: 0.07, gain: 0.1, filterFreq: 5000, filterType: 'highpass', when: t });
      voice({ type: 'triangle', freq: varN(2100), freqEnd: 900, dur: 0.09, gain: 0.16, when: t + 0.04 });
    },
  },
  honeybadger: {
    spawn: (when) => {
      const t = nowOr(when);
      for (let i = 0; i < 3; i++) {
        voice({ type: 'square', freq: 380 + i * 40, freqEnd: 200, dur: 0.06, gain: 0.1, when: t + i * 0.05 });
      }
      noise({ dur: 0.1, gain: 0.08, filterFreq: 2500, filterType: 'bandpass', when: t });
    },
    // Snare double: crack-crack
    attack: (when) => {
      const t = nowOr(when);
      noise({ dur: 0.05, gain: varN(0.2, 0.08), filterFreq: 3500, filterType: 'bandpass', when: t });
      voice({ type: 'square', freq: varN(420), freqEnd: 180, dur: 0.06, gain: 0.12, when: t });
      noise({ dur: 0.045, gain: varN(0.16, 0.08), filterFreq: 3200, filterType: 'bandpass', when: t + 0.055 });
      voice({ type: 'square', freq: varN(480), freqEnd: 200, dur: 0.05, gain: 0.1, when: t + 0.055 });
    },
  },
  scorpion: {
    spawn: (when) => {
      const t = nowOr(when);
      for (let i = 0; i < 3; i++) {
        noise({ dur: 0.03, gain: 0.14, filterFreq: 2800, filterType: 'bandpass', when: t + i * 0.07 });
      }
    },
    // Metallic click → whip
    attack: (when) => {
      const t = nowOr(when);
      noise({ dur: 0.025, gain: 0.14, filterFreq: 3200, filterType: 'bandpass', when: t });
      noise({ dur: 0.02, gain: 0.1, filterFreq: 4000, filterType: 'bandpass', when: t + 0.04 });
      voice({ type: 'sine', freq: varN(1600), freqEnd: 140, dur: 0.1, gain: 0.22, when: t + 0.07 });
      noise({ dur: 0.04, gain: 0.14, filterFreq: 5500, filterType: 'highpass', when: t + 0.07 });
    },
  },
  fireants: {
    spawn: (when) => {
      const t = nowOr(when);
      for (let i = 0; i < 5; i++) {
        noise({ dur: 0.025, gain: 0.07, filterFreq: 3000, filterType: 'bandpass', when: t + i * 0.04 });
      }
    },
    // Castanet ticks: tik-tik-tik-tik
    attack: (when) => {
      const t = nowOr(when);
      for (let i = 0; i < 4; i++) {
        noise({
          dur: 0.022,
          gain: varN(0.09, 0.1),
          filterFreq: 2800 + i * 200,
          filterType: 'bandpass',
          when: t + i * 0.035,
        });
      }
    },
  },
  bear: {
    spawn: (when) => {
      const t = nowOr(when);
      voice({ type: 'sine', freq: 68, freqEnd: 40, dur: 0.5, gain: 0.36, when: t });
      noise({ dur: 0.2, gain: 0.14, filterFreq: 600, filterEnd: 140, when: t });
      voice({ type: 'sawtooth', freq: 95, freqEnd: 55, dur: 0.35, gain: 0.1, filterFreq: 280, attack: 0.05, when: t + 0.06 });
    },
    // Floor tom: THUD (optional double body-weight)
    attack: (when) => {
      const t = nowOr(when);
      noise({ dur: 0.1, gain: 0.16, filterFreq: 1100, filterEnd: 400, filterType: 'bandpass', when: t });
      voice({ type: 'sine', freq: varN(95), freqEnd: 42, dur: 0.28, gain: varN(0.38, 0.05), when: t + 0.05 });
    },
  },
  bighorn: {
    spawn: (when) => {
      const t = nowOr(when);
      voice({ type: 'triangle', freq: 200, freqEnd: 280, dur: 0.28, gain: 0.14, filterFreq: 700, when: t });
      voice({ type: 'sine', freq: 90, dur: 0.25, gain: 0.16, when: t });
      noise({ dur: 0.08, gain: 0.1, filterFreq: 1800, filterEnd: 500, when: t + 0.12 });
    },
    // Woodblock → stone: tok — GONG (short)
    attack: (when) => {
      const t = nowOr(when);
      voice({ type: 'square', freq: varN(220), freqEnd: 140, dur: 0.05, gain: 0.12, filterFreq: 900, when: t });
      voice({ type: 'sine', freq: varN(130), freqEnd: 55, dur: 0.2, gain: 0.28, when: t + 0.06 });
      noise({ dur: 0.07, gain: 0.14, filterFreq: 1600, filterEnd: 350, when: t + 0.06 });
    },
  },
  bees: {
    spawn: (when) => {
      const t = nowOr(when);
      // Hive swell on entrance — the sustained bed is handled by MusicDirector.
      voice({ type: 'sawtooth', freq: 210, freqEnd: 240, dur: 0.7, gain: 0.08, attack: 0.2, when: t });
      voice({ type: 'sawtooth', freq: 216, freqEnd: 246, dur: 0.7, gain: 0.07, attack: 0.22, when: t });
    },
    // Shaker crest + tiny stings: shhhhh — plik-plik
    attack: (when) => {
      const t = nowOr(when);
      noise({ dur: 0.14, gain: 0.1, filterFreq: 4000, filterEnd: 7000, filterType: 'bandpass', when: t });
      voice({ type: 'sine', freq: varN(1500), freqEnd: 1100, dur: 0.04, gain: 0.08, when: t + 0.1 });
      voice({ type: 'sine', freq: varN(1700), freqEnd: 1200, dur: 0.035, gain: 0.07, when: t + 0.14 });
    },
  },
  wolves: {
    spawn: (when) => {
      const t = nowOr(when);
      // Short howl colour on entrance only.
      voice({ type: 'sine', freq: 320, freqEnd: 520, dur: 0.45, gain: 0.12, attack: 0.1, when: t });
      voice({ type: 'sine', freq: 110, freqEnd: 80, dur: 0.2, gain: 0.14, when: t + 0.15 });
    },
    // Hand-drum: dum-da-da
    attack: (when) => {
      const t = nowOr(when);
      voice({ type: 'sine', freq: varN(175), freqEnd: 95, dur: 0.1, gain: 0.2, when: t });
      voice({ type: 'sine', freq: varN(200), freqEnd: 120, dur: 0.07, gain: 0.14, when: t + 0.06 });
      voice({ type: 'sine', freq: varN(190), freqEnd: 110, dur: 0.07, gain: 0.12, when: t + 0.11 });
      noise({ dur: 0.04, gain: 0.08, filterFreq: 2000, filterType: 'bandpass', when: t });
    },
  },
  porcupine: {
    spawn: (when) => {
      const t = nowOr(when);
      for (let i = 0; i < 4; i++) {
        noise({ dur: 0.025, gain: 0.09, filterFreq: 4200, filterType: 'bandpass', when: t + i * 0.04 });
      }
    },
    // Güiro scrape → wood tok
    attack: (when) => {
      const t = nowOr(when);
      noise({ dur: 0.08, gain: 0.12, filterFreq: 3500, filterEnd: 5500, filterType: 'bandpass', when: t });
      voice({ type: 'triangle', freq: varN(650), freqEnd: 400, dur: 0.06, gain: 0.1, when: t + 0.07 });
    },
  },
  beetles: {
    spawn: (when) => {
      const t = nowOr(when);
      noise({ dur: 0.35, gain: 0.1, filterFreq: 1800, filterEnd: 3200, filterType: 'bandpass', when: t });
      voice({ type: 'square', freq: 90, freqEnd: 120, dur: 0.25, gain: 0.05, when: t });
    },
    // Artillery: tok — POP — sss
    attack: (when) => {
      const t = nowOr(when);
      voice({ type: 'square', freq: varN(160), freqEnd: 90, dur: 0.04, gain: 0.08, filterFreq: 600, when: t });
      voice({ type: 'square', freq: varN(200), freqEnd: 55, dur: 0.08, gain: 0.22, when: t + 0.05 });
      noise({ dur: 0.28, gain: 0.14, filterFreq: 2800, filterEnd: 600, when: t + 0.05 });
    },
  },
};

/* ------------------------------------------------------------------------ */
/* Ceremonial tones — the game's "result" language. Austere and low:         */
/* great drums and dark string drones, never bright arpeggiated chimes.      */
/* ------------------------------------------------------------------------ */

/** One strike of a great ceremonial drum: deep skin hit, sub-octave weight
 *  and a short room bloom. The backbone of every verdict sound. */
function greatDrum(dur = 1.0, gain = 0.5, when = 0, pitch = 72): void {
  const t = when || (core.ctx?.currentTime ?? 0);
  voice({ type: 'sine', freq: pitch, freqEnd: pitch * 0.44, dur, gain, when: t });
  voice({ type: 'triangle', freq: pitch * 0.5, freqEnd: pitch * 0.3, dur: dur * 1.25, gain: gain * 0.5, when: t });
  noise({ dur: Math.min(0.3, dur * 0.35), gain: gain * 0.35, filterFreq: 700, filterEnd: 120, when: t });
}

/** A dark low drone — bowed cellos in a stone hall. Slow swell, heavy
 *  lowpass, gentle detune; no shimmer, no sparkle. */
function drone(freqs: number[], dur: number, gain: number, when = 0): void {
  const t = when || (core.ctx?.currentTime ?? 0);
  for (const f of freqs) {
    voice({ type: 'sawtooth', freq: f, dur, gain, filterFreq: Math.max(220, f * 2.4), attack: dur * 0.28, when: t, pan: -0.16 });
    voice({ type: 'sawtooth', freq: f * 1.005, dur, gain: gain * 0.7, filterFreq: Math.max(180, f * 2), attack: dur * 0.34, when: t, pan: 0.16 });
  }
}

/* ------------------------------------------------------------------------ */
/* Global / spell SFX                                                         */
/* ------------------------------------------------------------------------ */

const GLOBAL_SFX = {
  lavaTelegraph: () => {
    voice({ type: 'sine', freq: 60, freqEnd: 45, dur: 1.1, gain: 0.3, attack: 0.2 });
    voice({ type: 'triangle', freq: 1200, freqEnd: 400, dur: 1.0, gain: 0.06, attack: 0.4 });
  },
  lavaStrike: () => {
    voice({ type: 'sine', freq: 120, freqEnd: 28, dur: 1.2, gain: 0.5 });
    noise({ dur: 1.4, gain: 0.4, filterFreq: 3000, filterEnd: 100 });
    voice({ type: 'sawtooth', freq: 80, freqEnd: 30, dur: 0.9, gain: 0.3, filterFreq: 200 });
  },
  sulfur: () => {
    noise({ dur: 1.2, gain: 0.16, filterFreq: 600, filterEnd: 1600, filterType: 'bandpass' });
  },
  thicket: () => {
    noise({ dur: 0.8, gain: 0.14, filterFreq: 2500, filterEnd: 5000, filterType: 'highpass' });
    voice({ type: 'triangle', freq: 500, freqEnd: 800, dur: 0.5, gain: 0.08 });
  },
  death: () => {
    voice({ type: 'triangle', freq: 300, freqEnd: 60, dur: 0.4, gain: 0.16 });
  },
  heal: () => {
    // A low, breath-like restorative swell — no rising chime.
    voice({ type: 'sine', freq: 220, freqEnd: 262, dur: 0.5, gain: 0.09, attack: 0.16 });
    voice({ type: 'sine', freq: 330, dur: 0.5, gain: 0.05, attack: 0.2 });
  },
  lotusBurst: () => {
    // Watery bloom: soft mid-register bubble and spray, kept dark.
    voice({ type: 'sine', freq: 330, freqEnd: 494, dur: 0.35, gain: 0.09, attack: 0.05 });
    noise({ dur: 0.4, gain: 0.1, filterFreq: 2400, filterType: 'bandpass' });
  },
  splash: () => {
    // Acid burst: sizzling impact.
    noise({ dur: 0.5, gain: 0.22, filterFreq: 2600, filterEnd: 500 });
    voice({ type: 'sine', freq: 300, freqEnd: 90, dur: 0.3, gain: 0.18 });
  },
  obeliskHit: () => {
    // Pure stone thud — dull rock knock, no ring.
    voice({ type: 'sine', freq: 140, freqEnd: 55, dur: 0.28, gain: 0.24 });
    noise({ dur: 0.2, gain: 0.14, filterFreq: 900, filterEnd: 300 });
  },
  obeliskDown: () => {
    // Tower collapse: deep rumble + cascading rubble.
    const t = core.ctx?.currentTime ?? 0;
    voice({ type: 'sine', freq: 90, freqEnd: 24, dur: 1.6, gain: 0.5 });
    noise({ dur: 1.8, gain: 0.4, filterFreq: 1800, filterEnd: 80 });
    [500, 380, 300, 210].forEach((f, i) => {
      voice({ type: 'triangle', freq: f, freqEnd: f * 0.5, dur: 0.35, gain: 0.12, when: t + 0.15 + i * 0.16 });
    });
  },
  pondClaimed: () => {
    // The water changes hands: one deep drum and a low open fifth held
    // underneath — a solemn territorial declaration, no sparkle.
    const t = core.ctx?.currentTime ?? 0;
    greatDrum(1.0, 0.5, t);
    drone([73.4, 110], 2.2, 0.06, t + 0.05); // D2 + A2
  },
  blessing: () => {
    // A blessing in this world has weight: a soft low swell with one
    // restrained overtone rising out of it — not a tinkling arpeggio.
    const t = core.ctx?.currentTime ?? 0;
    drone([110, 146.8, 220], 2.4, 0.045, t);
    voice({ type: 'sine', freq: 440, dur: 1.4, gain: 0.045, attack: 0.5, when: t + 0.3 });
  },
  ui: () => {
    voice({ type: 'sine', freq: 700, freqEnd: 900, dur: 0.07, gain: 0.1 });
  },
  deployDrag: () => {
    voice({ type: 'sine', freq: 300, freqEnd: 420, dur: 0.06, gain: 0.06 });
  },
  error: () => {
    voice({ type: 'square', freq: 180, freqEnd: 120, dur: 0.15, gain: 0.1 });
  },
  victory: () => {
    // Triumph, austere: three slow ceremonial drum strikes, the last and
    // deepest landing as the dark drone finally opens into a major third —
    // earned and grave, not sugary.
    const t = core.ctx?.currentTime ?? 0;
    greatDrum(1.0, 0.48, t);
    greatDrum(1.0, 0.54, t + 0.55);
    greatDrum(1.7, 0.64, t + 1.1, 62);
    drone([73.4, 110], 1.8, 0.055, t);                    // D2 + A2
    drone([73.4, 110, 146.8, 185], 3.4, 0.06, t + 1.05);  // + D3 + F#3
  },
  defeat: () => {
    // The fall: two muffled drum hits and a drone that sinks a half-step
    // into the dark and never resolves.
    const t = core.ctx?.currentTime ?? 0;
    greatDrum(1.2, 0.42, t, 58);
    greatDrum(2.2, 0.5, t + 0.75, 48);
    drone([73.4, 87.3], 1.6, 0.055, t);         // D2 + F2 (minor)
    drone([69.3, 82.4], 3.6, 0.05, t + 1.25);   // sinks to C#2 + E2
  },
};

export function playUi(kind: 'tap' | 'drag' | 'error' = 'tap'): void {
  if (kind === 'tap') GLOBAL_SFX.ui();
  else if (kind === 'drag') GLOBAL_SFX.deployDrag();
  else GLOBAL_SFX.error();
}

export function playResult(win: boolean): void {
  (win ? GLOBAL_SFX.victory : GLOBAL_SFX.defeat)();
}

/* Direct species hooks for the Duels mode stage (immediate — not battle-grid). */

export function playSpeciesAttack(sp: SpeciesId): void {
  if (core.enabled) SPECIES_SFX[sp].attack();
}

export function playSpeciesSpawn(sp: SpeciesId): void {
  if (core.enabled) SPECIES_SFX[sp].spawn();
}

export function playKo(): void {
  if (core.enabled) GLOBAL_SFX.death();
}

/* ------------------------------------------------------------------------ */
/* Event router — the game loop feeds sim events straight in                  */
/* ------------------------------------------------------------------------ */

/** Schedule a warrior hit on the shared musical grid.
 *  Sim ticks are phase-locked to 8ths, so nearest-16th is ~0 error and we
 *  never escape off-grid (the old ≤80 ms soft-quantize could). */
function quantizeAttackWhen(): number {
  const ctx = core.ctx ?? (core.enabled ? core.ensure() : null);
  if (!ctx) return 0;
  return music.quantizeWhenNearest(ctx.currentTime);
}

export function handleGameEvents(events: GameEvent[]): void {
  if (!core.enabled) return;
  // Prefer combat punctuation when the field is busy so spells/heals don't
  // starve the drumline — and raise the budget for late staged armies.
  const rank = (e: GameEvent): number => {
    switch (e.type) {
      case 'attack':
      case 'spawn':
      case 'shoot':
        return 0;
      case 'spellCast':
      case 'lavaTelegraph':
      case 'lavaStrike':
      case 'obeliskDown':
        return 1;
      default:
        return 2;
    }
  };
  const ordered = events.length > 1 ? [...events].sort((a, b) => rank(a) - rank(b)) : events;
  let budget = 12;
  const attackHeard = new Set<SpeciesId>();
  for (const e of ordered) {
    if (budget <= 0) break;
    switch (e.type) {
      case 'spawn':
        // Entrances fire immediately — a new instrument joining the mix.
        SPECIES_SFX[e.species].spawn();
        budget--;
        break;
      case 'attack': {
        // One voice per species per tick once budget is tight — keeps the
        // kit readable instead of a mush of identical hits.
        if (attackHeard.has(e.species) && budget < 5) break;
        attackHeard.add(e.species);
        SPECIES_SFX[e.species].attack(quantizeAttackWhen());
        budget--;
        break;
      }
      case 'death':
        GLOBAL_SFX.death();
        budget--;
        break;
      case 'spellCast':
        if (e.spell === 'sulfur') GLOBAL_SFX.sulfur();
        else if (e.spell === 'thicket') GLOBAL_SFX.thicket();
        budget--;
        break;
      case 'lavaTelegraph':
        GLOBAL_SFX.lavaTelegraph();
        budget--;
        break;
      case 'lavaStrike':
        GLOBAL_SFX.lavaStrike();
        budget--;
        break;
      case 'lotusBurst':
        GLOBAL_SFX.lotusBurst();
        budget--;
        break;
      case 'shoot':
        SPECIES_SFX.beetles.attack(quantizeAttackWhen());
        budget--;
        break;
      case 'splash':
        GLOBAL_SFX.splash();
        budget--;
        break;
      case 'heal':
        GLOBAL_SFX.heal();
        budget--;
        break;
      case 'blessing':
        GLOBAL_SFX.blessing();
        budget--;
        break;
      case 'obeliskHit':
        GLOBAL_SFX.obeliskHit();
        budget--;
        break;
      case 'obeliskDown':
        GLOBAL_SFX.obeliskDown();
        budget--;
        break;
      case 'pondClaimed':
        GLOBAL_SFX.pondClaimed();
        budget--;
        break;
      default:
        break;
    }
  }
}

/* ------------------------------------------------------------------------ */
/* Generative soundtrack — a Zimmer-inspired hybrid-orchestral synth score    */
/*                                                                            */
/* Signature elements, all synthesized:                                       */
/*   BRAAM      massive detuned-saw brass hit through an opening filter       */
/*   OSTINATO   relentless 16th-note string figure in D minor                 */
/*   TAIKO      pitch-dropped drum hits with noise skin                       */
/*   PULSE      sub-bass heartbeat                                            */
/*   CHOIR PAD  formant-filtered detuned pad                                  */
/*   RISER      tension sweep for the phase transition                        */
/* A generated-impulse convolver gives the whole score a hall tail.           */
/* ------------------------------------------------------------------------ */

export type MusicMode = 'menu' | 'intro' | 'basalt' | 'transition' | 'oasis' | 'ended';

class MusicDirector {
  private running = false;
  private mode: MusicMode = 'menu';
  private bus: GainNode | null = null;
  private reverb: ConvolverNode | null = null;
  private reverbGain: GainNode | null = null;
  private nextNoteTime = 0;
  private step = 0;
  private schedTimer: ReturnType<typeof setInterval> | null = null;
  private intensity = 0.35;
  /** Smooth target for intensity — act floors + army density blend here. */
  private intensityTarget = 0.35;
  /** Basalt elapsed seconds (0 at Phase 1 start). */
  private basaltElapsed = 0;
  /** True while any bee swarm is alive — sustains the hive buzz bed. */
  private beePresence = false;
  /** Species currently alive — drives soft in-key presence beds. */
  private presenceSpecies = new Set<SpeciesId>();
  /** 0 = Act1 front ensemble (0–2:00), 1 = Act2 full corps (2–4:00), 2 = Act3 apex. */
  private actTier = 0;
  /** Music-bus volume multiplier (ensemble weight across acts). */
  private volumeMul = 1.08;
  private volumeTarget = 1.08;
  /** Grid origin aligned when music starts (SFX + tick phase-lock share this). */
  private gridOrigin = 0;
  /** Skip the 4:50 climax crest when Phase 1 ended early by double-raze. */
  private allowClimax = true;

  /** AudioContext currentTime when a context exists (even if muted). */
  audioNow(): number | null {
    if (core.ctx) return core.ctx.currentTime;
    if (!core.enabled) return null;
    return core.ensure()?.currentTime ?? null;
  }

  /** Soundtrack grid origin in AudioContext seconds (0 if not started). */
  gridOriginTime(): number {
    return this.gridOrigin;
  }

  /**
   * Phase origin for TickDriver: audio time of battle tick 0.
   * Tick k should fire at origin + k * MUSIC_TICK_SEC, landing on 8ths.
   * Floors "now" onto the last 8th so the first step waits ~one tick — same
   * cadence as the old setInterval(300) lead-in.
   */
  battleTickPhase(): { now: number; origin: number } | null {
    const now = this.audioNow();
    if (now == null) return null;
    const g = this.gridOrigin || now;
    const origin = g + Math.floor((now - g) / MUSIC_TICK_SEC) * MUSIC_TICK_SEC;
    return { now, origin };
  }

  /** Snap a time down onto the nearest past-or-equal 8th of the music grid. */
  alignToTickGrid(t: number): number {
    const g = this.gridOrigin || t;
    return g + Math.floor((t - g) / MUSIC_TICK_SEC + 1e-9) * MUSIC_TICK_SEC;
  }

  /* D natural minor. Frequencies for the ostinato register (D3-based). */
  private static OSTINATO: number[][] = [
    // Four 1-bar cells (16 sixteenths each), Dm -> Bb -> Gm -> A.
    [146.8, 146.8, 220, 146.8, 174.6, 146.8, 220, 174.6, 146.8, 146.8, 220, 146.8, 174.6, 220, 174.6, 146.8],
    [116.5, 116.5, 174.6, 116.5, 146.8, 116.5, 174.6, 146.8, 116.5, 116.5, 174.6, 116.5, 146.8, 174.6, 146.8, 116.5],
    [98, 98, 146.8, 98, 116.5, 98, 146.8, 116.5, 98, 98, 146.8, 98, 116.5, 146.8, 116.5, 98],
    [110, 110, 164.8, 110, 138.6, 110, 164.8, 138.6, 110, 110, 164.8, 110, 138.6, 164.8, 138.6, 110],
  ];

  private static BASS = [36.7, 29.1, 24.5, 27.5]; // D1 Bb0 G0 A0
  /** Cello bed roots, one octave above the sub bass (D2 Bb1 G1 A1). */
  private static CELLO = [73.4, 58.3, 49, 55];
  /** Oasis: D dorian, hopeful. Pad chords + soaring line. */
  private static OASIS_PADS: number[][] = [
    [146.8, 220, 293.7, 440], // Dm add9
    [174.6, 261.6, 349.2, 523.3], // F
    [196, 293.7, 392, 587.3], // G
    [164.8, 246.9, 329.6, 493.9], // Em
  ];
  private static OASIS_LEAD = [587.3, 523.3, 440, 523.3, 587.3, 659.3, 587.3, 880];

  /**
   * Act 3 sustained harmony cells (D minor tapestry):
   * Dm(add2), Asus4, A (4–3 resolve), Bbmaj7, F, Dm7.
   */
  private static APEX_CHORDS: number[][] = [
    [146.8, 164.8, 220, 293.7],       // Dm add2
    [110, 146.8, 164.8, 220],         // Asus4 (D = sus4)
    [110, 138.6, 164.8, 220],         // A (4→3: D resolves to C#)
    [116.5, 174.6, 233.1, 349.2],     // Bbmaj7
    [174.6, 220, 261.6, 349.2],       // F
    [146.8, 220, 261.6, 349.2],       // Dm7
  ];

  /** The Vaalbara motif — a rising D-minor horn theme threaded through the
   *  intro, the menu and both battle phases. [16th-step, freq, dur-steps]. */
  private static THEME: Array<[number, number, number]> = [
    [0, 293.66, 4],   // D4
    [4, 349.23, 4],   // F4
    [8, 329.63, 2],   // E4
    [10, 293.66, 2],  // D4
    [12, 440, 8],     // A4 — the reach
    [20, 466.16, 4],  // Bb4
    [24, 440, 2],     // A4
    [26, 392, 2],     // G4
    [28, 349.23, 4],  // F4 — settle
  ];

  start(): void {
    const ctx = core.ensure();
    if (!ctx || !core.musicBus || this.running) return;
    this.running = true;
    this.bus = ctx.createGain();
    this.bus.gain.value = 1;
    this.bus.connect(core.musicBus);
    // Hall reverb from a generated impulse.
    if (!this.reverb) {
      this.reverb = ctx.createConvolver();
      this.reverb.buffer = makeImpulse(ctx, 3.6, 2.4);
      this.reverbGain = ctx.createGain();
      this.reverbGain.gain.value = 0.45;
      this.reverb.connect(this.reverbGain);
      this.reverbGain.connect(core.musicBus);
    }
    this.bus.connect(this.reverb);
    this.nextNoteTime = ctx.currentTime + 0.08;
    this.gridOrigin = this.nextNoteTime;
    this.step = 0;
    // 100 BPM: 16th = MUSIC_16TH_SEC; 8th = MUSIC_TICK_SEC (= one sim tick).
    this.schedTimer = setInterval(() => this.schedule(), 70);
  }

  stop(): void {
    this.running = false;
    if (this.schedTimer) clearInterval(this.schedTimer);
    this.schedTimer = null;
    this.rideSfxBus(0.9);
    this.rideReverb(0.45);
    const ctx = core.ctx;
    if (ctx && this.bus) {
      this.bus.gain.setTargetAtTime(0, ctx.currentTime, 0.4);
      const bus = this.bus;
      setTimeout(() => bus.disconnect(), 1800);
      this.bus = null;
    }
  }

  setMode(mode: MusicMode): void {
    if (mode === this.mode) return;
    const prev = this.mode;
    this.mode = mode;
    // Punctuate big scene changes — same transition vocabulary as before.
    if (mode === 'transition') {
      // Early double-raze before 4:50: skip climax crest, hand the energy
      // straight to the existing riser so the march still feels continuous.
      if (prev === 'basalt' && this.basaltElapsed < 290) {
        this.allowClimax = false;
      }
      this.riser(2.4);
      this.intensityTarget = Math.max(this.intensity * 0.85, 0.45);
      this.volumeTarget = 1; // settle before Oasis — no lingering climax loudness
      this.actTier = 0;
      this.rideSfxBus(0.9);
      this.rideReverb(0.45);
    } else if (mode === 'oasis' && prev === 'transition') {
      this.braam(220, 1.4, 0.5);
      this.intensityTarget = 0.4;
      this.volumeTarget = 1;
      this.actTier = 0;
      this.rideSfxBus(0.9);
      this.rideReverb(0.45);
    } else if (mode === 'basalt') {
      this.braam(146.8, 1.6, 0.48);
      this.allowClimax = true;
      this.basaltElapsed = 0;
      this.intensityTarget = 0.52;
      this.volumeTarget = 1.08; // front-ensemble open — finales earn the crest
      this.actTier = 0;
      this.rideSfxBus(0.92);
      this.rideReverb(0.45);
    }
  }

  /**
   * Drive Basalt act intensity from the Phase 1 clock; army only tints.
   * 2–2–1 book: Act1 0–2:00, Act2 2–4:00, Act3 4–5:00 (additive apex).
   * Army density adds a small color bump — audio only, no sim change.
   */
  setBattlePulse(opts: {
    phase: MusicMode;
    basaltElapsedSec: number;
    unitCount: number;
    beesAlive: boolean;
    speciesAlive?: SpeciesId[];
  }): void {
    this.beePresence = opts.beesAlive;
    this.presenceSpecies = new Set(opts.speciesAlive ?? []);
    if (opts.phase === 'basalt') {
      this.basaltElapsed = opts.basaltElapsedSec;
      const floor = this.actFloor(opts.basaltElapsedSec);
      const army = Math.min(1, opts.unitCount / 18);
      this.intensityTarget = Math.min(1, floor + army * 0.14);
      this.volumeTarget = this.actVolume(opts.basaltElapsedSec);
      // 2–2–1
      this.actTier = opts.basaltElapsedSec < 120 ? 0 : opts.basaltElapsedSec < 240 ? 1 : 2;
      this.rideSfxBus(this.actTier === 0 ? 0.92 : this.actTier === 1 ? 1.0 : 1.04);
      this.rideReverb(this.actTier >= 2 ? 0.56 : 0.45);
    } else if (opts.phase === 'oasis') {
      const army = Math.min(1, opts.unitCount / 18);
      this.intensityTarget = Math.min(1, 0.38 + army * 0.45);
      this.volumeTarget = 1;
      this.actTier = 0;
      this.rideSfxBus(0.9);
      this.rideReverb(0.45);
    } else if (opts.phase === 'transition') {
      this.volumeTarget = 1;
      this.actTier = 0;
      this.rideSfxBus(0.9);
      this.rideReverb(0.45);
    }
  }

  /** @deprecated Prefer setBattlePulse — kept for cinematic/menu callers. */
  setIntensity(v: number): void {
    this.intensityTarget = Math.max(0, Math.min(1, v));
  }

  /** Snap `when` forward onto the next 16th-note grid line, capped at maxDelay.
   *  Prefer quantizeWhenNearest for warrior hits now that ticks are phase-locked. */
  quantizeWhen(when: number, maxDelay = 0.08): number {
    const STEP = MUSIC_16TH_SEC;
    const origin = this.gridOrigin || when;
    const steps = Math.ceil((when - origin) / STEP - 1e-9);
    const snapped = origin + Math.max(0, steps) * STEP;
    const delay = snapped - when;
    if (delay < 0) return when;
    if (delay > maxDelay) return when; // too far — don't lag the hit
    return snapped;
  }

  /** Nearest 16th on the soundtrack grid — no off-grid escape hatch. */
  quantizeWhenNearest(when: number): number {
    const STEP = MUSIC_16TH_SEC;
    const origin = this.gridOrigin || when;
    const steps = Math.round((when - origin) / STEP);
    return origin + Math.max(0, steps) * STEP;
  }

  /** Act intensity floor — 2–2–1 smoothstep ramps. */
  private actFloor(elapsed: number): number {
    const ease = (a: number, b: number, t: number) => {
      const x = Math.max(0, Math.min(1, t));
      const s = x * x * (3 - 2 * x);
      return a + (b - a) * s;
    };
    // Act 1 — front ensemble (0–2:00)
    if (elapsed < 120) return 0.52;
    // Act 2 — full corps (2–4:00)
    if (elapsed < 240) return ease(0.52, 0.78, (elapsed - 120) / 12);
    // Act 3 — additive apex (4–5:00)
    if (elapsed < 290) return ease(0.78, 0.9, (elapsed - 240) / 12);
    if (!this.allowClimax) return 0.9;
    return ease(0.9, 0.96, (elapsed - 290) / 5);
  }

  /** Music-bus volume — bloom into Act 3 awe without crushing. */
  private actVolume(elapsed: number): number {
    const ease = (a: number, b: number, t: number) => {
      const x = Math.max(0, Math.min(1, t));
      const s = x * x * (3 - 2 * x);
      return a + (b - a) * s;
    };
    if (elapsed < 120) return 1.08;
    if (elapsed < 132) return ease(1.08, 1.22, (elapsed - 120) / 12);
    if (elapsed < 240) return 1.22;
    if (elapsed < 252) return ease(1.22, 1.3, (elapsed - 240) / 12);
    if (elapsed < 290) return 1.3;
    if (!this.allowClimax) return 1.3;
    return ease(1.3, 1.36, (elapsed - 290) / 5);
  }

  /** Ease intensity + volume toward targets each scheduler slice. */
  private tickIntensity(): void {
    const d = this.intensityTarget - this.intensity;
    this.intensity += d * 0.12;
    const vd = this.volumeTarget - this.volumeMul;
    this.volumeMul += vd * 0.1;
    if (this.bus && core.ctx) {
      // Soft cap near 1.45 so finale crest stays powerful without harsh clip.
      const g = Math.min(1.45, Math.max(0.0001, this.volumeMul));
      this.bus.gain.setTargetAtTime(g, core.ctx.currentTime, 0.08);
    }
  }

  /** Warrior drumline bus — rises with the corps so battery sits in the mix. */
  private rideSfxBus(gain: number): void {
    if (!core.sfxBus || !core.ctx) return;
    core.sfxBus.gain.setTargetAtTime(Math.max(0.0001, gain), core.ctx.currentTime, 0.12);
  }

  /** Hall send — wider brass/choir space in the finale. */
  private rideReverb(gain: number): void {
    if (!this.reverbGain || !core.ctx) return;
    this.reverbGain.gain.setTargetAtTime(Math.max(0.0001, gain), core.ctx.currentTime, 0.2);
  }

  /**
   * Soft in-key presence beds for living species. One slot per species,
   * capped, scheduled on the 16th grid — color under the drumline, not a
   * second melody fighting the ostinato.
   */
  private playPresence(t: number, s16: number, bar: number): void {
    // Presence rides from Act 0 (front ensemble) onward — color under the book.
    if (!this.bus) return;
    if (this.mode !== 'basalt' && this.mode !== 'intro') return;
    const thick = this.actTier >= 2 ? 1.5 : this.actTier >= 1 ? 1.35 : 1;
    const g = (0.016 + this.intensity * 0.012) * thick;

    type Role = 'titan' | 'command' | 'swarm' | 'air' | 'siege' | 'skirmish';
    const roleOf = (sp: SpeciesId): Role => {
      if (sp === 'trex' || sp === 'bear') return 'titan';
      if (sp === 'lion' || sp === 'bighorn') return 'command';
      if (sp === 'fireants' || sp === 'porcupine') return 'swarm';
      if (sp === 'eagle' || sp === 'bees') return 'air';
      if (sp === 'beetles') return 'siege';
      return 'skirmish';
    };
    const prio: Record<Role, number> = { titan: 0, air: 1, swarm: 2, command: 3, siege: 4, skirmish: 5 };
    const picked: SpeciesId[] = [];
    const seen = new Set<Role>();
    const ordered = [...this.presenceSpecies].sort((a, b) => prio[roleOf(a)] - prio[roleOf(b)]);
    for (const sp of ordered) {
      const r = roleOf(sp);
      if (r === 'air' && sp === 'bees') continue; // bee buzz bed already handles hive
      if (seen.has(r) && r !== 'air') continue;
      seen.add(r);
      picked.push(sp);
      if (picked.length >= 4) break;
    }

    for (const sp of picked) {
      const role = roleOf(sp);
      if (role === 'titan' && s16 === 0) {
        // Low D–A open fifth under the taiko.
        voice({ type: 'sine', freq: 73.4, dur: 1.8, gain: g * 0.9, attack: 0.2, bus: this.bus, when: t, pan: -0.15 });
        voice({ type: 'triangle', freq: 110, dur: 1.8, gain: g * 0.55, attack: 0.25, bus: this.bus, when: t, pan: 0.15 });
        if (this.actTier >= 1 && bar % 2 === 0) {
          voice({ type: 'sawtooth', freq: 146.8, dur: 0.9, gain: g * 0.22, filterFreq: 420, attack: 0.08, bus: this.bus, when: t });
        }
      } else if (role === 'command' && bar % 4 === 0 && s16 === 0) {
        // Short F–A–D fragment, scale-locked.
        voice({ type: 'triangle', freq: 174.6, dur: 0.28, gain: g * 0.7, attack: 0.02, bus: this.bus, when: t, pan: -0.2 });
        voice({ type: 'triangle', freq: 220, dur: 0.28, gain: g * 0.55, attack: 0.02, bus: this.bus, when: t + 0.15, pan: 0.1 });
        voice({ type: 'triangle', freq: 293.7, dur: 0.4, gain: g * 0.45, attack: 0.02, bus: this.bus, when: t + 0.3, pan: 0.2 });
      } else if (role === 'swarm' && s16 % 4 === 2) {
        // Quiet scale ticks on offbeats — dust, not a lead.
        voice({ type: 'triangle', freq: s16 === 2 ? 293.7 : 349.2, dur: 0.05, gain: g * 0.35, bus: this.bus, when: t });
      } else if (role === 'air' && s16 === 8) {
        this.shimmer(t, 587.3, 1.4, g * 0.55);
      } else if (role === 'siege' && s16 === 0 && bar % 2 === 1) {
        voice({ type: 'sine', freq: 98, dur: 1.2, gain: g * 0.5, attack: 0.15, bus: this.bus, when: t, pan: 0.25 });
        voice({ type: 'triangle', freq: 146.8, dur: 1.0, gain: g * 0.28, attack: 0.18, bus: this.bus, when: t });
      } else if (role === 'skirmish' && this.actTier >= 1 && bar % 4 === 2 && s16 === 0) {
        voice({ type: 'triangle', freq: 220, dur: 0.35, gain: g * 0.4, attack: 0.03, bus: this.bus, when: t, pan: -0.25 });
        voice({ type: 'triangle', freq: 330, dur: 0.35, gain: g * 0.28, attack: 0.03, bus: this.bus, when: t, pan: 0.25 });
      }
    }
  }

  /** Hive buzz bed — soft detuned drones while bees are on the field. */
  private beeBuzz(t: number, inten: number): void {
    if (!this.bus || !this.beePresence) return;
    const g = 0.018 + inten * 0.014;
    voice({ type: 'sawtooth', freq: 220, dur: 0.32, gain: g, attack: 0.08, filterFreq: 900, bus: this.bus, when: t, pan: -0.25 });
    voice({ type: 'sawtooth', freq: 233, dur: 0.32, gain: g * 0.85, attack: 0.1, filterFreq: 1100, bus: this.bus, when: t, pan: 0.25 });
    voice({ type: 'triangle', freq: 440, dur: 0.28, gain: g * 0.35, attack: 0.12, bus: this.bus, when: t });
  }

  /** The Zimmer hit — public so the cinematic can score its reveals. */
  braam(freq = 73.4, dur = 1.8, gain = 0.5): void {
    const ctx = core.ensure();
    if (!ctx || !this.bus) return;
    const t0 = ctx.currentTime;
    const out = ctx.createGain();
    out.gain.setValueAtTime(0.0001, t0);
    out.gain.exponentialRampToValueAtTime(gain, t0 + dur * 0.28);
    out.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(160, t0);
    lp.frequency.exponentialRampToValueAtTime(900, t0 + dur * 0.4);
    lp.frequency.exponentialRampToValueAtTime(220, t0 + dur);
    lp.Q.value = 1.2;
    lp.connect(out);
    out.connect(this.bus);
    for (const cents of [-12, -5, 0, 6, 13]) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = freq * Math.pow(2, cents / 1200);
      osc.connect(lp);
      osc.start(t0);
      osc.stop(t0 + dur + 0.1);
    }
    // Sub octave reinforcement.
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.value = freq / 2;
    const subG = ctx.createGain();
    subG.gain.setValueAtTime(0.0001, t0);
    subG.gain.exponentialRampToValueAtTime(gain * 0.8, t0 + dur * 0.3);
    subG.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    sub.connect(subG);
    subG.connect(this.bus);
    sub.start(t0);
    sub.stop(t0 + dur + 0.1);
  }

  /** Rising tension sweep (phase transition, cinematic climax). */
  riser(dur = 2.0): void {
    const ctx = core.ensure();
    if (!ctx || !this.bus) return;
    const t0 = ctx.currentTime;
    for (let i = 0; i < 3; i++) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(80 * (i + 1), t0);
      osc.frequency.exponentialRampToValueAtTime(320 * (i + 1), t0 + dur);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.07, t0 + dur * 0.8);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur + 0.2);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(300, t0);
      bp.frequency.exponentialRampToValueAtTime(2400, t0 + dur);
      osc.connect(bp);
      bp.connect(g);
      g.connect(this.bus);
      osc.start(t0);
      osc.stop(t0 + dur + 0.3);
    }
  }

  private taiko(t: number, big: boolean, vel = 1): void {
    if (!this.bus) return;
    voice({ type: 'sine', freq: big ? 88 : 130, freqEnd: big ? 40 : 62, dur: big ? 0.42 : 0.24, gain: (big ? 0.55 : 0.3) * vel, bus: this.bus, when: t });
    noise({ dur: big ? 0.18 : 0.09, gain: (big ? 0.22 : 0.12) * vel, filterFreq: big ? 900 : 1600, filterEnd: 200, bus: this.bus, when: t });
  }

  private stringNote(t: number, freq: number, vel: number, dur = 0.14, filterHz = 1500): void {
    if (!this.bus) return;
    // Detuned pair, panned apart — a section, not a single player.
    voice({ type: 'sawtooth', freq, dur, gain: 0.085 * vel, filterFreq: filterHz, filterQ: 1.6, attack: 0.012, bus: this.bus, when: t, pan: -0.28 });
    voice({ type: 'sawtooth', freq: freq * 1.004, dur, gain: 0.055 * vel, filterFreq: filterHz * 0.75, attack: 0.012, bus: this.bus, when: t, pan: 0.22 });
  }

  /** Low brass mass — open fifth under the bass (full corps / finale). */
  private lowBrass(t: number, freq: number, dur: number, gain = 0.07): void {
    if (!this.bus) return;
    voice({ type: 'sawtooth', freq, dur, gain, filterFreq: 380, filterQ: 0.9, attack: 0.12, bus: this.bus, when: t, pan: -0.18 });
    voice({ type: 'sawtooth', freq: freq * 1.5, dur, gain: gain * 0.55, filterFreq: 520, attack: 0.14, bus: this.bus, when: t, pan: 0.22 });
    voice({ type: 'sine', freq: freq / 2, dur, gain: gain * 0.7, attack: 0.18, bus: this.bus, when: t });
  }

  /** Grid-scheduled braam with stereo seat — antiphonal L/R walls in the finale. */
  private braamAt(t: number, freq: number, dur: number, gain: number, pan = 0): void {
    const ctx = core.ensure();
    if (!ctx || !this.bus) return;
    const out = ctx.createGain();
    out.gain.setValueAtTime(0.0001, t);
    out.gain.exponentialRampToValueAtTime(gain, t + dur * 0.28);
    out.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(160, t);
    lp.frequency.exponentialRampToValueAtTime(1000, t + dur * 0.4);
    lp.frequency.exponentialRampToValueAtTime(220, t + dur);
    lp.Q.value = 1.2;
    const panner = ctx.createStereoPanner();
    panner.pan.setValueAtTime(Math.max(-1, Math.min(1, pan)), t);
    lp.connect(out);
    out.connect(panner);
    panner.connect(this.bus);
    for (const cents of [-12, -5, 0, 6, 13]) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = freq * Math.pow(2, cents / 1200);
      osc.connect(lp);
      osc.start(t);
      osc.stop(t + dur + 0.1);
    }
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.value = freq / 2;
    const subG = ctx.createGain();
    subG.gain.setValueAtTime(0.0001, t);
    subG.gain.exponentialRampToValueAtTime(gain * 0.85, t + dur * 0.3);
    subG.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    sub.connect(subG);
    subG.connect(this.bus);
    sub.start(t);
    sub.stop(t + dur + 0.1);
    // Short sub "air hit" under the wall.
    voice({ type: 'sine', freq: 42, freqEnd: 28, dur: 0.22, gain: gain * 0.45, bus: this.bus, when: t });
  }

  /** SATB-ish D-minor choir sustain — real section mass for the finale. */
  private choirSustain(t: number, dur: number, gain: number): void {
    if (!this.bus) return;
    // D3 F3 A3 Bb3 — minor triad + flat-6 color
    const parts: Array<[number, number]> = [
      [146.8, -0.45],
      [174.6, -0.2],
      [220, 0.2],
      [233.1, 0.45],
    ];
    for (const [freq, pan] of parts) {
      voice({ type: 'triangle', freq, dur, gain, attack: dur * 0.35, bus: this.bus, when: t, pan });
      voice({ type: 'sine', freq: freq * 1.002, dur, gain: gain * 0.65, attack: dur * 0.4, bus: this.bus, when: t, pan: -pan * 0.5 });
    }
  }

  /** Sustained rich chord bed — Time-like held harmony under the apex. */
  private richChordBed(t: number, freqs: number[], dur: number, gain: number): void {
    if (!this.bus) return;
    freqs.forEach((f, i) => {
      const pan = ((i % 2 === 0 ? -1 : 1) * (0.12 + i * 0.1));
      voice({ type: 'triangle', freq: f, dur, gain, attack: dur * 0.4, bus: this.bus, when: t, pan });
      voice({ type: 'sine', freq: f * 0.5, dur, gain: gain * 0.45, attack: dur * 0.45, bus: this.bus, when: t, pan: -pan * 0.4 });
      voice({ type: 'sawtooth', freq: f, dur, gain: gain * 0.22, filterFreq: 480, attack: dur * 0.5, bus: this.bus, when: t, pan });
    });
  }

  private padChord(t: number, freqs: number[], dur: number, gain = 0.05): void {
    if (!this.bus) return;
    freqs.forEach((f, i) => {
      const pan = ((i % 2 === 0 ? -1 : 1) * (0.15 + i * 0.08));
      voice({ type: 'triangle', freq: f, dur, gain, attack: dur * 0.3, bus: this.bus, when: t, pan });
      voice({ type: 'triangle', freq: f * 1.003, dur, gain: gain * 0.7, attack: dur * 0.35, bus: this.bus, when: t, pan: -pan });
    });
  }

  /** Low sustained cello bed — the dark floor under the ostinato. */
  private cello(t: number, freq: number, dur: number, gain = 0.1): void {
    if (!this.bus) return;
    voice({ type: 'sawtooth', freq, dur, gain, filterFreq: 320, attack: 0.25, bus: this.bus, when: t, pan: -0.2 });
    voice({ type: 'sawtooth', freq: freq * 1.006, dur, gain: gain * 0.75, filterFreq: 260, attack: 0.3, bus: this.bus, when: t, pan: 0.2 });
  }

  /** High shimmer strings — a cold sustained gleam above the action. */
  private shimmer(t: number, freq: number, dur: number, gain = 0.022): void {
    if (!this.bus) return;
    voice({ type: 'triangle', freq, dur, gain, attack: dur * 0.45, bus: this.bus, when: t, pan: 0.35 });
    voice({ type: 'triangle', freq: freq * 1.007, dur, gain: gain * 0.8, attack: dur * 0.5, bus: this.bus, when: t, pan: -0.35 });
  }

  /** Synth french horn — carries the theme. */
  private horn(t: number, freq: number, dur: number, gain = 0.085): void {
    if (!this.bus) return;
    voice({ type: 'sawtooth', freq, dur, gain, filterFreq: 820, filterQ: 0.8, attack: 0.055, bus: this.bus, when: t, pan: -0.08 });
    voice({ type: 'sawtooth', freq: freq * 1.005, dur, gain: gain * 0.5, filterFreq: 640, attack: 0.07, bus: this.bus, when: t, pan: 0.12 });
    voice({ type: 'triangle', freq: freq * 2, dur, gain: gain * 0.22, attack: 0.05, bus: this.bus, when: t });
  }

  /** Harp / celesta pluck for the Oasis. */
  private harp(t: number, freq: number, gain = 0.055, pan = 0.2): void {
    if (!this.bus) return;
    voice({ type: 'sine', freq, dur: 0.7, gain, attack: 0.004, bus: this.bus, when: t, pan });
    voice({ type: 'triangle', freq: freq * 2.01, dur: 0.35, gain: gain * 0.3, attack: 0.004, bus: this.bus, when: t, pan: -pan * 0.6 });
  }

  /** Tick-hat: tiny filtered noise keeping the 16th grid alive. */
  private hat(t: number, vel = 1): void {
    if (!this.bus) return;
    noise({ dur: 0.035, gain: 0.045 * vel, filterFreq: 6800, filterType: 'highpass', bus: this.bus, when: t });
  }

  /** Schedule the full 2-bar theme starting at t0. mult shifts the octave. */
  private playTheme(t0: number, mult = 1, gain = 0.085): void {
    const STEP = MUSIC_16TH_SEC;
    for (const [st, freq, durSteps] of MusicDirector.THEME) {
      this.horn(t0 + st * STEP, freq * mult, durSteps * STEP + 0.12, gain);
    }
  }

  private schedule(): void {
    const ctx = core.ctx;
    if (!ctx || !this.running) return;
    this.tickIntensity();
    const STEP = MUSIC_16TH_SEC;
    while (this.nextNoteTime < ctx.currentTime + 0.3) {
      this.playStep(this.step, this.nextNoteTime);
      this.nextNoteTime += STEP;
      this.step++;
    }
  }

  private playStep(step: number, t: number): void {
    const s16 = step % 16; // position in bar
    const bar = Math.floor(step / 16);
    const inten = this.intensity;

    // Living bee buzz rides under every mode once a swarm is on the field.
    if (this.beePresence && s16 % 2 === 0) this.beeBuzz(t, inten);
    // Species presence beds unlock with the minute-4 / minute-5 acts.
    this.playPresence(t, s16, bar);

    switch (this.mode) {
      case 'menu': {
        // Brooding, quiet: pulse, slow pads, a distant statement of the theme.
        if (s16 === 0 || s16 === 8) {
          voice({ type: 'sine', freq: 36.7, dur: 0.5, gain: 0.3, bus: this.bus, when: t });
        }
        if (step % 64 === 0) this.padChord(t, [146.8, 220, 293.7], 4.5, 0.04);
        if (step % 64 === 32) this.padChord(t, [130.8, 196, 246.9], 4.5, 0.035);
        if (bar % 4 === 0 && s16 === 0) this.cello(t, 73.4, 4.6, 0.07);
        if (bar % 8 === 2 && s16 === 0) this.shimmer(t, 587.3, 4.2, 0.014);
        // The theme drifts in from far away every 16 bars.
        if (bar % 16 === 6 && s16 === 0) this.playTheme(t, 0.5, 0.05);
        break;
      }

      case 'intro': {
        // Option A — pre-corps cinematic bed: intensity-gated, no act-tier finale.
        const cell = MusicDirector.OSTINATO[bar % 4];
        const gate = inten > 0.55 ? 1 : inten > 0.3 ? (s16 % 2 === 0 ? 1 : 0) : (s16 % 4 === 0 ? 1 : 0);
        if (gate) {
          const accent = s16 % 4 === 0 ? 1.25 : 0.85;
          this.stringNote(t, cell[s16], accent * (0.7 + inten * 0.5));
        }
        if (s16 === 0) {
          voice({ type: 'sawtooth', freq: MusicDirector.BASS[bar % 4], dur: 2.2, gain: 0.26, filterFreq: 130, attack: 0.03, bus: this.bus, when: t });
          this.cello(t, MusicDirector.CELLO[bar % 4], 2.4, 0.085 + inten * 0.03);
        }
        if (s16 === 4) this.shimmer(t, bar % 4 === 1 ? 466.2 : 587.3, 2.0, 0.016 + inten * 0.012);
        if (s16 === 0) this.taiko(t, true, 0.85 + inten * 0.2);
        if (s16 === 10) this.taiko(t, false, 0.9);
        if (inten > 0.5 && s16 === 13) this.taiko(t, false, 0.7);
        if (inten > 0.75 && s16 % 4 === 2) this.taiko(t, false, 0.45);
        if (inten > 0.35 && s16 % 2 === 1) this.hat(t, s16 % 4 === 3 ? 1 : 0.6);
        if (bar % 8 === 4 && s16 === 0) this.playTheme(t, 1, 0.07 + inten * 0.05);
        if (step % 128 === 0 && step > 0) this.braam(73.4, 1.6, 0.34 + inten * 0.2);
        if (step % 64 === 48) {
          voice({ type: 'triangle', freq: 587.3, dur: 2.2, gain: 0.03, attack: 0.8, bus: this.bus, when: t, pan: 0.3 });
          voice({ type: 'triangle', freq: 622.3, dur: 2.2, gain: 0.026, attack: 0.9, bus: this.bus, when: t, pan: -0.3 });
        }
        break;
      }

      case 'basalt': {
        // 2–2–1 battle book. Acts 1–2 keep the loved front-ensemble / full-corps
        // language. Act 3 is an additive Time/Babylon apex: triumph → awe.
        const cell = MusicDirector.OSTINATO[bar % 4];
        const corps = this.actTier;
        const apexT = Math.max(0, this.basaltElapsed - 240); // 0..60 inside Act 3
        // Additive layers inside the final minute (new voice every ~12s).
        const apexLayer = apexT < 12 ? 0 : apexT < 24 ? 1 : apexT < 36 ? 2 : apexT < 48 ? 3 : 4;
        const filterOpen = corps === 0 ? 1400 : corps === 1 ? 1900 : 1600;

        if (corps < 2) {
          // ——— Acts 1 & 2 (verse / lift) — unchanged language ———
          const gate = corps >= 1 ? 1 : (s16 % 2 === 0 ? 1 : 0);
          if (gate) {
            const accent = s16 % 4 === 0 ? 1.25 : 0.85;
            const strVel = accent * (0.62 + inten * 0.4) * (corps === 0 ? 1 : 1.12);
            this.stringNote(t, cell[s16], strVel, 0.14, filterOpen);
            if (corps >= 1) {
              this.stringNote(t, cell[s16] * 2, strVel * 0.55, 0.12, filterOpen * 1.1);
            }
          }
          if (s16 === 0) {
            voice({
              type: 'sawtooth', freq: MusicDirector.BASS[bar % 4], dur: 2.2,
              gain: 0.26, filterFreq: 130, attack: 0.03, bus: this.bus, when: t,
            });
            this.cello(t, MusicDirector.CELLO[bar % 4], 2.4, 0.085 + inten * 0.03);
            if (corps >= 1) {
              this.lowBrass(t, MusicDirector.CELLO[bar % 4], 2.2, 0.055 + inten * 0.045);
            }
          }
          if (corps === 1 && s16 === 0 && bar % 2 === 0) {
            const root = MusicDirector.OSTINATO[bar % 4][0];
            this.padChord(t, [root, root * 1.5, root * 2], 2.5, 0.022 + inten * 0.018);
          }
          if (s16 === 4) {
            this.shimmer(t, bar % 4 === 1 ? 466.2 : 587.3, 2.0, 0.014 + inten * 0.014);
          }
          if (s16 === 0) this.taiko(t, true, 0.82 + inten * 0.2);
          if (s16 === 10) this.taiko(t, false, 0.85);
          if (inten > 0.42 && s16 === 13) this.taiko(t, false, 0.65);
          if (corps >= 1 && s16 % 4 === 2) this.taiko(t, false, 0.4);
          if (s16 % 2 === 1) this.hat(t, s16 % 4 === 3 ? 1 : 0.55);
          if (corps === 0 && bar % 8 === 4 && s16 === 0) this.playTheme(t, 1, 0.075 + inten * 0.04);
          if (corps === 1 && bar % 4 === 2 && s16 === 0) this.playTheme(t, 1, 0.1 + inten * 0.055);
          if (step > 0) {
            if (corps === 1 && step % 64 === 0) this.braamAt(t, 73.4, 1.7, 0.4 + inten * 0.22, 0);
            else if (corps === 0 && step % 128 === 0) this.braamAt(t, 73.4, 1.5, 0.28 + inten * 0.14, 0);
          }
          if (step % 64 === 48) {
            voice({ type: 'triangle', freq: 587.3, dur: 2.2, gain: 0.028 + inten * 0.01, attack: 0.8, bus: this.bus, when: t, pan: 0.3 });
            voice({ type: 'triangle', freq: 622.3, dur: 2.2, gain: 0.024 + inten * 0.01, attack: 0.9, bus: this.bus, when: t, pan: -0.3 });
          }
        } else {
          // ——— Act 3 apex: additive tapestry, triumph → awe, ≤3 braams ———
          // Soft ostinato pulse under held chords (Time seed), not denser hits.
          if (s16 % 4 === 0) {
            const accent = s16 === 0 ? 1.1 : 0.7;
            this.stringNote(t, cell[s16], accent * (0.45 + inten * 0.25), 0.16, filterOpen);
            if (apexLayer >= 3) {
              this.stringNote(t, cell[s16] * 2, accent * 0.28, 0.14, 2000);
            }
          }

          // Rotating rich chord bed (add2 / sus4→3 / maj7 / m7).
          if (s16 === 0) {
            const chord = MusicDirector.APEX_CHORDS[bar % MusicDirector.APEX_CHORDS.length];
            const bedGain = (0.02 + inten * 0.018) * (1 + apexLayer * 0.12);
            this.richChordBed(t, chord, 2.5, bedGain);
            // Sub pulse — heartbeat, not blare.
            voice({
              type: 'sine', freq: MusicDirector.BASS[bar % 4], dur: 2.2,
              gain: 0.2 + apexLayer * 0.02, attack: 0.04, bus: this.bus, when: t,
            });
            if (apexLayer >= 1) {
              this.cello(t, MusicDirector.CELLO[bar % 4], 2.4, 0.07 + inten * 0.03);
            }
            // 4–3 suspension gesture when landing on the Asus→A pair.
            if (bar % 6 === 1 && apexLayer >= 1) {
              voice({ type: 'triangle', freq: 146.8, dur: 1.1, gain: 0.04, attack: 0.05, bus: this.bus, when: t, pan: -0.2 });
              voice({ type: 'triangle', freq: 138.6, dur: 1.2, gain: 0.035, attack: 0.08, bus: this.bus, when: t + 1.05, pan: 0.15 });
            }
          }

          // Layer 0+: soft choir air; Layer 4: full SATB awe hold.
          if (s16 === 0 && apexLayer >= 0 && apexLayer < 4 && bar % 2 === 0) {
            this.choirSustain(t, 2.4, 0.018 + inten * 0.012);
          }
          if (s16 === 0 && apexLayer >= 4) {
            this.choirSustain(t, 2.6, 0.034 + inten * 0.02);
            this.shimmer(t, 880, 2.4, 0.02 + inten * 0.012);
          }

          // Shimmer widens in lift layers.
          if (s16 === 4 && apexLayer >= 1) {
            this.shimmer(t, bar % 2 === 0 ? 587.3 : 698.5, 2.0, 0.014 + apexLayer * 0.004);
          }

          // Battery stays in pocket for warrior hits — light answers only.
          if (s16 === 0) this.taiko(t, true, 0.72 + inten * 0.15);
          if (s16 === 10) this.taiko(t, false, 0.7);
          if (apexLayer >= 2 && s16 === 13) this.taiko(t, false, 0.5);
          if (s16 % 2 === 1) this.hat(t, s16 % 4 === 3 ? 0.7 : 0.4);

          // TRIUMPH: horn theme as long melodic spine (layer 2+).
          if (apexLayer >= 2 && bar % 4 === 0 && s16 === 0) {
            this.playTheme(t, 1, 0.11 + inten * 0.05);
            if (apexLayer >= 3) this.playTheme(t, 2, 0.045 + inten * 0.025);
          }

          // ≤3 braams total in the minute — cadential, not a loop.
          // 1) triumph entry ~24s  2) awe bloom ~50s  3) optional crest ~55s
          if (s16 === 0) {
            if (apexT >= 24 && apexT < 24.55) {
              this.braamAt(t, 73.4, 1.7, 0.42 + inten * 0.15, 0);
            } else if (apexT >= 49.5 && apexT < 50.1) {
              this.braamAt(t, 65.4, 1.9, 0.48 + inten * 0.16, 0);
              this.taiko(t, true, 1.05);
            } else if (this.allowClimax && apexT >= 54.5 && apexT < 55.1) {
              this.braamAt(t, 73.4, 1.5, 0.36 + inten * 0.12, 0);
            }
          }

          // Awe: high tension drone opens into vastness late.
          if (apexLayer >= 3 && step % 64 === 48) {
            voice({ type: 'triangle', freq: 587.3, dur: 2.4, gain: 0.03 + inten * 0.012, attack: 0.9, bus: this.bus, when: t, pan: 0.35 });
            voice({ type: 'triangle', freq: 698.5, dur: 2.4, gain: 0.026 + inten * 0.01, attack: 1.0, bus: this.bus, when: t, pan: -0.35 });
          }
        }
        break;
      }

      case 'transition': {
        // Suspended: choir swell + heartbeat + a climbing tremolo shimmer;
        // the riser was fired on entry.
        if (s16 === 0) this.padChord(t, [146.8, 220, 293.7, 440], 2.6, 0.06);
        if (s16 === 0 || s16 === 6) {
          voice({ type: 'sine', freq: 60, freqEnd: 45, dur: 0.3, gain: 0.32, bus: this.bus, when: t });
        }
        if (s16 === 8) this.shimmer(t, 587.3 * (1 + (bar % 4) * 0.06), 1.6, 0.02);
        break;
      }

      case 'oasis': {
        // Hopeful but driving: pads, harp arpeggios, plucked lead, lighter
        // taikos — same heartbeat, warmer light.
        const chord = MusicDirector.OASIS_PADS[bar % 4];
        if (s16 === 0) {
          this.padChord(t, chord, 2.6, 0.05);
          voice({ type: 'sine', freq: chord[0] / 2, dur: 2.2, gain: 0.22, bus: this.bus, when: t });
          this.cello(t, chord[0] / 2, 2.4, 0.06);
        }
        // Harp / celesta arpeggio climbing the chord on the 8ths.
        if (s16 % 2 === 0) {
          const tone = chord[(s16 >> 1) % 4] * 2;
          this.harp(t, tone, 0.04 + inten * 0.02, (s16 >> 1) % 2 === 0 ? 0.28 : -0.28);
        }
        // Lead line on the off beats, denser as battle heats up.
        if (s16 % 2 === 0 && (s16 % 4 === 2 || inten > 0.45)) {
          const note = MusicDirector.OASIS_LEAD[(bar * 2 + (s16 >> 1)) % 8];
          voice({ type: 'sine', freq: note, dur: 0.32, gain: 0.085, attack: 0.01, bus: this.bus, when: t, pan: 0.1 });
        }
        if (s16 === 0) this.taiko(t, true, 0.8);
        if (s16 === 8) this.taiko(t, false, 0.7);
        if (inten > 0.6 && s16 === 12) this.taiko(t, false, 0.5);
        if (inten > 0.45 && s16 % 4 === 3) this.hat(t, 0.5);
        // The theme returns in the light — up an octave, gentler.
        if (bar % 8 === 4 && s16 === 0) this.playTheme(t, 2, 0.045);
        // Shimmer.
        if (step % 32 === 24) this.shimmer(t, 1174.7, 1.6, 0.02);
        break;
      }

      case 'ended': {
        if (s16 === 0 && bar % 2 === 0) this.padChord(t, [146.8, 220, 293.7, 370], 4, 0.05);
        if (s16 === 0 && bar % 8 === 1) this.playTheme(t, 1, 0.055);
        if (s16 === 0 && bar % 4 === 0) this.cello(t, 73.4, 4.2, 0.06);
        break;
      }
    }
  }
}

function makeImpulse(ctx: AudioContext, seconds: number, decay: number): AudioBuffer {
  const rate = ctx.sampleRate;
  const len = Math.floor(rate * seconds);
  const buf = ctx.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
  }
  return buf;
}

export const music = new MusicDirector();

/** Map game phases onto music modes (used by the game screen). */
export function musicModeForPhase(phase: 'basalt' | 'transition' | 'oasis' | 'ended'): MusicMode {
  return phase;
}
