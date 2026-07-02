import { useCallback, useEffect, useState } from 'react';
import type { FactionId, GameState, PlayerId, Profile, Screen } from './types';
import { loadProfile, recordResult } from './net';
import type { MatchSession } from './net';
import { music, playResult, setMuted, unlockAudio } from './audio';
import { Cinematic } from './components/Cinematic';
import { Menu } from './components/Menu';
import { FactionSelect } from './components/FactionSelect';
import { Matchmaking } from './components/Matchmaking';
import { GameScreen } from './components/GameScreen';
import { Results } from './components/Results';

const INTRO_SEEN_KEY = 'vaalbara.introSeen';

export function App() {
  const [screen, setScreen] = useState<Screen>('boot');
  const [profile, setProfile] = useState<Profile>(() => loadProfile());
  const [faction, setFaction] = useState<FactionId>('magma');
  const [session, setSession] = useState<MatchSession | null>(null);
  const [result, setResult] = useState<{ winner: PlayerId | 'tie'; state: GameState | null; seat: PlayerId } | null>(null);
  const [muted, setMutedState] = useState(false);
  /** Forces a fresh GameScreen mount per match. */
  const [matchNonce, setMatchNonce] = useState(0);

  // Boot: brief ember pulse, then intro (first visit) or menu.
  useEffect(() => {
    if (screen !== 'boot') return;
    const t = setTimeout(() => {
      const seen = localStorage.getItem(INTRO_SEEN_KEY) === '1';
      setScreen(seen ? 'menu' : 'cinematic');
    }, 900);
    return () => clearTimeout(t);
  }, [screen]);

  // First user gesture unlocks Web Audio on mobile.
  useEffect(() => {
    const unlock = () => unlockAudio();
    window.addEventListener('pointerdown', unlock, { once: true });
    return () => window.removeEventListener('pointerdown', unlock);
  }, []);

  const finishIntro = useCallback(() => {
    localStorage.setItem(INTRO_SEEN_KEY, '1');
    setScreen('menu');
  }, []);

  const startMatch = useCallback((s: MatchSession) => {
    setSession(s);
    setMatchNonce((n) => n + 1);
    setScreen('game');
  }, []);

  const endMatch = useCallback(
    (winner: PlayerId | 'tie', finalState: GameState) => {
      const seat = session?.localSeat ?? 0;
      const outcome = winner === 'tie' ? 'tie' : winner === seat ? 'win' : 'loss';
      setProfile((p) => recordResult(p, outcome, faction));
      playResult(outcome === 'win');
      setResult({ winner, state: finalState, seat });
      setSession(null);
      setScreen('results');
    },
    [session, faction],
  );

  const toggleMute = () => {
    setMutedState((m) => {
      setMuted(!m);
      return !m;
    });
  };

  return (
    <div className="app">
      {screen !== 'boot' && screen !== 'cinematic' && (
        <button className="mute-btn" onClick={toggleMute} aria-label="Toggle sound">
          {muted ? '🔇' : '🔊'}
        </button>
      )}

      {screen === 'boot' && (
        <div className="boot">
          <div className="ember" />
          <div style={{ letterSpacing: '0.3em', color: 'var(--ink-dim)', fontSize: '0.8rem' }}>
            IGNITING VAALBARA
          </div>
        </div>
      )}

      {screen === 'cinematic' && <Cinematic onDone={finishIntro} />}

      {screen === 'menu' && (
        <Menu
          profile={profile}
          onPlay={() => {
            music.start();
            music.setPhase('menu');
            setScreen('faction');
          }}
          onReplayIntro={() => setScreen('cinematic')}
        />
      )}

      {screen === 'faction' && (
        <FactionSelect
          onBack={() => setScreen('menu')}
          onConfirm={(f) => {
            setFaction(f);
            setScreen('matchmaking');
          }}
        />
      )}

      {screen === 'matchmaking' && (
        <Matchmaking
          faction={faction}
          onSession={startMatch}
          onCancel={() => setScreen('faction')}
        />
      )}

      {screen === 'game' && session && (
        <GameScreen key={matchNonce} session={session} onEnd={endMatch} />
      )}

      {screen === 'results' && result && (
        <Results
          winner={result.winner}
          seat={result.seat}
          finalState={result.state}
          profile={profile}
          onRematch={() => setScreen('matchmaking')}
          onMenu={() => setScreen('menu')}
        />
      )}

      <div className="rotate-gate">
        <div className="phone" />
        <div>
          <b>Rotate to portrait</b>
          <p style={{ color: 'var(--ink-dim)', marginTop: 6 }}>
            Vaalbara is a one-handed, portrait battlefield.
          </p>
        </div>
      </div>
    </div>
  );
}
