/* ============================================================================
 * VAALBARA: THE LAST OASIS — net.ts
 * Multiplayer transport + profile storage.
 *
 *  - Firebase Realtime Database powers live matchmaking and the input relay.
 *    The SDK is loaded dynamically from the Firebase CDN ONLY when config
 *    keys are present, so the core bundle carries zero network weight.
 *  - Local Guest Mode: when keys are absent (or the network fails) the game
 *    falls back to LocalStorage profiles and an on-device scripted opponent —
 *    immediately playable, no setup.
 *  - Both transports speak the exact same PlayerInput contract as engine.ts,
 *    and remote inputs flow through TickDriver.receiveRemote which performs
 *    deterministic rewind/replay; render.ts then applies visual catch-up
 *    interpolation so corrections never pop.
 * ========================================================================== */

import type { FactionId, PlayerId, PlayerInput, Profile } from './types';

/* ------------------------------------------------------------------------ */
/* Firebase configuration discovery                                           */
/* ------------------------------------------------------------------------ */

export interface FirebaseKeys {
  apiKey: string;
  databaseURL: string;
  projectId?: string;
  appId?: string;
}

declare global {
  interface Window {
    VAALBARA_FIREBASE?: FirebaseKeys;
  }
}

/**
 * Keys are looked up, in priority order:
 *  1. window.VAALBARA_FIREBASE (inline <script> in index.html)
 *  2. localStorage 'vaalbara.firebase' (user-pasted JSON in settings)
 *  3. Vite env vars (VITE_FIREBASE_API_KEY / VITE_FIREBASE_DB_URL)
 */
export function discoverFirebaseKeys(): FirebaseKeys | null {
  if (window.VAALBARA_FIREBASE?.apiKey && window.VAALBARA_FIREBASE.databaseURL) {
    return window.VAALBARA_FIREBASE;
  }
  try {
    const raw = localStorage.getItem('vaalbara.firebase');
    if (raw) {
      const parsed = JSON.parse(raw) as FirebaseKeys;
      if (parsed.apiKey && parsed.databaseURL) return parsed;
    }
  } catch {
    /* corrupted JSON — ignore */
  }
  const env = import.meta.env as Record<string, string | undefined>;
  if (env.VITE_FIREBASE_API_KEY && env.VITE_FIREBASE_DB_URL) {
    return { apiKey: env.VITE_FIREBASE_API_KEY, databaseURL: env.VITE_FIREBASE_DB_URL };
  }
  return null;
}

/* ------------------------------------------------------------------------ */
/* Profile storage — LocalStorage always; Firebase mirror when online         */
/* ------------------------------------------------------------------------ */

const PROFILE_KEY = 'vaalbara.profile';

export function loadProfile(): Profile {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (raw) return JSON.parse(raw) as Profile;
  } catch {
    /* fall through to default */
  }
  return {
    name: `Wanderer-${Math.floor(Math.random() * 9000 + 1000)}`,
    wins: 0,
    losses: 0,
    ties: 0,
    games: 0,
    favouriteFaction: 'magma',
  };
}

export function saveProfile(p: Profile): void {
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(p));
  } catch {
    /* storage full / private mode — non-fatal */
  }
}

export function recordResult(p: Profile, outcome: 'win' | 'loss' | 'tie', faction: FactionId): Profile {
  const next: Profile = {
    ...p,
    games: p.games + 1,
    wins: p.wins + (outcome === 'win' ? 1 : 0),
    losses: p.losses + (outcome === 'loss' ? 1 : 0),
    ties: p.ties + (outcome === 'tie' ? 1 : 0),
    favouriteFaction: faction,
  };
  saveProfile(next);
  return next;
}

/* ------------------------------------------------------------------------ */
/* Firebase Realtime Database — thin REST-ish wrapper via dynamic SDK import  */
/* ------------------------------------------------------------------------ */

interface FirebaseHandles {
  db: unknown;
  ref: (db: unknown, path: string) => unknown;
  set: (ref: unknown, value: unknown) => Promise<void>;
  update: (ref: unknown, value: unknown) => Promise<void>;
  push: (ref: unknown, value: unknown) => Promise<unknown>;
  onChildAdded: (ref: unknown, cb: (snap: { val: () => unknown }) => void) => () => void;
  onValue: (ref: unknown, cb: (snap: { val: () => unknown }) => void) => () => void;
  get: (ref: unknown) => Promise<{ val: () => unknown }>;
  remove: (ref: unknown) => Promise<void>;
  runTransaction: (ref: unknown, fn: (v: unknown) => unknown) => Promise<{ committed: boolean }>;
}

