import { useState } from 'react';
import type { FactionId, SpeciesId } from '../types';
import { FACTIONS } from '../data';
import { playUi } from '../audio';
import { DuelStatCard } from './DuelCards';
import { DuelGuide } from './DuelGuide';

/**
 * Duels pre-fight: pick a coalition, study every champion's battle sheet,
 * and set the order they enter the arena. All six fight — order is the
 * strategy (damage carries over between rounds for the survivor).
 */
export function DuelSetup({
  onBack,
  onStart,
}: {
  onBack: () => void;
  onStart: (faction: FactionId, order: SpeciesId[]) => void;
}) {
  const [faction, setFaction] = useState<FactionId>('magma');
  const [order, setOrder] = useState<SpeciesId[]>([]);
  const [guideOpen, setGuideOpen] = useState(false);

  const roster = FACTIONS[faction].cards
    .map((c) => c.species)
    .filter((s): s is SpeciesId => !!s);

  const toggle = (sp: SpeciesId) => {
    playUi('tap');
    setOrder((o) => (o.includes(sp) ? o.filter((x) => x !== sp) : [...o, sp]));
  };

  const ready = order.length === roster.length;

  return (
    <div className="duel-setup">
      <h2>Duels of Vaalbara</h2>
      <p className="duel-setup-sub">
        Champion against champion until one coalition falls. Your survivor
        carries their wounds into the next round — the challenger arrives
        fresh. Tap your six warriors in the order they will fight.
      </p>

      <div className="duel-faction-toggle">
        {(['magma', 'oasis'] as const).map((fid) => (
          <button
            key={fid}
            className={`duel-fbtn ${fid} ${faction === fid ? 'selected' : ''}`}
            onClick={() => {
              if (faction !== fid) {
                setFaction(fid);
                setOrder([]);
                playUi('tap');
              }
            }}
          >
            {FACTIONS[fid].name}
          </button>
        ))}
      </div>

      <button
        className="duel-guide-btn"
        onClick={() => {
          setGuideOpen(true);
          playUi('tap');
        }}
      >
        📖 Strategy guide — when to Strike, Guard or unleash a Special
      </button>

      {guideOpen && <DuelGuide faction={faction} onClose={() => setGuideOpen(false)} />}

      <div className="duel-roster">
        {roster.map((sp) => (
          <DuelStatCard
            key={sp}
            species={sp}
            faction={faction}
            order={order.indexOf(sp) + 1}
            onClick={() => toggle(sp)}
          />
        ))}
      </div>

      <div className="menu-actions duel-setup-actions">
        <button
          className="btn btn-primary"
          disabled={!ready}
          onClick={() => ready && onStart(faction, order)}
        >
          {ready ? '⚔ Enter the Arena' : `Choose your order (${order.length}/${roster.length})`}
        </button>
        <button className="btn btn-ghost" onClick={onBack}>
          ◂ Back
        </button>
      </div>
    </div>
  );
}
