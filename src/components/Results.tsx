import type { GameState, PlayerId, Profile } from '../types';

export function Results({
  winner,
  seat,
  finalState,
  profile,
  onRematch,
  onMenu,
}: {
  winner: PlayerId | 'tie';
  seat: PlayerId;
  finalState: GameState | null;
  profile: Profile;
  onRematch: () => void;
  onMenu: () => void;
}) {
  const outcome = winner === 'tie' ? 'tie' : winner === seat ? 'win' : 'loss';
  const me = finalState?.players[seat];
  const foe = finalState?.players[seat === 0 ? 1 : 0];

  return (
    <div className="results">
      <h1 className={outcome}>
        {outcome === 'win' ? 'Oasis Claimed' : outcome === 'loss' ? 'Driven Out' : 'Official Tie'}
      </h1>
      <p style={{ color: 'var(--ink-dim)', maxWidth: '30ch' }}>
        {outcome === 'win'
          ? 'Your coalition drinks first. Vaalbara will sing of this.'
          : outcome === 'loss'
            ? 'The water slips away… but the drought is long, and so is memory.'
            : 'The meter froze at dead centre. Both armies share the pond — for now.'}
      </p>
      <div className="stats">
        <span>
          <b>{me ? Math.round(me.damageDealt) : 0}</b>
          damage dealt
        </span>
        <span>
          <b>{foe ? Math.round(foe.damageDealt) : 0}</b>
          damage taken
        </span>
        <span>
          <b>
            {profile.wins}–{profile.losses}–{profile.ties}
          </b>
          record
        </span>
      </div>
      <div className="menu-actions" style={{ width: '100%', maxWidth: 340 }}>
        <button className="btn btn-primary" onClick={onRematch}>
          ⚔ Rematch
        </button>
        <button className="btn btn-ghost" onClick={onMenu}>
          ◂ Main menu
        </button>
      </div>
    </div>
  );
}