let fbHandles: FirebaseHandles | null = null;

const FB_VER = '10.14.1';

async function initFirebase(keys: FirebaseKeys): Promise<FirebaseHandles | null> {
  if (fbHandles) return fbHandles;
  try {
    const appMod = await import(/* @vite-ignore */ `https://www.gstatic.com/firebasejs/${FB_VER}/firebase-app.js`);
    const dbMod = await import(/* @vite-ignore */ `https://www.gstatic.com/firebasejs/${FB_VER}/firebase-database.js`);
    const app = appMod.initializeApp({
      apiKey: keys.apiKey,
      databaseURL: keys.databaseURL,
      projectId: keys.projectId,
      appId: keys.appId,
    });
    const db = dbMod.getDatabase(app);
    fbHandles = {
      db,
      ref: dbMod.ref,
      set: dbMod.set,
      update: dbMod.update,
      push: dbMod.push,
      onChildAdded: dbMod.onChildAdded,
      onValue: dbMod.onValue,
      get: dbMod.get,
      remove: dbMod.remove,
      runTransaction: dbMod.runTransaction,
    };
    return fbHandles;
  } catch (err) {
    console.warn('[net] Firebase unavailable, falling back to Local Guest Mode', err);
    return null;
  }
}

/* ------------------------------------------------------------------------ */
/* Match transport contract                                                   */
/* ------------------------------------------------------------------------ */

export interface MatchSession {
  mode: 'local' | 'online';
  roomId: string;
  seed: number;
  localSeat: PlayerId;
  factions: [FactionId, FactionId];
  /** Broadcast a local input to the opponent. */
  sendInput: (input: PlayerInput) => void;
  /** Subscribe to opponent inputs (fires for remote seat only). */
  onRemoteInput: (cb: (input: PlayerInput) => void) => void;
  /** Fires if the opponent disconnects / forfeits. */
  onOpponentLeft: (cb: () => void) => void;
  leave: () => void;
}

/** Local Guest Mode — the "transport" is a zero-latency loopback. */
export function createLocalSession(faction: FactionId): MatchSession {
  const enemyFaction: FactionId = faction === 'magma' ? 'oasis' : 'magma';
  return {
    mode: 'local',
    roomId: 'local',
    seed: (Math.random() * 0xffffffff) >>> 0,
    localSeat: 0,
    factions: [faction, enemyFaction],
    sendInput: () => { /* loopback: nothing leaves the device */ },
    onRemoteInput: () => { /* bot inputs are injected by the game loop */ },
    onOpponentLeft: () => { /* bots never rage-quit */ },
    leave: () => { /* nothing to tear down */ },
  };
}

/* ------------------------------------------------------------------------ */
/* Online matchmaking                                                         */
/*                                                                            */
/* Room lifecycle in RTDB:                                                    */
/*   rooms/{id}: { state: 'open'|'full', seed, hostFaction, guestFaction,     */
/*                 hostBeat, guestBeat }                                      */
/*   rooms/{id}/inputs/{autoId}: PlayerInput                                  */
/* Host lists 'open' rooms is skipped — we use a single lobby slot with a     */
/* transaction so two searching players pair atomically.                      */
/* ------------------------------------------------------------------------ */

interface LobbyEntry {
  roomId: string;
  hostFaction: FactionId;
  seed: number;
  at: number;
}

export interface MatchmakingHooks {
  onStatus: (status: string) => void;
  onMatched: (session: MatchSession) => void;
  onFallback: (reason: string) => void;
}

const LOBBY_STALE_MS = 30_000;

