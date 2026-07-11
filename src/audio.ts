/* ============================================================================
 * VAALBARA: THE LAST OASIS — audio.ts
 * A fully procedural Web Audio synthesizer. Zero audio files.
 *
 *  - Soundtrack: generative layers on a 100 BPM musical clock.
 *    Phase 1 (Basalt Fields): dark D-minor pulse that lifts at the start of
 *    minute 4, pushes at the start of minute 5, and crests in the last 10 s
 *    (skipped on early double-raze — hands off to the existing transition).
 *    Phase 2 (Oasis): D-dorian score, crossfaded over the march.
 *  - Warriors: the battle DRUMLINE. Attack hits are soft-quantized onto the
 *    16th grid so they lock with the taiko; species sit in distinct registers
 *    (bass titans, mid strikers, high ticks). Bees keep a living buzz bed.
 *    Deploy entrances are species-specific and short — a new instrument
 *    joining the mix, not a second orchestra.
 * ========================================================================== */

import type { GameEvent, SpeciesId } from './types';

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

/** Soft-snap a hit onto the soundtrack's 16th grid (100 BPM → 0.15 s).
 *  Combat stays on the sim tick; only the sound waits ≤80 ms so the drumline
 *  locks to the taiko without feeling laggy. */
function quantizeAttackWhen(): number {
  const ctx = core.ensure();
  if (!ctx) return 0;
  return music.quantizeWhen(ctx.currentTime, 0.08);
}

