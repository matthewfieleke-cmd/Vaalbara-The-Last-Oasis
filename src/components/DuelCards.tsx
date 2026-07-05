import type { FactionId, SpeciesId } from '../types';
import { FACTIONS } from '../data';
import { DUEL_STATS } from '../duel';
import { SpriteArt } from './SpriteArt';

/** Full battle-sheet lookup for a species within a faction. */
export function duelCardInfo(species: SpeciesId, faction: FactionId) {
  const card = FACTIONS[faction].cards.find((c) => c.species === species);
  const stats = DUEL_STATS[species];
  return { card, stats };
}

function StatBar({ label, value, max, hue }: { label: string; value: number; max: number; hue: number }) {
  return (
    <div className="dstat-row">
      <span className="dstat-label">{label}</span>
      <div className="dstat-bar">
        <div
          className="dstat-fill"
          style={{ width: `${Math.min(100, (value / max) * 100)}%`, background: `hsl(${hue} 75% 52%)` }}
        />
      </div>
      <span className="dstat-num">{value}</span>
    </div>
  );
}

/**
 * A champion's full battle sheet: portrait, HP/ATK/DEF/SPD bars, signature
 * move and passive. `order` shows the lineup slot badge when assigned.
 */
export function DuelStatCard({
  species,
  faction,
  order,
  compact = false,
  disabled = false,
  onClick,
}: {
  species: SpeciesId;
  faction: FactionId;
  order?: number;
  compact?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}) {
  const { card, stats } = duelCardInfo(species, faction);
  if (!card) return null;
  return (
    <button
      className={`duel-card ${compact ? 'compact' : ''} ${order ? 'ordered' : ''} ${disabled ? 'downed' : ''}`}
      style={{ ['--hue' as string]: card.hue }}
      onClick={onClick}
      disabled={disabled || !onClick}
    >
      {order !== undefined && order > 0 && <span className="duel-order">{order}</span>}
      {disabled && <span className="duel-downed-tag">DOWN</span>}
      <div className="duel-card-art">
        <SpriteArt species={species} hue={card.hue} />
      </div>
      <div className="duel-card-body">
        <div className="duel-card-name">
          {card.name}
          <span className="duel-card-cost">{card.cost}</span>
        </div>
        {!compact && <div className="duel-card-title">{card.title}</div>}
        <StatBar label="HP" value={stats.hp} max={540} hue={140} />
        <StatBar label="ATK" value={stats.atk} max={100} hue={18} />
        <StatBar label="DEF" value={stats.def} max={40} hue={205} />
        <StatBar label="SPD" value={stats.spd} max={10} hue={48} />
        {!compact && (
          <div className="duel-card-special">
            <b>✦ {stats.special.name}</b> {stats.special.blurb}
            {stats.passive && (
              <div className="duel-card-passive">◆ {stats.passive}</div>
            )}
          </div>
        )}
      </div>
    </button>
  );
}
