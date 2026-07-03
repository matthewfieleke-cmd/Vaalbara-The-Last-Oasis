/* ============================================================================
 * VAALBARA: THE LAST OASIS — audio.ts
 * A fully procedural Web Audio synthesizer. Zero audio files.
 *
 *  - Soundtrack: two generative layers scheduled on a musical clock.
 *    Phase 1 (Basalt Fields): dark, heavy, ominous rhythmic pulse in D minor.
 *    Phase 2 (Oasis): mysterious-hopeful score in D dorian, crossfaded
 *    seamlessly over ~4 seconds at the transition.
 *  - SFX: each species has a distinct synth profile (waveform, pitch curve,
 *    filter, noise mix) triggered on deployment spawn and combat ticks.
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
  g.connect(bus);
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
/* Each species: { spawn, attack } with a signature timbre.                   */
/* ------------------------------------------------------------------------ */

type SfxFn = () => void;

const SPECIES_SFX: Record<SpeciesId, { spawn: SfxFn; attack: SfxFn }> = {
  trex: {
    // Sub-bass roar with a slow downward growl and rumbling noise floor.
    spawn: () => {
      voice({ type: 'sawtooth', freq: 90, freqEnd: 38, dur: 1.1, gain: 0.4, filterFreq: 300, attack: 0.05 });
      voice({ type: 'square', freq: 55, freqEnd: 30, dur: 1.2, gain: 0.28, filterFreq: 160 });
      noise({ dur: 1.0, gain: 0.2, filterFreq: 220, filterEnd: 60 });
    },
    attack: () => {
      voice({ type: 'square', freq: 70, freqEnd: 35, dur: 0.35, gain: 0.4, filterFreq: 250 });
      noise({ dur: 0.3, gain: 0.3, filterFreq: 400, filterEnd: 80 });
    },
  },
  lion: {
    spawn: () => {
      // Regal brassy roar: stacked saws with vibrato-like doubled detune.
      voice({ type: 'sawtooth', freq: 160, freqEnd: 95, dur: 0.9, gain: 0.3, filterFreq: 900, attack: 0.03 });
      voice({ type: 'sawtooth', freq: 164, freqEnd: 99, dur: 0.9, gain: 0.3, filterFreq: 900, attack: 0.03 });
      noise({ dur: 0.7, gain: 0.14, filterFreq: 700, filterEnd: 200 });
    },
    attack: () => {
      voice({ type: 'sawtooth', freq: 200, freqEnd: 120, dur: 0.22, gain: 0.28, filterFreq: 1100 });
    },
  },
  eagle: {
    spawn: () => {
      // Piercing screech gliding upward then down.
      voice({ type: 'triangle', freq: 900, freqEnd: 2400, dur: 0.18, gain: 0.2 });
      voice({ type: 'triangle', freq: 2400, freqEnd: 1100, dur: 0.35, gain: 0.22, when: (core.ctx?.currentTime ?? 0) + 0.16 });
    },
    attack: () => {
      voice({ type: 'triangle', freq: 1800, freqEnd: 700, dur: 0.15, gain: 0.2 });
      noise({ dur: 0.1, gain: 0.12, filterFreq: 4000, filterType: 'highpass' });
    },
  },
  honeybadger: {
    spawn: () => {
      // Feral chittering snarl: rapid square chirps.
      for (let i = 0; i < 4; i++) {
        voice({ type: 'square', freq: 320 + i * 60, freqEnd: 180, dur: 0.09, gain: 0.16, when: (core.ctx?.currentTime ?? 0) + i * 0.07 });
      }
    },
    attack: () => {
      voice({ type: 'square', freq: 420, freqEnd: 200, dur: 0.1, gain: 0.2 });
      voice({ type: 'square', freq: 500, freqEnd: 240, dur: 0.08, gain: 0.16, when: (core.ctx?.currentTime ?? 0) + 0.06 });
    },
  },
  scorpion: {
    spawn: () => {
      // Dry chitinous clicks.
      for (let i = 0; i < 3; i++) {
        noise({ dur: 0.04, gain: 0.2, filterFreq: 3000, filterType: 'bandpass', when: (core.ctx?.currentTime ?? 0) + i * 0.09 });
      }
    },
    attack: () => {
      // Whip-crack sting.
      voice({ type: 'sine', freq: 1500, freqEnd: 150, dur: 0.12, gain: 0.26 });
      noise({ dur: 0.05, gain: 0.2, filterFreq: 5000, filterType: 'highpass' });
    },
  },
  fireants: {
    spawn: () => {
      noise({ dur: 0.5, gain: 0.1, filterFreq: 2600, filterType: 'bandpass' });
      voice({ type: 'sawtooth', freq: 700, freqEnd: 900, dur: 0.4, gain: 0.05 });
    },
    attack: () => {
      noise({ dur: 0.12, gain: 0.12, filterFreq: 3200, filterType: 'bandpass' });
      voice({ type: 'sine', freq: 1100, freqEnd: 600, dur: 0.08, gain: 0.08 });
    },
  },
  bear: {
    spawn: () => {
      voice({ type: 'sawtooth', freq: 110, freqEnd: 55, dur: 1.0, gain: 0.34, filterFreq: 420, attack: 0.06 });
      noise({ dur: 0.8, gain: 0.16, filterFreq: 300, filterEnd: 90 });
    },
    attack: () => {
      // Heavy swipe: whoosh into thud.
      noise({ dur: 0.16, gain: 0.22, filterFreq: 900, filterEnd: 2400, filterType: 'bandpass' });
      voice({ type: 'sine', freq: 130, freqEnd: 45, dur: 0.25, gain: 0.34, when: (core.ctx?.currentTime ?? 0) + 0.1 });
    },
  },
  bighorn: {
    spawn: () => {
      // Hollow horn call.
      voice({ type: 'triangle', freq: 220, freqEnd: 330, dur: 0.5, gain: 0.24, filterFreq: 800 });
      voice({ type: 'triangle', freq: 110, dur: 0.5, gain: 0.16 });
    },
    attack: () => {
      // Skull-crack impact.
      voice({ type: 'square', freq: 180, freqEnd: 60, dur: 0.18, gain: 0.32, filterFreq: 500 });
      noise({ dur: 0.1, gain: 0.24, filterFreq: 1500, filterEnd: 300 });
    },
  },
  bees: {
    spawn: () => {
      // Detuned saw drone swelling in.
      voice({ type: 'sawtooth', freq: 210, freqEnd: 230, dur: 0.9, gain: 0.1, attack: 0.25 });
      voice({ type: 'sawtooth', freq: 216, freqEnd: 236, dur: 0.9, gain: 0.1, attack: 0.25 });
    },
    attack: () => {
      voice({ type: 'sawtooth', freq: 260, freqEnd: 320, dur: 0.2, gain: 0.12 });
      voice({ type: 'sine', freq: 1400, freqEnd: 900, dur: 0.06, gain: 0.1 });
    },
  },
  wolves: {
    spawn: () => {
      // Rising howl.
      voice({ type: 'sine', freq: 300, freqEnd: 620, dur: 0.7, gain: 0.2, attack: 0.12 });
      voice({ type: 'sine', freq: 302, freqEnd: 610, dur: 0.75, gain: 0.14, attack: 0.15 });
    },
    attack: () => {
      voice({ type: 'square', freq: 350, freqEnd: 180, dur: 0.12, gain: 0.18, filterFreq: 1300 });
      noise({ dur: 0.08, gain: 0.1, filterFreq: 2000, filterType: 'bandpass' });
    },
  },
  porcupine: {
    spawn: () => {
      // Rattling quills.
      for (let i = 0; i < 5; i++) {
        noise({ dur: 0.03, gain: 0.12, filterFreq: 4200, filterType: 'bandpass', when: (core.ctx?.currentTime ?? 0) + i * 0.05 });
      }
      voice({ type: 'triangle', freq: 180, freqEnd: 140, dur: 0.3, gain: 0.12 });
    },
    attack: () => {
      voice({ type: 'triangle', freq: 700, freqEnd: 1600, dur: 0.08, gain: 0.14 });
      noise({ dur: 0.05, gain: 0.14, filterFreq: 5000, filterType: 'highpass' });
    },
  },
  beetles: {
    spawn: () => {
      // Pressurised chemical hiss priming.
      noise({ dur: 0.5, gain: 0.14, filterFreq: 1800, filterEnd: 3600, filterType: 'bandpass' });
      voice({ type: 'square', freq: 90, freqEnd: 130, dur: 0.4, gain: 0.08 });
    },
    attack: () => {
      // Artillery pop + boiling spray.
      voice({ type: 'square', freq: 220, freqEnd: 60, dur: 0.1, gain: 0.26 });
      noise({ dur: 0.35, gain: 0.18, filterFreq: 3000, filterEnd: 700 });
    },
  },
};

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
    voice({ type: 'sine', freq: 520, freqEnd: 1040, dur: 0.4, gain: 0.12 });
    voice({ type: 'sine', freq: 780, freqEnd: 1560, dur: 0.4, gain: 0.08, when: (core.ctx?.currentTime ?? 0) + 0.1 });
  },
  lotusBurst: () => {
    voice({ type: 'sine', freq: 660, freqEnd: 1320, dur: 0.5, gain: 0.14 });
    noise({ dur: 0.4, gain: 0.1, filterFreq: 4000, filterType: 'highpass' });
  },
  splash: () => {
    // Acid burst: sizzling impact.
    noise({ dur: 0.5, gain: 0.22, filterFreq: 2600, filterEnd: 500 });
    voice({ type: 'sine', freq: 300, freqEnd: 90, dur: 0.3, gain: 0.18 });
  },
  blessing: () => {
    const t = core.ctx?.currentTime ?? 0;
    [523, 659, 784, 1047].forEach((f, i) => {
      voice({ type: 'sine', freq: f, dur: 0.6, gain: 0.12, when: t + i * 0.12 });
    });
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
    const t = core.ctx?.currentTime ?? 0;
    [392, 523, 659, 784, 1047].forEach((f, i) => {
      voice({ type: 'triangle', freq: f, dur: 0.8, gain: 0.14, when: t + i * 0.16 });
    });
  },
  defeat: () => {
    const t = core.ctx?.currentTime ?? 0;
    [440, 415, 392, 349].forEach((f, i) => {
      voice({ type: 'triangle', freq: f, dur: 0.7, gain: 0.13, when: t + i * 0.3 });
    });
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

/* ------------------------------------------------------------------------ */
/* Event router — the game loop feeds sim events straight in                  */
/* ------------------------------------------------------------------------ */

export function handleGameEvents(events: GameEvent[]): void {
  if (!core.enabled) return;
  // Cap simultaneous SFX per tick so big battles don't clip into mush.
  let budget = 7;
  for (const e of events) {
    if (budget <= 0) break;
    switch (e.type) {
      case 'spawn':
        SPECIES_SFX[e.species].spawn();
        budget--;
        break;
      case 'attack':
        SPECIES_SFX[e.species].attack();
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
        SPECIES_SFX.beetles.attack();
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

  /* D natural minor. Frequencies for the ostinato register (D3-based). */
  private static OSTINATO: number[][] = [
    // Four 1-bar cells (16 sixteenths each), Dm -> Bb -> Gm -> A.
    [146.8, 146.8, 220, 146.8, 174.6, 146.8, 220, 174.6, 146.8, 146.8, 220, 146.8, 174.6, 220, 174.6, 146.8],
    [116.5, 116.5, 174.6, 116.5, 146.8, 116.5, 174.6, 146.8, 116.5, 116.5, 174.6, 116.5, 146.8, 174.6, 146.8, 116.5],
    [98, 98, 146.8, 98, 116.5, 98, 146.8, 116.5, 98, 98, 146.8, 98, 116.5, 146.8, 116.5, 98],
    [110, 110, 164.8, 110, 138.6, 110, 164.8, 138.6, 110, 110, 164.8, 110, 138.6, 164.8, 138.6, 110],
  ];

  private static BASS = [36.7, 29.1, 24.5, 27.5]; // D1 Bb0 G0 A0
  /** Oasis: D dorian, hopeful. Pad chords + soaring line. */
  private static OASIS_PADS: number[][] = [
    [146.8, 220, 293.7, 440], // Dm add9
    [174.6, 261.6, 349.2, 523.3], // F
    [196, 293.7, 392, 587.3], // G
    [164.8, 246.9, 329.6, 493.9], // Em
  ];
  private static OASIS_LEAD = [587.3, 523.3, 440, 523.3, 587.3, 659.3, 587.3, 880];

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
      this.reverb.buffer = makeImpulse(ctx, 2.8, 2.2);
      this.reverbGain = ctx.createGain();
      this.reverbGain.gain.value = 0.4;
      this.reverb.connect(this.reverbGain);
      this.reverbGain.connect(core.musicBus);
    }
    this.bus.connect(this.reverb);
    this.nextNoteTime = ctx.currentTime + 0.08;
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
    // Punctuate big scene changes.
    if (mode === 'transition') {
      this.riser(2.4);
    } else if (mode === 'oasis' && prev === 'transition') {
      this.braam(220, 1.4, 0.5);
    } else if (mode === 'basalt') {
      this.braam(146.8, 1.6, 0.55);
    }
  }

  /** Battle density (0..1) drives percussion energy and note density. */
  setIntensity(v: number): void {
    this.intensity = Math.max(0, Math.min(1, v));
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
    voice({ type: 'sawtooth', freq, dur, gain: 0.085 * vel, filterFreq: 1500, filterQ: 1.6, attack: 0.012, bus: this.bus, when: t });
    voice({ type: 'sawtooth', freq: freq * 1.004, dur, gain: 0.055 * vel, filterFreq: 1100, attack: 0.012, bus: this.bus, when: t });
  }

  private padChord(t: number, freqs: number[], dur: number, gain = 0.05): void {
    if (!this.bus) return;
    for (const f of freqs) {
      voice({ type: 'triangle', freq: f, dur, gain, attack: dur * 0.3, bus: this.bus, when: t });
      voice({ type: 'triangle', freq: f * 1.003, dur, gain: gain * 0.7, attack: dur * 0.35, bus: this.bus, when: t });
    }
  }

  private schedule(): void {
    const ctx = core.ctx;
    if (!ctx || !this.running) return;
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

    switch (this.mode) {
      case 'menu': {
        // Brooding, quiet: pulse + sparse pad.
        if (s16 === 0 || s16 === 8) {
          voice({ type: 'sine', freq: 36.7, dur: 0.5, gain: 0.3, bus: this.bus, when: t });
        }
        if (step % 64 === 0) this.padChord(t, [146.8, 220, 293.7], 4.5, 0.04);
        if (step % 64 === 32) this.padChord(t, [130.8, 196, 246.9], 4.5, 0.035);
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
        // Bass root each bar; fifth halfway.
        if (s16 === 0) {
          voice({ type: 'sawtooth', freq: MusicDirector.BASS[bar % 4], dur: 2.2, gain: 0.26, filterFreq: 130, attack: 0.03, bus: this.bus, when: t });
        }
        // Taiko pattern: heavy downbeat, answer on 11; fills at high intensity.
        if (s16 === 0) this.taiko(t, true);
        if (s16 === 10) this.taiko(t, false, 0.9);
        if (inten > 0.5 && s16 === 13) this.taiko(t, false, 0.7);
        if (inten > 0.75 && s16 % 4 === 2) this.taiko(t, false, 0.45);
        // Braam accent opening every 8th bar (intro leans on manual braams).
        if (this.mode === 'basalt' && step % 128 === 0 && step > 0) {
          this.braam(73.4, 1.6, 0.34 + inten * 0.2);
        }
        // High tension drone every 4 bars.
        if (step % 64 === 48) {
          voice({ type: 'triangle', freq: 587.3, dur: 2.2, gain: 0.03, attack: 0.8, bus: this.bus, when: t });
          voice({ type: 'triangle', freq: 622.3, dur: 2.2, gain: 0.026, attack: 0.9, bus: this.bus, when: t });
        }
        break;
      }

      case 'transition': {
        // Suspended: choir swell + heartbeat, the riser was fired on entry.
        if (s16 === 0) this.padChord(t, [146.8, 220, 293.7, 440], 2.6, 0.06);
        if (s16 === 0 || s16 === 6) {
          voice({ type: 'sine', freq: 60, freqEnd: 45, dur: 0.3, gain: 0.32, bus: this.bus, when: t });
        }
        break;
      }

      case 'oasis': {
        // Hopeful but driving: pads, plucked lead, lighter taikos.
        if (s16 === 0) {
          this.padChord(t, MusicDirector.OASIS_PADS[bar % 4], 2.6, 0.05);
          voice({ type: 'sine', freq: MusicDirector.OASIS_PADS[bar % 4][0] / 2, dur: 2.2, gain: 0.22, bus: this.bus, when: t });
        }
        // Lead line on the off beats, denser as battle heats up.
        if (s16 % 2 === 0 && (s16 % 4 === 2 || inten > 0.45)) {
          const note = MusicDirector.OASIS_LEAD[(bar * 2 + (s16 >> 1)) % 8];
          voice({ type: 'sine', freq: note, dur: 0.32, gain: 0.085, attack: 0.01, bus: this.bus, when: t });
        }
        if (s16 === 0) this.taiko(t, true, 0.8);
        if (s16 === 8) this.taiko(t, false, 0.7);
        if (inten > 0.6 && s16 === 12) this.taiko(t, false, 0.5);
        // Shimmer.
        if (step % 32 === 24) {
          voice({ type: 'sine', freq: 1174.7, dur: 1.4, gain: 0.028, attack: 0.4, bus: this.bus, when: t });
        }
        break;
      }

      case 'ended': {
        if (s16 === 0 && bar % 2 === 0) this.padChord(t, [146.8, 220, 293.7, 370], 4, 0.05);
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