export function handleGameEvents(events: GameEvent[]): void {
  if (!core.enabled) return;
  // Cap simultaneous SFX per tick so big battles don't clip into mush.
  let budget = 8;
  for (const e of events) {
    if (budget <= 0) break;
    switch (e.type) {
      case 'spawn':
        // Entrances fire immediately — a new instrument joining the mix.
        SPECIES_SFX[e.species].spawn();
        budget--;
        break;
      case 'attack':
        SPECIES_SFX[e.species].attack(quantizeAttackWhen());
        budget--;
        break;
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
  /** Grid origin aligned when music starts (for SFX quantize). */
  private gridOrigin = 0;
  /** Skip the 4:50 climax crest when Phase 1 ended early by double-raze. */
  private allowClimax = true;

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
    // 100 BPM 16th grid = 0.15 s per step (8 steps per 1.2 s = 4 sim ticks).
    this.schedTimer = setInterval(() => this.schedule(), 70);
  }

  stop(): void {
    this.running = false;
    if (this.schedTimer) clearInterval(this.schedTimer);
    this.schedTimer = null;
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
    } else if (mode === 'oasis' && prev === 'transition') {
      this.braam(220, 1.4, 0.5);
      this.intensityTarget = 0.4;
    } else if (mode === 'basalt') {
      this.braam(146.8, 1.6, 0.55);
      this.allowClimax = true;
      this.basaltElapsed = 0;
      this.intensityTarget = 0.28;
    }
  }

  /**
   * Drive Basalt act intensity from the Phase 1 clock + army density.
   * - Start of minute 4 (t=3:00): floor lifts toward 0.55 over ~12 s
   * - Start of minute 5 (t=4:00): floor lifts toward 0.78 over ~12 s
   * - Last 10 s (t=4:50): climax crest toward 0.95 (skipped if early transition)
   * Army size still adds energy on top so a stacked board cooks earlier.
   */
  setBattlePulse(opts: {
    phase: MusicMode;
    basaltElapsedSec: number;
    unitCount: number;
    beesAlive: boolean;
  }): void {
    this.beePresence = opts.beesAlive;
    if (opts.phase === 'basalt') {
      this.basaltElapsed = opts.basaltElapsedSec;
      const floor = this.actFloor(opts.basaltElapsedSec);
      const army = Math.min(1, opts.unitCount / 14);
      // Floor sets the act; army density can only raise it further.
      this.intensityTarget = Math.min(1, Math.max(floor, army * 0.88));
    } else if (opts.phase === 'oasis') {
      const army = Math.min(1, opts.unitCount / 14);
      this.intensityTarget = Math.min(1, 0.38 + army * 0.45);
    }
  }

  /** @deprecated Prefer setBattlePulse — kept for cinematic/menu callers. */
  setIntensity(v: number): void {
    this.intensityTarget = Math.max(0, Math.min(1, v));
  }

  /** Snap `when` forward onto the next 16th-note grid line, capped at maxDelay. */
  quantizeWhen(when: number, maxDelay = 0.08): number {
    const STEP = 0.15;
    const origin = this.gridOrigin || when;
    const steps = Math.ceil((when - origin) / STEP - 1e-9);
    const snapped = origin + Math.max(0, steps) * STEP;
    const delay = snapped - when;
    if (delay < 0) return when;
    if (delay > maxDelay) return when; // too far — don't lag the hit
    return snapped;
  }

  /** Act intensity floor from Basalt elapsed time (smoothstep ramps). */
  private actFloor(elapsed: number): number {
    const ease = (a: number, b: number, t: number) => {
      const x = Math.max(0, Math.min(1, t));
      const s = x * x * (3 - 2 * x);
      return a + (b - a) * s;
    };
    // Establish (minutes 1–3)
    if (elapsed < 180) return 0.28;
    // Start of minute 4 → lift
    if (elapsed < 240) return ease(0.28, 0.55, (elapsed - 180) / 12);
    // Start of minute 5 → push
    if (elapsed < 290) return ease(0.55, 0.78, (elapsed - 240) / 12);
    // Last 10 s climax (only if we weren't forced into early transition)
    if (!this.allowClimax) return 0.78;
    return ease(0.78, 0.95, (elapsed - 290) / 5);
  }

  /** Ease intensity toward its target each scheduler slice — no hard jumps. */
  private tickIntensity(): void {
    const d = this.intensityTarget - this.intensity;
    this.intensity += d * 0.12; // ~smooth over a second of scheduler wakes
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

  private stringNote(t: number, freq: number, vel: number, dur = 0.14): void {
    if (!this.bus) return;
    // Detuned pair, panned apart — a section, not a single player.
    voice({ type: 'sawtooth', freq, dur, gain: 0.085 * vel, filterFreq: 1500, filterQ: 1.6, attack: 0.012, bus: this.bus, when: t, pan: -0.28 });
    voice({ type: 'sawtooth', freq: freq * 1.004, dur, gain: 0.055 * vel, filterFreq: 1100, attack: 0.012, bus: this.bus, when: t, pan: 0.22 });
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
    const STEP = 0.15;
    for (const [st, freq, durSteps] of MusicDirector.THEME) {
      this.horn(t0 + st * STEP, freq * mult, durSteps * STEP + 0.12, gain);
    }
  }

  private schedule(): void {
    const ctx = core.ctx;
    if (!ctx || !this.running) return;
    this.tickIntensity();
    const STEP = 0.15;
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

      case 'intro':
      case 'basalt': {
        const cell = MusicDirector.OSTINATO[bar % 4];
        // Relentless string ostinato; density rides intensity.
        const gate = inten > 0.55 ? 1 : inten > 0.3 ? (s16 % 2 === 0 ? 1 : 0) : (s16 % 4 === 0 ? 1 : 0);
        if (gate) {
          const accent = s16 % 4 === 0 ? 1.25 : 0.85;
          this.stringNote(t, cell[s16], accent * (0.7 + inten * 0.5));
        }
        // Bass root each bar, doubled by a sustained cello bed one octave up.
        if (s16 === 0) {
          voice({ type: 'sawtooth', freq: MusicDirector.BASS[bar % 4], dur: 2.2, gain: 0.26, filterFreq: 130, attack: 0.03, bus: this.bus, when: t });
          this.cello(t, MusicDirector.CELLO[bar % 4], 2.4, 0.085 + inten * 0.03);
        }
        // Cold shimmer strings hold the minor third high above, once per bar.
        if (s16 === 4) this.shimmer(t, bar % 4 === 1 ? 466.2 : 587.3, 2.0, 0.016 + inten * 0.012);
        // Taiko pattern: heavy downbeat, answer on 11; fills at high intensity.
        if (s16 === 0) this.taiko(t, true, 0.85 + inten * 0.2);
        if (s16 === 10) this.taiko(t, false, 0.9);
        if (inten > 0.5 && s16 === 13) this.taiko(t, false, 0.7);
        if (inten > 0.75 && s16 % 4 === 2) this.taiko(t, false, 0.45);
        // Climax crest (last ~10 s): denser answers without a new stinger —
        // feeds the existing transition riser instead of fighting it.
        if (inten > 0.88 && (s16 === 4 || s16 === 12)) this.taiko(t, false, 0.55);
        // Tick-hats keep the 16th grid alive once the fight warms up.
        if (inten > 0.35 && s16 % 2 === 1) this.hat(t, s16 % 4 === 3 ? 1 : 0.6);
        // The horn theme rises out of the ostinato every 8 bars.
        if (bar % 8 === 4 && s16 === 0) this.playTheme(t, 1, 0.07 + inten * 0.05);
        // Braam accent opening every 8th bar (intro leans on manual braams).
        if (this.mode === 'basalt' && step % 128 === 0 && step > 0) {
          this.braam(73.4, 1.6, 0.34 + inten * 0.2);
        }
        // High tension drone every 4 bars.
        if (step % 64 === 48) {
          voice({ type: 'triangle', freq: 587.3, dur: 2.2, gain: 0.03, attack: 0.8, bus: this.bus, when: t, pan: 0.3 });
          voice({ type: 'triangle', freq: 622.3, dur: 2.2, gain: 0.026, attack: 0.9, bus: this.bus, when: t, pan: -0.3 });
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
