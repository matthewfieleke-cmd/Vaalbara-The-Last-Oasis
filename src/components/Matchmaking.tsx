import { useEffect, useRef, useState } from 'react';
import type { FactionId } from '../types';
import { createLocalSession, findMatch } from '../net';
import type { MatchSession } from '../net';

/**
 * Live matchmaking screen. Searches Firebase when keys exist; otherwise (or
 * on failure / timeout) glides into Local Guest Mode against the scripted
 * opponent so play always begins.
 */
export function Matchmaking({
  faction,
  onSession,
  onCancel,
}: {
  faction: FactionId;
  onSession: (s: MatchSession) => void;
  onCancel: () => void;
}) {
  const [status, setStatus] = useState('Reading the wind…');
  const cancelRef = useRef<(() => void) | null>(null);
  const settledRef = useRef(false);

  useEffect(() => {
    let alive = true;
    void findMatch(faction, {
      onStatus: (s) => {
        if (alive) setStatus(s);
      },
      onMatched: (session) => {
        if (alive && !settledRef.current) {
          settledRef.current = true;
          onSession(session);
        }
      },
      onFallback: (reason) => {
        if (!alive || settledRef.current) return;
        settledRef.current = true;
        setStatus(reason);
        setTimeout(() => {
          if (alive) onSession(createLocalSession(faction));
        }, 900);
      },
    }).then((h) => {
      cancelRef.current = h.cancel;
    });
    return () => {
      alive = false;
      cancelRef.current?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [faction]);

  return (
    <div className="matchmaking">
      <div className="scan-ring" />
      <div className="status">{status}</div>
      <button
        className="btn btn-ghost"
        onClick={() => {
          settledRef.current = true;
          cancelRef.current?.();
          onSession(createLocalSession(faction));
        }}
      >
        Play offline now ▸
      </button>
      <button className="btn btn-ghost" onClick={onCancel}>
        ◂ Back
      </button>
    </div>
  );
}