export async function findMatch(faction: FactionId, hooks: MatchmakingHooks): Promise<{ cancel: () => void }> {
  const keys = discoverFirebaseKeys();
  if (!keys) {
    hooks.onFallback('No Firebase keys configured — starting Local Guest Mode.');
    return { cancel: () => undefined };
  }
  hooks.onStatus('Connecting to the matchmaking springs…');
  const fb = await initFirebase(keys);
  if (!fb) {
    hooks.onFallback('Could not reach Firebase — starting Local Guest Mode.');
    return { cancel: () => undefined };
  }

  let cancelled = false;
  let cleanup: (() => void) | null = null;

  const run = async () => {
    const lobbyRef = fb.ref(fb.db, 'lobby/waiting');
    const myRoomId = `r${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
    const mySeed = (Math.random() * 0xffffffff) >>> 0;
    let joined: LobbyEntry | null = null;

    // Atomic pairing: claim the waiting slot if empty & fresh, otherwise take it.
    await fb.runTransaction(lobbyRef, (v: unknown) => {
      const cur = v as LobbyEntry | null;
      if (cur && Date.now() - cur.at < LOBBY_STALE_MS && cur.roomId !== myRoomId) {
        joined = cur;
        return null; // consume the slot
      }
      return { roomId: myRoomId, hostFaction: faction, seed: mySeed, at: Date.now() } satisfies LobbyEntry;
    });

    if (cancelled) return;

    if (joined) {
      // We are the GUEST (seat 1) in the host's room.
      const entry = joined as LobbyEntry;
      hooks.onStatus('Opponent found! Entering the Basalt Fields…');
      const roomRef = fb.ref(fb.db, `rooms/${entry.roomId}`);
      await fb.update(roomRef, { state: 'full', guestFaction: faction, guestBeat: Date.now() });
      hooks.onMatched(buildOnlineSession(fb, entry.roomId, entry.seed, 1, [entry.hostFaction, faction]));
      return;
    }

    // We are the HOST (seat 0): create the room and wait for a guest.
    hooks.onStatus('Searching for a rival coalition…');
    const roomRef = fb.ref(fb.db, `rooms/${myRoomId}`);
    await fb.set(roomRef, { state: 'open', seed: mySeed, hostFaction: faction, hostBeat: Date.now() });

    const timeout = setTimeout(() => {
      if (cancelled) return;
      cleanup?.();
      void fb.remove(roomRef);
      // Also clear our lobby claim so nobody joins a dead room.
      void fb.runTransaction(lobbyRef, (v: unknown) => {
        const cur = v as LobbyEntry | null;
        return cur?.roomId === myRoomId ? null : cur;
      });
      hooks.onFallback('No rivals found in the wastes — starting Local Guest Mode.');
    }, 25_000);

    const off = fb.onValue(roomRef, (snap) => {
      const room = snap.val() as { state?: string; guestFaction?: FactionId } | null;
      if (cancelled || !room) return;
      if (room.state === 'full' && room.guestFaction) {
        clearTimeout(timeout);
        off();
        hooks.onStatus('Opponent found! Entering the Basalt Fields…');
        hooks.onMatched(buildOnlineSession(fb, myRoomId, mySeed, 0, [faction, room.guestFaction]));
      }
    });
    cleanup = () => {
      clearTimeout(timeout);
      off();
    };
  };

  run().catch((err) => {
    console.warn('[net] matchmaking failed', err);
    if (!cancelled) hooks.onFallback('Matchmaking error — starting Local Guest Mode.');
  });

  return {
    cancel: () => {
      cancelled = true;
      cleanup?.();
    },
  };
}

function buildOnlineSession(
  fb: FirebaseHandles, roomId: string, seed: number,
  localSeat: PlayerId, factions: [FactionId, FactionId],
): MatchSession {
  const inputsRef = fb.ref(fb.db, `rooms/${roomId}/inputs`);
  let remoteCb: ((input: PlayerInput) => void) | null = null;
  let leftCb: (() => void) | null = null;

  const offInputs = fb.onChildAdded(inputsRef, (snap) => {
    const input = snap.val() as PlayerInput | null;
    if (input && input.player !== localSeat) remoteCb?.(input);
  });

  // Heartbeats: each seat bumps its beat; if the rival goes silent, they left.
  const beatKey = localSeat === 0 ? 'hostBeat' : 'guestBeat';
  const rivalKey = localSeat === 0 ? 'guestBeat' : 'hostBeat';
  const roomRef = fb.ref(fb.db, `rooms/${roomId}`);
  const beatTimer = setInterval(() => {
    void fb.update(roomRef, { [beatKey]: Date.now() }).catch(() => undefined);
  }, 5000);
  let lastRivalBeat = Date.now();
  const offRoom = fb.onValue(roomRef, (snap) => {
    const room = snap.val() as Record<string, number> | null;
    if (!room) {
      leftCb?.();
      return;
    }
    if (typeof room[rivalKey] === 'number') lastRivalBeat = room[rivalKey];
  });
  const watchdog = setInterval(() => {
    if (Date.now() - lastRivalBeat > 20_000) leftCb?.();
  }, 5000);

  return {
    mode: 'online',
    roomId,
    seed,
    localSeat,
    factions,
    sendInput: (input) => {
      void fb.push(inputsRef, input).catch(() => undefined);
    },
    onRemoteInput: (cb) => {
      remoteCb = cb;
    },
    onOpponentLeft: (cb) => {
      leftCb = cb;
    },
    leave: () => {
      offInputs();
      offRoom();
      clearInterval(beatTimer);
      clearInterval(watchdog);
      if (localSeat === 0) void fb.remove(roomRef).catch(() => undefined);
    },
  };
}
