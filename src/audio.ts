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

import type { GameEvent, GamePhase, SpeciesId } from './types';

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
  lilySink: () => {
    noise({ dur: 0.6, gain: 0.2, filterFreq: 800, filterEnd: 150 });
    voice({ type: 'sine', freq: 200, freqEnd: 60, dur: 0.5, gain: 0.2 });
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
      case 'lilySink':
        GLOBAL_SFX.lilySink();
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
/* Generative soundtrack                                                      */
/* ------------------------------------------------------------------------ */

/**
 * The music director runs on a musical scheduler (lookahead pattern) and
 * owns two "scores" that share one clock, so the phase-1 -> phase-2
 * crossfade is beat-aligned and seamless.
 */
class MusicDirector {
  private running = false;
  private phase: GamePhase | 'menu' = 'menu';
  private layerA: GainNode | null = null; // basalt score
  private layerB: GainNode | null = null; // oasis score
  private nextNoteTime = 0;
  private beat = 0;
  private schedTimer: ReturnType<typeof setInterval> | null = null;
  private intensity = 0.3; // 0..1, driven by battle density

  /** Basalt: D natural minor, brooding low register. */
  private static BASALT_BASS = [36.71, 36.71, 43.65, 36.71, 34.65, 34.65, 36.71, 32.7]; // D1 G1 C#1 area
  /** Oasis: D dorian, floating and hopeful. */
  private static OASIS_ARP = [293.66, 349.23, 440, 523.25, 440, 349.23, 493.88, 587.33];
  private static OASIS_PAD = [[146.83, 220, 293.66], [130.81, 196, 329.63], [174.61, 261.63, 349.23], [164.81, 246.94, 392]];

  start(): void {
    const ctx = core.ensure();
    if (!ctx || !core.musicBus || this.running) return;
    this.running = true;
    this.layerA = ctx.createGain();
    this.layerB = ctx.createGain();
    this.layerA.gain.value = this.phase === 'oasis' ? 0 : 1;
    this.layerB.gain.value = this.phase === 'oasis' ? 1 : 0;
    this.layerA.connect(core.musicBus);
    this.layerB.connect(core.musicBus);
    this.nextNoteTime = ctx.currentTime + 0.1;
    this.beat = 0;
    // 100 BPM eighth-note grid = 0.3 s per step; 4 steps per 1.2 s tick, so
    // the score breathes in lockstep with the simulation.
    this.schedTimer = setInterval(() => this.schedule(), 80);
  }

  stop(): void {
    this.running = false;
    if (this.schedTimer) clearInterval(this.schedTimer);
    this.schedTimer = null;
    const ctx = core.ctx;
    if (ctx) {
      this.layerA?.gain.setTargetAtTime(0, ctx.currentTime, 0.3);
      this.layerB?.gain.setTargetAtTime(0, ctx.currentTime, 0.3);
    }
    setTimeout(() => {
      this.layerA?.disconnect();
      this.layerB?.disconnect();
      this.layerA = null;
      this.layerB = null;
    }, 1200);
  }

  setPhase(phase: GamePhase | 'menu'): void {
    if (phase === this.phase) return;
    this.phase = phase;
    const ctx = core.ctx;
    if (!ctx || !this.layerA || !this.layerB) return;
    const toOasis = phase === 'oasis' || phase === 'ended';
    // 4-second equal-power crossfade.
    this.layerA.gain.setTargetAtTime(toOasis ? 0 : 1, ctx.currentTime, 1.2);
    this.layerB.gain.setTargetAtTime(toOasis ? 1 : 0, ctx.currentTime, 1.2);
  }

  /** Battle density (0..1) subtly drives percussion energy. */
  setIntensity(v: number): void {
    this.intensity = Math.max(0, Math.min(1, v));
  }

  private schedule(): void {
    const ctx = core.ctx;
    if (!ctx || !this.running) return;
    const STEP = 0.3;
    while (this.nextNoteTime < ctx.currentTime + 0.35) {
      this.playStep(this.beat, this.nextNoteTime);
      this.nextNoteTime += STEP;
      this.beat++;
    }
  }

  private playStep(beat: number, t: number): void {
    const step8 = beat % 8;
    const step4 = beat % 4;

    /* --- Layer A: the Basalt score — dark, heavy, ominous ------------- */
    if (this.layerA && this.layerA.gain.value > 0.02) {
      // Doom bass drone on every half bar.
      if (step8 % 2 === 0) {
        const f = MusicDirector.BASALT_BASS[step8];
        voice({ type: 'sawtooth', freq: f, dur: 0.55, gain: 0.32, filterFreq: 130, attack: 0.02, bus: this.layerA, when: t });
        voice({ type: 'square', freq: f * 2, dur: 0.5, gain: 0.1, filterFreq: 220, bus: this.layerA, when: t });
      }
      // War-drum thud on beats 0 and 5 (heavy syncopation).
      if (step8 === 0 || step8 === 5) {
        voice({ type: 'sine', freq: 82, freqEnd: 38, dur: 0.3, gain: 0.5, bus: this.layerA, when: t });
      }
      // Metallic tick pattern, denser with intensity.
      if (step4 === 2 || (this.intensity > 0.5 && step4 === 3)) {
        noise({ dur: 0.05, gain: 0.06 + this.intensity * 0.08, filterFreq: 5200, filterType: 'highpass', bus: this.layerA, when: t });
      }
      // Ominous minor-second drone swell every 4 bars.
      if (beat % 32 === 16) {
        voice({ type: 'triangle', freq: 293.66, dur: 3.5, gain: 0.05, attack: 1.2, bus: this.layerA, when: t });
        voice({ type: 'triangle', freq: 311.13, dur: 3.5, gain: 0.045, attack: 1.4, bus: this.layerA, when: t });
      }
    }

    /* --- Layer B: the Oasis score — mysterious, intense, hopeful ------- */
    if (this.layerB && this.layerB.gain.value > 0.02) {
      // Water-drop arpeggio.
      const arp = MusicDirector.OASIS_ARP[step8];
      if (step8 % 2 === 0 || this.intensity > 0.45) {
        voice({ type: 'sine', freq: arp, dur: 0.34, gain: 0.11, attack: 0.01, bus: this.layerB, when: t });
      }
      // Warm pad chord every bar.
      if (beat % 8 === 0) {
        const chord = MusicDirector.OASIS_PAD[Math.floor(beat / 8) % 4];
        for (const f of chord) {
          voice({ type: 'triangle', freq: f, dur: 2.3, gain: 0.05, attack: 0.5, bus: this.layerB, when: t });
        }
      }
      // Soft heartbeat pulse keeps the tension.
      if (step8 === 0 || step8 === 3) {
        voice({ type: 'sine', freq: 68, freqEnd: 50, dur: 0.22, gain: 0.26 + this.intensity * 0.1, bus: this.layerB, when: t });
      }
      // Hopeful high shimmer every 2 bars.
      if (beat % 16 === 12) {
        voice({ type: 'sine', freq: 1174.66, dur: 1.4, gain: 0.03, attack: 0.4, bus: this.layerB, when: t });
      }
    }
  }
}

export const music = new MusicDirector();
